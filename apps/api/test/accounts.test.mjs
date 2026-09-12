import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/db.mjs';
import {provision} from '../src/setup.mjs';
import {makeServer} from '../src/server.mjs';
import {accountService} from '../src/accounts.mjs';
import {createService} from '../src/service.mjs';
import {operationService} from '../src/operations.mjs';
import {companySnapshot,restoreIntoEmpty} from '../src/backup.mjs';

test('계정 HTTP 권한·회사 격리·인계 차단·세션 폐기·재개·중복·충돌·기록 보존',async t=>{
  const db=await openDatabase({url:'',directory:''}),password='Accounts-test-only';
  const c=await provision(db,{password}),other=await provision(db,{password,slug:'other-accounts',adminEmail:'other@crm.local',staffEmail:'other-staff@crm.local'});
  const server=makeServer(db);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeIdleConnections();await new Promise(r=>server.close(r));await db.close();});
  const origin=`http://127.0.0.1:${server.address().port}`;
  async function call(path,{method='GET',body,cookie,key=randomUUID()}={}){const r=await fetch(origin+'/api/v1'+path,{method,headers:{Origin:origin,'Content-Type':'application/json','Idempotency-Key':key,...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
  const admin=(await call('/auth/login',{method:'POST',body:{email:'admin@crm.local',password}})).cookie,staff=(await call('/auth/login',{method:'POST',body:{email:'staff@crm.local',password}})).cookie;
  assert.equal((await call('/admin/users')).status,401);assert.equal((await call('/admin/users',{cookie:staff})).status,403);
  const roster=(await call('/admin/users',{cookie:admin})).data;assert.equal(roster.items.length,2);assert.ok(!JSON.stringify(roster).includes('password'));
  assert.equal((await call(`/admin/users/${other.staffId}/preview`,{cookie:admin})).status,404);
  assert.equal((await call(`/admin/users/${'a'.repeat(36)}/preview`,{cookie:admin})).status,404);
  const path=`/admin/users/${c.staffId}/status`,body={active:false,expectedVersion:1,reason:'업무 인계 후 사용 중지',confirmed:true};
  assert.equal((await call(path,{method:'POST',cookie:staff,body})).status,403);
  assert.equal((await call(`/admin/users/${c.adminId}/status`,{method:'POST',cookie:admin,body})).status,403);
  assert.equal((await call(path,{method:'POST',cookie:admin,body:{...body,role:'admin'}})).status,422);
  assert.equal((await call(path,{method:'POST',cookie:admin,body})).status,409);
  const actor={tenantId:c.tenantId,id:c.adminId,role:'admin'},service=createService(db);
  const receipt=await service.intake('local-review',{customerType:'person',name:'인계 검수 고객',phone:'010-0000-0000',email:'handoff@example.com',memo:'서비스 상담'},randomUUID());
  await operationService(db).updateSettings(actor,{defaultAssigneeId:c.adminId,holidays:[],expectedVersion:1,reason:'신규 접수 인계',confirmed:true},randomUUID());
  let preview=(await call(`/admin/users/${c.staffId}/preview`,{cookie:admin})).data;assert.equal(preview.openCount,1);assert.equal(preview.isDefault,false);
  assert.equal((await call(path,{method:'POST',cookie:admin,body})).status,409);
  const proposal=await service.proposeChange(actor,receipt.receiptId,{type:'reassign',proposedAssigneeId:c.adminId,reason:'직원 업무 인계',expectedVersion:1},randomUUID());
  const p=await service.previewChange(actor,proposal.id);await service.decideChange(actor,proposal.id,'approve',{expectedCaseVersion:p.salesCase.version,expectedProposalVersion:p.proposal.version,confirmed:true},randomUUID());
  const key=randomUUID(),saved=await call(path,{method:'POST',cookie:admin,body,key});assert.equal(saved.status,200,JSON.stringify(saved));assert.equal(saved.data.active,false);assert.equal(saved.data.version,2);
  assert.deepEqual((await call(path,{method:'POST',cookie:admin,body,key})).data,saved.data);
  assert.equal((await call(path,{method:'POST',cookie:admin,body:{...body,reason:'다른 이유'},key})).status,409);
  assert.equal((await call('/auth/me',{cookie:staff})).status,401);
  assert.equal((await call('/auth/login',{method:'POST',body:{email:'staff@crm.local',password}})).status,401);
  assert.ok(!(await service.assignees(actor)).items.some(u=>u.id===c.staffId));
  const enable={...body,active:true,expectedVersion:2,reason:'동일 직원 사용 재개'};
  const races=await Promise.all([1,2].map(()=>call(path,{method:'POST',cookie:admin,body:enable})));assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);
  assert.equal((await call('/auth/me',{cookie:staff})).status,401);
  assert.equal((await call('/auth/login',{method:'POST',body:{email:'staff@crm.local',password}})).status,200);
  assert.equal((await call('/admin/users',{cookie:admin})).data.history.length,2);
  assert.equal((await service.detail(actor,receipt.receiptId)).salesCase.assigneeId,c.adminId);
  const snapshot=await companySnapshot(db,c.tenantId);assert.equal(snapshot.data.crm_account_history.length,2);
  const restored=await openDatabase({url:'',directory:''});try{const result=await restoreIntoEmpty(restored,snapshot);assert.equal(result.counts.crm_account_history,2);}finally{await restored.close();}
});

test('이전 전달 버전의 백업을 새 계정 구조로 복원하고 알 수 없는 구조는 차단',async t=>{
  const db=await openDatabase({url:'',directory:''});t.after(()=>db.close());const c=await provision(db,{password:'Backup-upgrade-test'});
  const snapshot=await companySnapshot(db,c.tenantId),old=structuredClone(snapshot);old.schemaHash='ab3935611413d6d1be019b35bd1dffd04cbd45cdb28b839f1391f6c3046ab1b8';delete old.data.crm_account_history;for(const u of old.data.crm_users)delete u.version;
  const restored=await openDatabase({url:'',directory:''});try{await assert.rejects(restoreIntoEmpty(restored,{...old,schemaHash:'unknown'}),e=>e.status===409);await restoreIntoEmpty(restored,old);assert.equal((await restored.query('SELECT version FROM crm_users')).rows[0].version,1);assert.equal((await restored.query('SELECT * FROM crm_account_history')).rows.length,0);}finally{await restored.close();}
  const accounts=accountService(db);assert.equal((await accounts.list({tenantId:c.tenantId,id:c.adminId,role:'admin'})).items.length,2);
});
