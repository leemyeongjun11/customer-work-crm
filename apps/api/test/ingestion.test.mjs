import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {openDatabase} from '../src/db.mjs';
import {provision} from '../src/setup.mjs';
import {makeServer} from '../src/server.mjs';
import {createService} from '../src/service.mjs';
import {ingestionService,readWebhookKeys} from '../src/ingestion.mjs';

const now=new Date('2026-09-16T06:00:00Z');
const event={schemaVersion:1,eventId:'event-001',eventType:'inquiry.created',sourceInquiryId:'source-001',sourceReceivedAt:'2026-09-11T10:00:00+09:00',payload:{customerType:'organization',name:'외부 검수 업체',contactName:'검수 담당자',phone:'010-0000-0000',email:'inquiry@example.com',companySize:'10명 미만',requestMemo:'시설 점검 상담 요청'}};
function signed(raw,key,stamp=String(now.getTime()/1000)){
  return {'Content-Type':'application/json','X-Webhook-Key-Id':key.id,'X-Webhook-Timestamp':stamp,'X-Webhook-Signature':createHmac('sha256',key.secret).update(stamp+'.').update(raw).digest('hex')};
}
async function fixture(t){
  const db=await openDatabase({url:'',directory:''}),company=await provision(db,{password:'Ingestion-tests-only'});
  const key={id:'local-test-key',tenantId:company.tenantId,secret:'test-only-secret-with-at-least-32-bytes',expiresAt:'2026-10-01T00:00:00Z'};
  t.after(()=>db.close());return {db,company,key};
}

test('외부 문의 HTTP 서명·원문·시각·스키마 검증과 일반 API 출처 보호',async t=>{
  const {db,key}=await fixture(t);
  const expired={...key,id:'expired',expiresAt:'2026-09-15T00:00:00Z'};
  const server=makeServer(db,{clock:()=>now,webhookKeys:[key,expired]});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{server.closeIdleConnections();await new Promise(r=>server.close(r));});
  const origin=`http://127.0.0.1:${server.address().port}`;
  async function send(body=event,{headers,key:signingKey=key,stamp,path='/api/v1/integrations/emergent/inquiries'}={}){
    const raw=typeof body==='string'?body:JSON.stringify(body);
    const r=await fetch(origin+path,{method:'POST',headers:headers||signed(raw,signingKey,stamp),body:raw});return {status:r.status,data:await r.json()};
  }
  assert.equal((await send(event,{headers:{'Content-Type':'application/json'}})).status,401);
  assert.equal((await send(event,{key:expired})).status,401);
  assert.equal((await send(event,{key:{...key,id:'unknown'}})).status,401);
  assert.equal((await send(event,{stamp:String(now.getTime()/1000-301)})).status,401);
  assert.equal((await send(event,{stamp:String(now.getTime()/1000+301)})).status,401);
  assert.equal((await send({...event,eventId:'tampered'},{headers:signed(JSON.stringify(event),key)})).status,401);
  assert.equal((await send('{')).status,400);
  assert.equal((await send({...event,schemaVersion:2})).status,422);
  assert.equal((await send({...event,tenantId:randomUUID()})).status,422);
  assert.equal((await send({...event,sourceReceivedAt:'2026-02-30T10:00:00+09:00'})).status,422);
  assert.equal((await send({...event,sourceReceivedAt:'2026-09-17T10:00:00+09:00'})).status,422);
  assert.equal((await send({...event,payload:{...event.payload,assigneeId:randomUUID()}})).status,422);
  assert.equal((await send('x'.repeat(17000))).status,413);
  assert.equal((await send(event,{path:'/api/v1/public/inquiries/local-review'})).status,403);
  assert.equal((await send()).status,201);
  assert.equal((await send()).status,200);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM crm_cases')).rows[0].n,1);
});

test('동시 중복·다른 이벤트 ID·회사 분리·지연 수신과 CRM 수정본 보존',async t=>{
  const {db,company,key}=await fixture(t);
  const foreign=await provision(db,{password:'Foreign-test-only',slug:'foreign-ingestion',adminEmail:'foreign@crm.local',staffEmail:'foreign-staff@crm.local'});
  const secondKey={...key,id:'second-company',tenantId:foreign.tenantId};
  const rotatedKey={...key,id:'rotated-key',secret:'rotated-test-secret-with-at-least-32-bytes'};
  const receiver=ingestionService(db,{clock:()=>now,keys:[key,secondKey,rotatedKey]});
  async function deliver(body=event,k=key){const raw=Buffer.from(JSON.stringify(body));const headers=Object.fromEntries(Object.entries(signed(raw,k)).map(([a,b])=>[a.toLowerCase(),b]));return receiver.receive(headers,raw);}
  const results=await Promise.all([deliver(),deliver(),deliver({...event,eventId:'event-002'})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,200,201]);
  const id=results[0].data.receiptId;assert.ok(results.every(r=>r.data.receiptId===id));
  assert.equal(results[0].data.firstContactDueAt,'2026-09-14T08:00:00.000Z');
  const user={tenantId:company.tenantId,id:company.staffId,role:'staff'},service=createService(db,()=>now);
  const original=await service.detail(user,id);assert.equal(original.tasks.length,1);
  assert.equal(original.salesCase.receivedAt,'2026-09-11T01:00:00.000Z');
  await service.updateCustomer(user,id,{customerType:'company',name:'CRM에서 수정한 업체명',person:'수정 담당자',phone:'010-1234-5678',email:'edited@example.com',size:'새 규모',requestMemo:'CRM 수정 내용',reason:'고객과 재확인',expectedVersion:1},randomUUID());
  await deliver({...event,eventId:'rotated-event'},rotatedKey);
  const updated=await service.detail(user,id);
  assert.equal(updated.salesCase.name,'CRM에서 수정한 업체명');assert.equal(updated.salesCase.original.name,event.payload.name);
  assert.equal(updated.salesCase.requestMemo,'CRM 수정 내용');
  await assert.rejects(deliver({...event,payload:{...event.payload,name:'바뀐 원문'}}),e=>e.status===409);
  await assert.rejects(deliver({...event,eventId:'changed-content',payload:{...event.payload,name:'바뀐 원문'}}),e=>e.status===409);
  await assert.rejects(deliver({...event,sourceInquiryId:'changed-id'}),e=>e.status===409);
  const cross=await deliver(event,secondKey);assert.equal(cross.status,201);assert.notEqual(cross.data.receiptId,id);
  await assert.rejects(service.detail(user,cross.data.receiptId),e=>e.status===404);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM crm_notification_jobs WHERE tenant_id=$1',[company.tenantId])).rows[0].n,2);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM crm_source_events WHERE tenant_id=$1',[company.tenantId])).rows[0].n,3);
  const stored=(await db.query('SELECT raw_payload,ingested_at FROM crm_source_inquiries WHERE tenant_id=$1',[company.tenantId])).rows[0];
  assert.deepEqual(stored.raw_payload,event.payload);assert.equal(new Date(stored.ingested_at).toISOString(),now.toISOString());
});

test('수신 기록 실패는 전체 롤백하며 재전송 복구·비활성 연결·키 설정 검사',async t=>{
  const {db,key}=await fixture(t);
  const raw=Buffer.from(JSON.stringify(event)),headers=Object.fromEntries(Object.entries(signed(raw,key)).map(([a,b])=>[a.toLowerCase(),b]));
  const failing={transaction:fn=>db.transaction(tx=>fn({query:(sql,values)=>{if(sql.startsWith('INSERT INTO crm_source_events'))throw new Error('Simulated storage failure');return tx.query(sql,values);}}))};
  await assert.rejects(ingestionService(failing,{clock:()=>now,keys:[key]}).receive(headers,raw),/Simulated storage failure/);
  for(const table of ['crm_cases','crm_tasks','crm_audit','crm_notification_jobs','crm_source_inquiries','crm_source_events'])assert.equal((await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n,0);
  assert.equal((await ingestionService(db,{clock:()=>now,keys:[key]}).receive(headers,raw)).status,201);
  await assert.rejects(ingestionService(db,{clock:()=>now}).receive(headers,raw),e=>e.status===503);
  assert.deepEqual(readWebhookKeys(''),[]);assert.deepEqual(readWebhookKeys(JSON.stringify([key])),[key]);
  for(const bad of ['{',JSON.stringify([{...key,secret:'short'}]),JSON.stringify([key,key]),JSON.stringify([{...key,expiresAt:'invalid'}])])assert.throws(()=>readWebhookKeys(bad),/Invalid CRM_EMERGENT_KEYS/);
});
