import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/db.mjs';
import {provision} from '../src/setup.mjs';
import {createService} from '../src/service.mjs';
import {scheduleNotifications,processNotification,notificationService,enqueue} from '../src/notifications.mjs';
import {runWorker} from '../../worker/src/run.mjs';

async function setup(t){
  const db=await openDatabase({url:'',directory:''});t.after(()=>db.close());
  const company=await provision(db,{password:'Notification-test-only'});
  const staff={id:company.staffId,tenantId:company.tenantId,role:'staff'},admin={id:company.adminId,tenantId:company.tenantId,role:'admin'};
  let at='2026-09-14T05:59:00.000Z';
  const service=createService(db,()=>new Date(at)),notifications=notificationService(db,()=>new Date(at));
  const inquiry={customerType:'person',name:'알림 검수 고객',phone:'010-0000-0000',email:'customer@example.com',memo:'초기 요청 원문은 직원 통합 알림에 포함하지 않습니다.'};
  const receipt=await service.intake('local-review',inquiry,randomUUID()),id=receipt.receiptId;
  const detail=await service.detail(staff,id),task=detail.tasks[0];
  return {db,company,staff,admin,service,notifications,id,task,receipt,setTime:value=>{at=value;}};
}

test('예약 시각·휴일·대상 재검증·수신자별 중복 방지와 다음 행동 누락',async t=>{
  const {db,company,staff,admin,service,notifications,id,task,setTime}=await setup(t);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM crm_notification_jobs')).rows[0].n,2);
  await runWorker(db,'2026-09-14T05:59:00Z');
  assert.equal((await notifications.inbox(admin)).messages.length,2);
  assert.equal((await notifications.inbox(staff)).messages.length,1);
  assert.equal((await notifications.inbox({id:randomUUID(),tenantId:randomUUID(),role:'admin'})).messages.length,0);
  await service.updateTask(staff,id,task.id,'due',{date:'2026-09-14',reason:'오늘 연락 요청',expectedVersion:1},randomUUID());
  let version=(await service.detail(staff,id)).salesCase.version;
  await service.addTask(staff,id,{taskType:'quote',date:'2026-09-11',expectedVersion:version},randomUUID());
  assert.equal((await scheduleNotifications(db,'2026-09-14T05:59:00Z')).added,0);
  await Promise.all([scheduleNotifications(db,'2026-09-14T06:00:00Z'),scheduleNotifications(db,'2026-09-14T06:00:00Z')]);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM crm_notification_jobs WHERE kind='daily'")).rows[0].n,2);
  await Promise.all([runWorker(db,'2026-09-14T06:00:00Z'),runWorker(db,'2026-09-14T06:00:00Z')]);
  let inbox=await notifications.inbox(staff),daily=inbox.messages.filter(m=>m.subject.includes('통합 알림'));
  assert.equal(daily.length,1);assert.match(daily[0].body,/신규 상담 첫 연락/);assert.match(daily[0].body,/견적서/);
  assert.ok(!daily[0].body.includes('초기 요청 원문은'));
  assert.equal((await scheduleNotifications(db,'2026-09-14T07:29:00Z')).added,0);
  await scheduleNotifications(db,'2026-09-14T07:30:00Z');
  setTime('2026-09-14T07:30:01Z');
  const fresh=await service.detail(staff,id);
  await service.updateTask(staff,id,task.id,'contact',{taskId:task.id,outcome:'connected',actualAt:'2026-09-14T07:30:01Z',expectedVersion:fresh.tasks.find(t=>t.id===task.id).version},randomUUID());
  await runWorker(db,'2026-09-14T07:30:02Z');
  inbox=await notifications.inbox(staff);assert.equal(inbox.messages.filter(m=>m.subject.includes('오늘 마감 첫 연락')).length,0);
  assert.equal(inbox.jobs.find(j=>j.kind==='first_reminder').status,'skipped');
  const work=(await service.detail(staff,id)).tasks.find(t=>t.kind==='work');
  await service.updateTask(staff,id,work.id,'exclude',{reason:'후속 일정을 다시 정하기로 함',expectedVersion:work.version},randomUUID());
  assert.equal((await service.board(staff)).missingNext.length,1);
  const key=randomUUID();const review=await notifications.reviewNow(staff,key);
  assert.equal((await notifications.reviewNow(staff,key)).id,review.id);
  await runWorker(db,'2026-09-14T07:31:00Z');
  assert.match((await notifications.inbox(staff)).messages.find(m=>m.subject.includes('미리보기')).body,/다음 행동 없음/);
  version=(await service.detail(staff,id)).salesCase.version;
  const p=await service.proposeChange(staff,id,{type:'close',reason:'종료 확인',expectedVersion:version},randomUUID());
  await service.decideChange(staff,p.id,'approve',{expectedCaseVersion:version,expectedProposalVersion:1,confirmed:true},randomUUID());
  assert.equal((await service.board(staff)).missingNext.length,0);
  assert.equal((await scheduleNotifications(db,'2026-09-19T06:00:00Z')).added,0);
  await db.query('UPDATE crm_tenants SET holidays=$2 WHERE id=$1',[company.tenantId,JSON.stringify(['2026-09-15'])]);
  assert.equal((await scheduleNotifications(db,'2026-09-15T06:00:00Z')).added,0);
  await scheduleNotifications(db,'2026-09-16T08:05:00Z');
  const late=(await db.query("SELECT status FROM crm_notification_jobs WHERE business_date='2026-09-16'")).rows;
  assert.equal(late.length,4);assert.ok(late.every(j=>j.status==='skipped'));
});

test('재시도 총 3회·인증 중단·결과 불명 중단·요청 제한 대기와 오류 격리',async t=>{
  const {db,staff,service,notifications,id,task,setTime}=await setup(t);
  await runWorker(db,'2026-09-14T05:59:00Z');
  await service.updateTask(staff,id,task.id,'due',{date:'2026-09-14',reason:'오늘 연락',expectedVersion:1},randomUUID());
  setTime('2026-09-14T06:00:00Z');
  const job=await notifications.reviewNow(staff,randomUUID());
  const fail=kind=>()=>{throw Object.assign(new Error('Simulated local provider failure'),{kind,retryAfterMs:120000});};
  await processNotification(db,{at:'2026-09-14T06:00:00Z',beforeStore:fail('transient')});
  assert.equal((await notifications.inbox(staff)).jobs.find(j=>j.id===job.id).status,'retry');
  assert.equal(await processNotification(db,{at:'2026-09-14T06:01:00Z',beforeStore:fail('transient')}),null);
  await processNotification(db,{at:'2026-09-14T06:02:00Z',beforeStore:fail('transient')});
  await processNotification(db,{at:'2026-09-14T06:04:00Z',beforeStore:fail('transient')});
  const final=(await notifications.inbox(staff)).jobs.find(j=>j.id===job.id);
  assert.equal(final.status,'failed');assert.equal(final.attempts,3);
  assert.equal((await service.board(staff)).attentionCount,1);
  for(const [kind,status]of [['auth','blocked'],['unknown','unknown'],['invalid','failed'],['rate','retry']]){
    const j=await notifications.reviewNow(staff,randomUUID());
    await processNotification(db,{at:'2026-09-14T06:00:00Z',beforeStore:fail(kind)});
    const record=(await notifications.inbox(staff)).jobs.find(r=>r.id===j.id);
    assert.equal(record.status,status);assert.equal(record.attempts,1);
    if(kind==='rate')assert.equal(record.next_run,'2026-09-14T06:02:00.000Z');
  }
  assert.equal((await notifications.inbox(staff)).messages.filter(m=>m.subject.includes('미리보기')).length,0);
});

test('발송 직전 재배정 반영 및 종료된 영업건 알림 제외',async t=>{
  const {db,company,staff,admin,service,id,task}=await setup(t);
  const version=(await service.detail(staff,id)).salesCase.version;
  const proposal=await service.proposeChange(admin,id,{type:'reassign',reason:'담당자 변경',proposedAssigneeId:company.adminId,expectedVersion:version},randomUUID());
  await service.decideChange(admin,proposal.id,'approve',{expectedCaseVersion:version,expectedProposalVersion:1,confirmed:true},randomUUID());
  await runWorker(db,'2026-09-14T05:59:00Z');
  const notification=notificationService(db);
  assert.equal((await notification.inbox(staff)).messages.length,0);
  assert.ok((await notification.inbox(admin)).messages.some(m=>m.recipient==='admin@crm.local'&&m.subject.includes('신규 상담 배정')));
  await service.updateTask(admin,id,task.id,'due',{date:'2026-09-14',reason:'당일 처리',expectedVersion:1},randomUUID());
  await scheduleNotifications(db,'2026-09-14T06:00:00Z');
  const v=(await service.detail(admin,id)).salesCase.version;
  const close=await service.proposeChange(admin,id,{type:'close',reason:'진행하지 않음',expectedVersion:v},randomUUID());
  await service.decideChange(admin,close.id,'approve',{expectedCaseVersion:v,expectedProposalVersion:1,confirmed:true},randomUUID());
  await runWorker(db,'2026-09-14T06:00:01Z');
  assert.equal((await notification.inbox(admin)).messages.filter(m=>m.subject.includes('통합 알림')).length,0);
});
