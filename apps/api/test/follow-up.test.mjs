import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/db.mjs';
import {provision} from '../src/setup.mjs';
import {createService} from '../src/service.mjs';
import {companySnapshot,restoreIntoEmpty} from '../src/backup.mjs';

test('완료 뒤 진행 승인, 같은 요청 연결, 이력·검색·권한·백업 보존',async t=>{
  const db=await openDatabase({url:'',directory:''});t.after(()=>db.close());
  const org=await provision(db,{password:'Only-local-testing'});
  const user={tenantId:org.tenantId,id:org.staffId,role:'staff'},admin={...user,id:org.adminId,role:'admin'};
  const svc=createService(db,()=>new Date('2026-09-13T08:00:00Z'));
  const key=()=>randomUUID();
  const inquiry={customerType:'company',name:'같은 업체',person:'김담당',phone:'010-1111-1111',email:'kim@example.com',memo:'2층 에어컨 3대 점검'};
  const first=await svc.intake('local-review',inquiry,key()),second=await svc.intake('local-review',{...inquiry,person:'박담당',phone:'010-2222-2222',email:'park@example.com'},key());
  const a=first.receiptId,b=second.receiptId;
  async function contact(id){const d=await svc.detail(user,id);await svc.updateTask(user,id,d.tasks[0].id,'contact',{outcome:'connected',actualAt:'2026-09-13T08:00:00Z',memo:'같은 부서의 2층 에어컨 점검 문의',expectedVersion:d.tasks[0].version},key());}
  await contact(a);await contact(b);
  assert.equal((await svc.detail(user,a)).salesCase.followUp.cause,'consultation');
  const plan={expectedVersion:2,stage:'제안·협의',situation:'견적 요청',createTask:true,taskType:'quote',description:'점검 견적 전달',date:'2026-09-15',confirmed:true};
  const planKey=key(),planned=await svc.followUp(user,a,plan,planKey);
  assert.deepEqual(await svc.followUp(user,a,plan,planKey),planned);
  let d=await svc.detail(user,a);assert.equal(d.salesCase.stage,'제안·협의');assert.equal(d.salesCase.followUp,null);assert.equal(d.tasks.length,2);
  const quote=d.tasks.find(t=>t.kind==='work');await svc.updateTask(user,a,quote.id,'complete',{actualAt:'2026-09-13T08:00:00Z',memo:'견적 발송 완료',expectedVersion:quote.version},key());
  d=await svc.detail(user,a);assert.equal(d.salesCase.followUp.taskType,'quote');
  await assert.rejects(svc.followUp(user,a,{...plan,expectedVersion:3},key()),e=>e.status===409);
  await svc.followUp(user,a,{...plan,expectedVersion:d.salesCase.version,taskType:'quote-response',description:'견적 회신 확인'},key());
  let source=await svc.detail(user,b);await svc.addTask(user,b,{taskType:'quote-response',description:'견적 회신 확인',date:'2026-09-15',expectedVersion:source.salesCase.version},key());
  source=await svc.detail(user,b);const originalSourceTask=source.tasks.find(t=>t.kind==='work');
  const candidates=await svc.relatedCases(user,b);assert.equal(candidates.items[0].id,a);
  const foreign=await provision(db,{password:'Foreign-test-only',slug:'foreign',adminEmail:'other@example.com',staffEmail:'other-staff@example.com'});
  const outsider={tenantId:foreign.tenantId,id:foreign.adminId,role:'admin'};
  await assert.rejects(svc.relatedCases(outsider,b),e=>e.status===404);
  const target=await svc.detail(user,a),merge={targetId:a,expectedVersion:source.salesCase.version,targetVersion:target.salesCase.version,keepTaskIds:[],confirmed:true,reason:'같은 부서의 같은 설비 점검 요청'};
  await assert.rejects(svc.linkCases(outsider,b,merge,key()),e=>e.status===404);
  await assert.rejects(svc.linkCases(user,b,{...merge,targetVersion:1},key()),e=>e.status===409);
  assert.equal((await svc.detail(user,b)).salesCase.stage,'상담 진행');
  const mk=key(),merged=await svc.linkCases(user,b,merge,mk);assert.deepEqual(await svc.linkCases(user,b,merge,mk),merged);
  assert.deepEqual(await svc.detail(user,b),{redirectId:a});
  d=await svc.detail(user,a);assert.equal(d.linkedContacts[0].person,'박담당');assert.ok(d.notes.some(n=>n.sourcePerson==='박담당'));assert.ok(d.activities.some(n=>n.sourcePerson==='박담당'));
  assert.ok(d.tasks.find(t=>t.id===originalSourceTask.id).excluded);assert.equal(d.tasks.filter(t=>t.status==='incomplete'&&!t.excluded).length,1);
  assert.equal((await svc.board(user)).pendingFollowUp.length,1);
  for(const search of ['김담당','박담당','2222','park@example.com'])assert.deepEqual((await svc.cases(user,search)).items.map(c=>c.id),[a]);
  assert.equal((await svc.cases(user)).items.length,1);
  await assert.rejects(svc.addNote(user,b,{body:'이전 주소 직접 수정',expectedVersion:4},key()),e=>e.status===409);
  await assert.rejects(svc.linkCases(user,a,{...merge,targetId:b,expectedVersion:d.salesCase.version},key()),e=>e.status===409);
  // A child URL follows the root's current ownership, not its historical assignee.
  await db.query('UPDATE crm_cases SET assignee_id=$2 WHERE id=$1',[a,org.adminId]);
  await assert.rejects(svc.detail(user,b),e=>e.status===404);assert.equal((await svc.detail(admin,b)).redirectId,a);
  assert.equal((await svc.cases(user,'박담당')).items.length,0);
  const snapshot=await companySnapshot(db,org.tenantId),restored=await openDatabase({url:'',directory:''});t.after(()=>restored.close());
  await restoreIntoEmpty(restored,snapshot);const copy=createService(restored);assert.equal((await copy.detail(admin,b)).redirectId,a);assert.equal((await copy.detail(admin,a)).linkedContacts.length,1);
  // Cancellation is a reviewed transition and does not delete the remaining tasks.
  d=await svc.detail(admin,a);await assert.rejects(svc.followUp(admin,a,{...plan,expectedVersion:d.salesCase.version,stage:'종료',createTask:false,confirmed:false},key()));
  await svc.followUp(admin,a,{...plan,expectedVersion:d.salesCase.version,stage:'종료',createTask:false},key());
  assert.equal((await svc.board(admin)).upcoming.length,0);assert.ok((await svc.detail(admin,a)).tasks.length>=3);
});
