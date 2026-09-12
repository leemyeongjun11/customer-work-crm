import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readExportConnections,exportPageFetcher} from '../src/emergent-export.mjs';
import {startRecoveryPolling} from '../../scheduler/src/recovery-polling.mjs';
import {openDatabase} from '../src/db.mjs';
import {provision} from '../src/setup.mjs';
import {recoveryService} from '../src/recovery.mjs';

const connection={tenantId:randomUUID(),endpoint:'https://export.example.com/api/crm-export/inquiries',token:'test-only-export-token-2026'};
const json=v=>new Response(JSON.stringify(v),{headers:{'Content-Type':'application/json; charset=utf-8'}});
test('회사별 export 연결 설정·인증 범위·커서·오류·응답 한도',async()=>{
  assert.deepEqual(readExportConnections(),[]);assert.equal(exportPageFetcher([]),undefined);
  for(const item of [{...connection,endpoint:'http://export.example.com/api'},{...connection,endpoint:'https://user:pass@export.example.com/api'},{...connection,token:'short'},{...connection,role:'admin'}])assert.throws(()=>readExportConnections(JSON.stringify([item])));
  assert.throws(()=>readExportConnections(JSON.stringify([connection,connection])));
  const parsed=readExportConnections(JSON.stringify([connection]));let seen=0;
  const signal=new AbortController().signal,args={tenantId:connection.tenantId,cursor:'opaque / & 다음',limit:100,signal};
  const fetcher=exportPageFetcher(parsed,{fetchImpl:async(url,options)=>{seen++;assert.equal(url.searchParams.get('cursor'),args.cursor);assert.equal(url.searchParams.get('limit'),'100');assert.equal(options.headers.Authorization,`Bearer ${connection.token}`);assert.equal(options.redirect,'error');assert.equal(options.signal,signal);return json({items:[],nextCursor:'next',hasMore:false});}});
  assert.equal((await fetcher(args)).nextCursor,'next');await assert.rejects(fetcher({...args,tenantId:randomUUID()}),e=>e.status===503);assert.equal(seen,1);
  for(const status of [401,403,429,500]){const f=exportPageFetcher(parsed,{fetchImpl:async()=>new Response('PRIVATE upstream details',{status,headers:{'Retry-After':'120'}})});await assert.rejects(f(args),e=>{assert.ok(!e.message.includes('PRIVATE'));assert.equal(e.status,status===500?503:status);if(status===429)assert.equal(e.retryAfterSeconds,120);return true;});}
  for(const response of [new Response('html'),new Response('invalid',{headers:{'Content-Type':'application/json'}}),new Response('x'.repeat(1024*1024+1),{headers:{'Content-Type':'application/json'}})])await assert.rejects(exportPageFetcher(parsed,{fetchImpl:async()=>response})(args),e=>e.status===502);
});

test('누락 조회 예약의 겹침 방지·정지 대기·회사별 실패 격리',async()=>{
  let release,started;const entered=new Promise(r=>started=r),gate=new Promise(r=>release=r),seen=[];
  const poller=startRecoveryPolling({run:async id=>{seen.push(id);started();await gate;}},{tenantIds:['first','second']});
  await entered;await poller.tick();assert.deepEqual(seen,['first']);const stopping=poller.stop();release();await stopping;await poller.tick();assert.deepEqual(seen,['first']);
  let done,errors=0;const finished=new Promise(r=>done=r),next=[];
  const isolated=startRecoveryPolling({run:async id=>{next.push(id);if(id==='bad')throw new Error('failure');done();}},{tenantIds:['bad','good'],onError:()=>errors++});
  await finished;await isolated.stop();assert.deepEqual(next,['bad','good']);assert.equal(errors,1);
});

test('export 어댑터에서 실제 수집 엔진까지 연결하고 미설정 회사 차단',async t=>{
  const db=await openDatabase({url:'',directory:''});t.after(()=>db.close());const c=await provision(db,{password:'Export-test-only'}),other=await provision(db,{password:'Export-test-only',slug:'other-export',adminEmail:'other@crm.local',staffEmail:'other-staff@crm.local'});
  let now=new Date('2026-09-16T01:00:00Z'),calls=0;
  const event={schemaVersion:1,eventId:'export-event',eventType:'inquiry.created',sourceInquiryId:'export-inquiry',sourceReceivedAt:'2026-09-11T10:00:00+09:00',payload:{customerType:'person',name:'누락 조회 연결 검수',phone:'010-0000-0000',email:'export@example.com',requestMemo:'문의 복구'}};
  const fetchPage=exportPageFetcher([{...connection,tenantId:c.tenantId}],{fetchImpl:async()=>{calls++;return json({items:[event],nextCursor:'page-1',hasMore:false});}}),recovery=recoveryService(db,{clock:()=>now,fetchPage});
  assert.equal((await recovery.status({role:'admin',tenantId:other.tenantId})).configured,false);await assert.rejects(recovery.run(other.tenantId),e=>e.status===503);
  assert.equal((await recovery.run(c.tenantId)).created,1);assert.equal((await recovery.run(c.tenantId)).status,'waiting');assert.equal(calls,1);
  now=new Date(now.getTime()+60000);assert.equal((await recovery.run(c.tenantId)).duplicates,1);assert.equal(calls,2);
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM crm_cases')).rows[0].n),1);
});
