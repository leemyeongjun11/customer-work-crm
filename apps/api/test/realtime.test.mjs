import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/db.mjs';
import {provision} from '../src/setup.mjs';
import {login,sessionCookie,createUser} from '../src/auth.mjs';
import {makeServer} from '../src/server.mjs';
import {createService} from '../src/service.mjs';
import {appendChange,changePage} from '../src/changes.mjs';

const at=new Date('2026-09-14T01:00:00Z');
const inquiry={customerType:'person',name:'실시간 검수 고객',phone:'010-0000-0000',email:'events@example.com',memo:'새 문의 표시 검수'};
async function fixture(t){const db=await openDatabase({url:'',directory:''}),company=await provision(db,{password:'Events-test-only'});t.after(()=>db.close());return {db,company,service:createService(db,()=>at),staff:{tenantId:company.tenantId,id:company.staffId,role:'staff'}};}

test('변경 로그의 회사·담당자 범위, 재배정 회수, 커서 복구와 롤백',async t=>{
  const {db,company,service,staff}=await fixture(t);
  assert.deepEqual(await changePage(db,staff,null),{reset:true,cursor:'0',items:[]});
  const key=randomUUID(),receipt=await service.intake('local-review',inquiry,key);
  await service.intake('local-review',inquiry,key);
  let page=await changePage(db,staff,'0');assert.equal(page.items.length,1);assert.equal(page.cursor,'1');
  const other=await db.transaction(tx=>createUser(tx,{tenantId:company.tenantId,name:'다른 직원',email:'other@crm.local',password:'Other-events-test',role:'staff'}));
  assert.equal((await changePage(db,{...staff,id:other},'0')).items.length,0);
  assert.equal((await changePage(db,{...staff,tenantId:randomUUID()},'0')).items.length,0);
  const change=await service.proposeChange(staff,receipt.receiptId,{type:'reassign',proposedAssigneeId:other,reason:'업무 이관',expectedVersion:1},randomUUID());
  await service.decideChange({...staff,role:'admin',id:company.adminId},change.id,'approve',{expectedCaseVersion:1,expectedProposalVersion:1,confirmed:true},randomUUID());
  page=await changePage(db,staff,'1');assert.equal(page.items.length,1);assert.equal(page.items[0].caseId,null);
  assert.ok((await changePage(db,{...staff,id:other},'1')).items.every(i=>i.caseId===receipt.receiptId));
  const latest=page.cursor;
  await assert.rejects(db.transaction(async tx=>{await appendChange(tx,company.tenantId,receipt.receiptId,at.toISOString());throw new Error('rollback');}),/rollback/);
  assert.equal((await changePage(db,staff,latest)).cursor,latest);
  await db.query('DELETE FROM crm_changes WHERE tenant_id=$1 AND revision<$2',[company.tenantId,latest]);
  assert.equal((await changePage(db,staff,'0')).reset,true);
  assert.equal((await changePage(db,staff,'9223372036854775807')).reset,true);
});

test('실제 SSE 신규 문의 전달, 다른 서버 재연결 재생, 인증 만료와 연결 제한',async t=>{
  const {db,service}=await fixture(t);
  const auth=await login(db,'staff@crm.local','Events-test-only',at),cookie=sessionCookie(auth.token).split(';')[0];
  const servers=[];
  for(let i=0;i<2;i++){const s=makeServer(db,{clock:()=>at,eventPollMs:25});await new Promise(r=>s.listen(0,'127.0.0.1',r));servers.push(s);}
  const streams=[];
  t.after(async()=>{for(const s of streams)s.abort();for(const s of servers){s.closeStreams();s.closeIdleConnections();await new Promise(r=>s.close(r));}});
  const origin=i=>`http://127.0.0.1:${servers[i].address().port}`;
  assert.equal((await fetch(origin(0)+'/api/v1/events')).status,401);
  assert.equal((await fetch(origin(0)+'/api/v1/events',{headers:{Cookie:cookie,'Last-Event-ID':'bad-cursor'}})).status,400);
  async function connect(i=0,cursor){
    const controller=new AbortController();streams.push(controller);
    const response=await fetch(origin(i)+'/api/v1/events',{headers:{Cookie:cookie,...(cursor?{'Last-Event-ID':cursor}:{})},signal:controller.signal});
    assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/event-stream/);
    const reader=response.body.getReader(),decoder=new TextDecoder(),queue=[],waiting=[];let buffer='';
    const pump=(async()=>{try{while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let split;while((split=buffer.indexOf('\n\n'))!==-1){const block=buffer.slice(0,split);buffer=buffer.slice(split+2);const name=/^event: (.+)$/m.exec(block)?.[1];if(!name)continue;const message={name,id:/^id: (.+)$/m.exec(block)?.[1],data:JSON.parse(/^data: (.+)$/m.exec(block)[1])};const match=waiting.findIndex(w=>w.name===name);if(match>=0)waiting.splice(match,1)[0].resolve(message);else queue.push(message);}}}catch(e){if(e.name!=='AbortError')throw e;}})();
    return {controller,pump,async next(name){
      const match=queue.findIndex(e=>e.name===name);if(match>=0)return queue.splice(match,1)[0];
      return new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(new Error(`SSE event timeout: ${name}`)),3000);
        waiting.push({name,resolve:value=>{clearTimeout(timeout);resolve(value);}});
      });
    }};
  }
  const first=await connect();await first.next('ready');
  const start=performance.now(),receipt=await service.intake('local-review',inquiry,randomUUID());
  const delivered=await first.next('change');assert.equal(delivered.data.caseId,receipt.receiptId);assert.ok(performance.now()-start<3000);assert.deepEqual(Object.keys(delivered.data),['caseId']);
  first.controller.abort();await first.pump;
  await service.addNote(auth.user,receipt.receiptId,{body:'재연결 중 저장된 메모',expectedVersion:1},randomUUID());
  const second=await connect(1,delivered.id);const replay=await second.next('change');assert.ok(BigInt(replay.id)>BigInt(delivered.id));await second.next('ready');
  for(let i=0;i<4;i++){const extra=await connect(1);await extra.next('ready');}
  assert.equal((await fetch(origin(1)+'/api/v1/events',{headers:{Cookie:cookie}})).status,429);
  await db.query('DELETE FROM crm_sessions');
  await second.next('session-expired');await second.pump;
});
