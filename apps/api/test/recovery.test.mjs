import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/db.mjs';
import {provision} from '../src/setup.mjs';
import {recoveryService} from '../src/recovery.mjs';
import {ingestionService} from '../src/ingestion.mjs';
import {ApiError} from '../src/rules.mjs';
import {makeServer} from '../src/server.mjs';
import {login,sessionCookie} from '../src/auth.mjs';

const event=i=>({schemaVersion:1,eventId:`event-${i}`,eventType:'inquiry.created',sourceInquiryId:`source-${i}`,sourceReceivedAt:'2026-09-11T10:00:00+09:00',payload:{customerType:'person',name:`보충 검수 ${i}`,phone:'010-0000-0000',email:'recover@example.com',requestMemo:'누락 문의 검수'}});
async function fixture(t){const db=await openDatabase({url:'',directory:''}),company=await provision(db,{password:'Recovery-test-only'});t.after(()=>db.close());return {db,company,admin:{tenantId:company.tenantId,id:company.adminId,role:'admin'}};}

test('보충 조회의 부분 실패·영속 오류·커서 유지·재수신 중복 방지와 복구',async t=>{
  const {db,company,admin}=await fixture(t);let now=new Date('2026-09-16T01:00:00Z'),fixed=false;
  const seen=[],fetchPage=async({cursor,limit,tenantId,signal})=>{seen.push(cursor);assert.equal(limit,100);assert.equal(tenantId,company.tenantId);assert.ok(signal instanceof AbortSignal);return {items:[event(1),fixed?event(2):{...event(2),payload:{...event(2).payload,phone:''}},event(3)],nextCursor:'page-1',hasMore:false};};
  const recovery=recoveryService(db,{clock:()=>now,fetchPage});
  await ingestionService(db,{clock:()=>now}).importVerified(company.tenantId,event(1));
  assert.deepEqual(await recovery.run(company.tenantId),{status:'needs_review',created:1,duplicates:1,failed:1,hasMore:false});
  assert.equal((await db.query('SELECT cursor FROM crm_recovery_state')).rows[0].cursor,null);
  let status=await recovery.status(admin);assert.equal(status.errors.length,1);assert.equal(status.errors[0].sourceInquiryId,'source-2');assert.equal(status.received.total,2);assert.equal(status.state.lastSuccess,null);
  assert.equal((await recovery.run(company.tenantId)).status,'waiting');
  fixed=true;now=new Date(now.getTime()+60000);
  assert.deepEqual(await recovery.run(company.tenantId),{status:'completed',created:1,duplicates:2,failed:0,hasMore:false});
  assert.deepEqual(seen,[null,null]);assert.equal((await db.query('SELECT cursor FROM crm_recovery_state')).rows[0].cursor,'page-1');
  status=await recovery.status(admin);assert.equal(status.errors.length,0);assert.equal(status.received.total,3);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM crm_notification_jobs')).rows[0].n,6);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM crm_changes')).rows[0].n,3);
});

test('보충 실행 임대·인증 중단과 관리자 재개·요청 제한·잘못된 페이지',async t=>{
  const {db,company,admin}=await fixture(t);let now=new Date('2026-09-16T01:00:00Z'),resolvePage,started;
  const fetching=new Promise(r=>{started=r;});
  let fetcher=()=>{started();return new Promise(r=>{resolvePage=r;});};
  const recovery=recoveryService(db,{clock:()=>now,fetchPage:args=>fetcher(args)});
  const running=recovery.run(company.tenantId);await fetching;
  assert.equal((await recovery.run(company.tenantId)).status,'running');
  resolvePage({items:[],nextCursor:'begin',hasMore:false});await running;
  now=new Date(now.getTime()+60000);fetcher=async()=>{throw new ApiError(401,'인증 만료');};
  assert.equal((await recovery.run(company.tenantId)).status,'blocked');assert.equal((await recovery.run(company.tenantId)).status,'blocked');
  await assert.rejects(recovery.resume({...admin,role:'staff'}),e=>e.status===403);
  await recovery.resume(admin);
  fetcher=async()=>{const e=new ApiError(429,'요청 제한');e.retryAfterSeconds=120;throw e;};
  assert.equal((await recovery.run(company.tenantId)).status,'retry');assert.equal((await recovery.status(admin)).state.nextRun,new Date(now.getTime()+120000).toISOString());
  now=new Date(now.getTime()+60000);assert.equal((await recovery.run(company.tenantId)).status,'waiting');
  now=new Date(now.getTime()+60000);fetcher=async()=>({items:[],nextCursor:'begin',hasMore:true});
  assert.equal((await recovery.run(company.tenantId)).status,'retry');assert.equal((await db.query('SELECT cursor FROM crm_recovery_state')).rows[0].cursor,'begin');
  now=new Date(now.getTime()+60000);fetcher=async()=>({items:[],nextCursor:'end',hasMore:false});
  await db.query("UPDATE crm_recovery_state SET lease_id=$1,lease_until=$2,status='running'",[company.adminId,new Date(now.getTime()-1000).toISOString()]);
  assert.equal((await recovery.run(company.tenantId)).status,'completed');
});

test('연동 상태·복구 API의 관리자 권한과 미연결 표시',async t=>{
  const {db,admin}=await fixture(t);
  const server=makeServer(db);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{server.closeStreams();server.closeIdleConnections();await new Promise(r=>server.close(r));});
  const origin=`http://127.0.0.1:${server.address().port}`,route='/api/v1/admin/integrations/emergent';
  const cookie=async(email)=>sessionCookie((await login(db,email,'Recovery-test-only')).token).split(';')[0];
  const staffCookie=await cookie('staff@crm.local'),adminCookie=await cookie('admin@crm.local');
  assert.equal((await fetch(origin+route)).status,401);
  assert.equal((await fetch(origin+route,{headers:{Cookie:staffCookie}})).status,403);
  const state=await (await fetch(origin+route,{headers:{Cookie:adminCookie}})).json();assert.equal(state.configured,false);assert.equal(state.received.total,0);
  for(const [who,status] of [[staffCookie,403],[adminCookie,503]])assert.equal((await fetch(origin+route+'/recover',{method:'POST',headers:{Origin:origin,Cookie:who,'Content-Type':'application/json'},body:'{}'})).status,status);
  await assert.rejects(recoveryService(db).run(admin.tenantId),e=>e.status===503);
});
