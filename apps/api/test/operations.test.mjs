import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/db.mjs';
import {provision} from '../src/setup.mjs';
import {makeServer} from '../src/server.mjs';
import {createService} from '../src/service.mjs';
import {operationService} from '../src/operations.mjs';
const inquiry={customerType:'person',name:'운영 검수 고객',phone:'010-0000-0000',email:'ops@example.com',memo:'시설 점검 요청'};

test('운영 설정 HTTP 권한·입력·중복·충돌과 신규 접수 정책 적용',async t=>{
  const db=await openDatabase({url:'',directory:''}),password='Operations-test-only';
  const c=await provision(db,{password});const foreign=await provision(db,{password,slug:'foreign-ops',adminEmail:'foreign@crm.local',staffEmail:'foreign-staff@crm.local'});
  const at=new Date('2026-09-11T06:00:00Z'),service=createService(db,()=>at);
  const old=await service.intake('local-review',inquiry,randomUUID());
  const server=makeServer(db,{clock:()=>at});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{server.closeIdleConnections();await new Promise(r=>server.close(r));await db.close();});
  const origin=`http://127.0.0.1:${server.address().port}`;
  async function call(path,{method='GET',body,cookie,key=randomUUID()}={}){const r=await fetch(origin+'/api/v1'+path,{method,headers:{Origin:origin,'Content-Type':'application/json','Idempotency-Key':key,...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
  async function login(email){const r=await call('/auth/login',{method:'POST',body:{email,password}});assert.equal(r.status,200);return r.cookie;}
  const admin=await login('admin@crm.local'),staff=await login('staff@crm.local');
  assert.equal((await call('/admin/settings')).status,401);assert.equal((await call('/admin/settings',{cookie:staff})).status,403);
  const initial=(await call('/admin/settings',{cookie:admin})).data;assert.equal(initial.version,1);assert.equal(initial.users.length,2);
  const body={defaultAssigneeId:c.adminId,holidays:['2026-09-14'],expectedVersion:1,reason:'회사 휴무일과 접수 담당자 지정',confirmed:true};
  assert.equal((await call('/admin/settings',{method:'PATCH',cookie:staff,body})).status,403);
  assert.equal((await call('/admin/settings',{method:'PATCH',cookie:admin,body:{...body,defaultAssigneeId:foreign.adminId}})).status,422);
  assert.equal((await call('/admin/settings',{method:'PATCH',cookie:admin,body:{...body,holidays:['2026-02-30']}})).status,422);
  assert.equal((await call('/admin/settings',{method:'PATCH',cookie:admin,body:{...body,holidays:['2026-09-14','2026-09-14']}})).status,422);
  assert.equal((await call('/admin/settings',{method:'PATCH',cookie:admin,body:{...body,tenantId:foreign.tenantId}})).status,422);
  const key=randomUUID(),saved=await call('/admin/settings',{method:'PATCH',cookie:admin,body,key});assert.equal(saved.status,200);assert.equal(saved.data.version,2);
  assert.deepEqual((await call('/admin/settings',{method:'PATCH',cookie:admin,body:Object.fromEntries(Object.entries(body).reverse()),key})).data,saved.data);
  assert.equal((await call('/admin/settings',{method:'PATCH',cookie:admin,body:{...body,reason:'다른 내용'},key})).status,409);
  assert.equal((await call('/admin/settings',{method:'PATCH',cookie:admin,body})).status,409);
  assert.equal((await call('/admin/settings',{cookie:admin})).data.history.length,1);
  const next=await service.intake('local-review',inquiry,randomUUID());
  assert.equal(old.firstContactDueAt,'2026-09-14T08:00:00.000Z');assert.equal(next.firstContactDueAt,'2026-09-15T08:00:00.000Z');
  const records=(await db.query('SELECT id,assignee_id,deadline_policy FROM crm_cases WHERE tenant_id=$1 ORDER BY id',[c.tenantId])).rows;
  assert.equal(records.find(r=>r.id===old.receiptId).assignee_id,c.staffId);assert.equal(records.find(r=>r.id===old.receiptId).deadline_policy.settingsVersion,1);
  assert.equal(records.find(r=>r.id===next.receiptId).assignee_id,c.adminId);assert.deepEqual(records.find(r=>r.id===next.receiptId).deadline_policy.holidays,['2026-09-14']);
  const metric=await call('/metrics/first-contact?from=2026-09-01&to=2026-09-30',{cookie:staff});assert.equal(metric.status,200);assert.equal(metric.data.notYetDue,1);assert.equal(metric.data.denominator,0);assert.equal(metric.data.rate,null);
  assert.equal((await call('/metrics/first-contact?from=2026-09-20&to=2026-09-01',{cookie:staff})).status,422);
});

test('첫 연락 KPI는 최초 기한·실제 시각 기준이며 연장·종료·제외로 분모가 사라지지 않는다',async t=>{
  const db=await openDatabase({url:'',directory:''});t.after(()=>db.close());
  const c=await provision(db,{password:'Metric-test-only'}),user={tenantId:c.tenantId,id:c.staffId,role:'staff'};
  let now=new Date('2026-09-11T06:00:00Z');const service=createService(db,()=>now),ops=operationService(db,()=>now);
  const cases=[];for(let i=0;i<3;i++)cases.push((await service.intake('local-review',{...inquiry,name:`지표 검수 ${i}`},randomUUID())).receiptId);
  now=new Date('2026-09-14T08:10:00Z');
  const [a,b,d]=await Promise.all(cases.map(id=>service.detail(user,id)));
  await service.updateTask(user,cases[0],a.tasks[0].id,'contact',{taskId:a.tasks[0].id,outcome:'sms',actualAt:'2026-09-14T08:00:00Z',expectedVersion:1},randomUUID());
  await service.updateTask(user,cases[1],b.tasks[0].id,'contact',{taskId:b.tasks[0].id,outcome:'connected',actualAt:'2026-09-14T08:05:00Z',expectedVersion:1},randomUUID());
  await service.updateTask(user,cases[2],d.tasks[0].id,'due',{date:'2026-09-20',reason:'기한 연장',expectedVersion:1},randomUUID());
  await service.updateTask(user,cases[2],d.tasks[0].id,'exclude',{reason:'관리 제외',expectedVersion:2},randomUUID());
  const version=(await service.detail(user,cases[2])).salesCase.version;
  const closing=await service.proposeChange(user,cases[2],{type:'close',reason:'진행하지 않음',expectedVersion:version},randomUUID());
  await service.decideChange(user,closing.id,'approve',{expectedCaseVersion:version,expectedProposalVersion:1,confirmed:true},randomUUID());
  await service.intake('local-review',inquiry,randomUUID());
  const m=await ops.firstContactMetrics(user,{from:'2026-09-14',to:'2026-09-15'});
  assert.equal(m.denominator,3);assert.equal(m.onTime,1);assert.equal(m.late,1);assert.equal(m.incomplete,1);assert.equal(m.excluded,1);assert.equal(m.notYetDue,1);assert.equal(m.sms,1);assert.equal(m.connected,1);assert.ok(Math.abs(m.rate-100/3)<1e-9);
  assert.equal((await ops.firstContactMetrics({tenantId:randomUUID(),id:randomUUID(),role:'admin'},{from:'2026-09-14',to:'2026-09-15'})).denominator,0);
  const exact=await ops.firstContactMetrics(user,{from:'2026-09-14',to:'2026-09-14'});assert.equal(exact.totalItems,3);
  await service.updateTask(user,cases[0],a.tasks[0].id,'reopen',{reason:'잘못된 완료 기록 취소',expectedVersion:2},randomUUID());
  assert.equal((await ops.firstContactMetrics(user,{from:'2026-09-14',to:'2026-09-14'})).onTime,0);
});
