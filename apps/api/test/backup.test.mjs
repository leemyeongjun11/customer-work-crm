import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {openDatabase} from '../src/db.mjs';
import {provision} from '../src/setup.mjs';
import {login} from '../src/auth.mjs';
import {createService} from '../src/service.mjs';
import {backupService,companySnapshot,sealBackup,unsealBackup,restoreIntoEmpty,restoreToNewDirectory} from '../src/backup.mjs';
import {makeServer} from '../src/server.mjs';

async function temp(t){const root=await mkdtemp(join(tmpdir(),'crm-backup-test-'));t.after(async()=>{assert.equal(dirname(resolve(root)),resolve(tmpdir()));assert.ok(basename(root).startsWith('crm-backup-test-'));await rm(root,{recursive:true,force:true});});return root;}
const inquiry={customerType:'company',name:'백업 검수 업체',person:'예시 담당자',phone:'010-0000-0000',email:'backup@example.com',memo:'시설 점검 요청'};

test('회사별 암호화 백업·중복 요청·실제 파일 복원·세션 제외·대기 알림 보류',async t=>{
  const root=await temp(t),db=await openDatabase({url:'',directory:''});t.after(()=>db.close());
  const c=await provision(db,{password:'Backup-test-only'}),foreign=await provision(db,{password:'Foreign-backup-only',slug:'foreign-backup',adminEmail:'foreign@crm.local',staffEmail:'foreign-staff@crm.local'});
  const admin={tenantId:c.tenantId,id:c.adminId,role:'admin'},staff={tenantId:c.tenantId,id:c.staffId,role:'staff'},service=createService(db);
  const receipt=await service.intake('local-review',inquiry,randomUUID());await service.intake('foreign-backup',{...inquiry,name:'다른 회사의 고객'},randomUUID());
  await service.addNote(staff,receipt.receiptId,{body:'백업할 상담 메모',expectedVersion:1},randomUUID());
  await login(db,'staff@crm.local','Backup-test-only');
  const backups=backupService(db,{directory:join(root,'backups')}),key=randomUUID();
  await assert.rejects(backups.create(staff,{reason:'권한 검사'},key),e=>e.status===403);
  const result=await backups.create(admin,{reason:'수정 전 데이터 보관'},key);assert.equal(result.status,'ready');assert.equal(result.counts.crm_cases,1);assert.equal(result.counts.crm_users,2);
  assert.deepEqual(await backups.create(admin,{reason:'수정 전 데이터 보관'},key),result);
  await assert.rejects(backups.create(admin,{reason:'다른 이유'},key),e=>e.status===409);
  assert.equal((await backups.list({...admin,tenantId:foreign.tenantId})).items.length,0);
  const file=join(root,'backups',result.filename),keyFile=join(root,'backups','backup.key'),bytes=await readFile(file);
  assert.ok(!bytes.toString().includes(inquiry.name));assert.ok(!bytes.toString().includes('password_hash'));
  const restored=await restoreToNewDirectory({file,keyFile,directory:join(root,'restored')});assert.equal(restored.sessionsRestored,0);assert.equal(restored.counts.crm_cases,1);
  const reopened=await openDatabase({url:'',directory:join(root,'restored')});
  try{
    const detail=await createService(reopened).detail(staff,receipt.receiptId);assert.equal(detail.salesCase.original.memo,inquiry.memo);assert.equal(detail.notes[0].body,'백업할 상담 메모');
    assert.equal((await reopened.query('SELECT count(*)::int AS n FROM crm_sessions')).rows[0].n,0);
    assert.ok((await reopened.query('SELECT status FROM crm_notification_jobs')).rows.every(j=>j.status==='blocked'));
    assert.equal((await login(reopened,'staff@crm.local','Backup-test-only')).user.id,c.staffId);
  }finally{await reopened.close();}
  await assert.rejects(restoreToNewDirectory({file,keyFile,directory:join(root,'restored')}),e=>e.code==='EEXIST');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM crm_cases')).rows[0].n,2);
  assert.ok((await db.query('SELECT status FROM crm_notification_jobs')).rows.every(j=>j.status==='queued'));
});

test('손상·잘못된 키·구조 불일치·기존 DB 덮어쓰기와 복원 중간 실패 차단',async t=>{
  const db=await openDatabase({url:'',directory:''}),empty=await openDatabase({url:'',directory:''});t.after(async()=>{await db.close();await empty.close();});
  const c=await provision(db,{password:'Backup-invalid-test'}),snapshot=await companySnapshot(db,c.tenantId),key=randomBytes(32),bytes=sealBackup(snapshot,key);
  assert.throws(()=>unsealBackup(bytes,randomBytes(32)),e=>e.status===422);
  const corrupt=JSON.parse(bytes.toString());corrupt.tag=Buffer.alloc(16).toString('base64');assert.throws(()=>unsealBackup(Buffer.from(JSON.stringify(corrupt)),key),e=>e.status===422);
  await assert.rejects(restoreIntoEmpty(db,snapshot),e=>e.status===409);
  await assert.rejects(restoreIntoEmpty(empty,{...snapshot,schemaHash:'wrong'}),e=>e.status===409);
  const altered=JSON.parse(JSON.stringify(snapshot));altered.data.crm_users[0].tenant_id=randomUUID();
  await assert.rejects(restoreIntoEmpty(empty,altered),e=>e.status===422);
  assert.equal((await empty.query('SELECT count(*)::int AS n FROM crm_tenants')).rows[0].n,0);
  await restoreIntoEmpty(empty,snapshot);assert.equal((await empty.query('SELECT count(*)::int AS n FROM crm_users')).rows[0].n,2);
});

test('백업 API의 인증·직원 차단·허용 필드·실패 기록과 비밀값 비노출',async t=>{
  const root=await temp(t),db=await openDatabase({url:'',directory:''});const c=await provision(db,{password:'Backup-http-only'});
  const badDirectory=join(root,'not-a-folder');await writeFile(badDirectory,'occupied');
  const server=makeServer(db,{backupDirectory:badDirectory});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{server.closeStreams();server.closeIdleConnections();await new Promise(r=>server.close(r));await db.close();});
  const origin=`http://127.0.0.1:${server.address().port}`,path='/api/v1/admin/backups';
  async function call(cookie,body){const r=await fetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json','Idempotency-Key':randomUUID(),...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};}
  const cookie=async email=>`crm_session=${(await login(db,email,'Backup-http-only')).token}`;
  assert.equal((await call()).status,401);assert.equal((await call(await cookie('staff@crm.local'))).status,403);
  const admin=await cookie('admin@crm.local');assert.equal((await call(admin,{reason:'검수',tenantId:c.tenantId})).status,422);
  assert.equal((await call(admin,{reason:'저장 실패 확인'})).status,503);
  const listed=(await call(admin)).data;assert.equal(listed.items[0].status,'failed');assert.equal(listed.items[0].filename,null);assert.ok(!JSON.stringify(listed).includes('request_key'));assert.ok(!JSON.stringify(listed).includes(badDirectory));
});
