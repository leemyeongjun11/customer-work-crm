import {randomUUID} from 'node:crypto';
import {kstDate, iso, requireValue} from './rules.mjs';

export async function enqueue(tx,{tenantId,caseId=null,recipientId=null,kind,date=null,key,at}){
  const id=randomUUID();
  const result=await tx.query('INSERT INTO crm_notification_jobs(id,tenant_id,case_id,recipient_id,kind,business_date,dedupe_key,next_run,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$8) ON CONFLICT(tenant_id,dedupe_key) DO NOTHING RETURNING id',[id,tenantId,caseId,recipientId,kind,date,key,at]);
  return result.rows[0]?.id;
}
export const businessDay=(day,holidays=[])=>![0,6].includes(new Date(`${day}T00:00:00Z`).getUTCDay())&&!holidays.includes(day);
const minuteOfDay=at=>{const date=new Date(new Date(at).getTime()+9*3600000);return date.getUTCHours()*60+date.getUTCMinutes();};
const heartbeat=(tx,name,at)=>tx.query("INSERT INTO crm_runtime_state(name,last_tick) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET last_tick=$2,error=''",[name,at]);

export async function scheduleNotifications(db,at=new Date().toISOString()){
  const day=kstDate(at),minutes=minuteOfDay(at);
  return db.transaction(async tx=>{
    const tenants=await tx.query('SELECT * FROM crm_tenants ORDER BY id FOR UPDATE');let added=0;
    for(const tenant of tenants.rows){
      if(!businessDay(day,tenant.holidays))continue;
      const users=await tx.query('SELECT id FROM crm_users WHERE tenant_id=$1 AND active=true ORDER BY id',[tenant.id]);
      for(const [kind,start]of [['daily',900],['first_reminder',990]]){
        if(minutes<start)continue;
        for(const user of users.rows){
          const id=await enqueue(tx,{tenantId:tenant.id,recipientId:user.id,kind,date:day,key:`${kind}:${day}:${user.id}`,at});
          if(id){added++;if(minutes>=1020)await tx.query("UPDATE crm_notification_jobs SET status='skipped',reason='17시 이후 복구: 오래된 당일 알림 생략' WHERE id=$1",[id]);}
        }
      }
    }
    await heartbeat(tx,'scheduler',at);return {added};
  });
}

function nextFailure(error,attempt,at){
  const code=error?.kind;
  if(code==='auth')return {status:'blocked',reason:'인증 확인 필요',next:at};
  if(code==='unknown')return {status:'unknown',reason:'처리 결과 확인 필요 · 자동 재실행 중단',next:at};
  if(code==='invalid')return {status:'failed',reason:'데이터 또는 응답 형식 확인 필요',next:at};
  if(code==='transient'||code==='rate'){
    if(attempt>=3)return {status:'failed',reason:'총 3회 시도 후 중단 · 수동 확인 필요',next:at};
    const delay=Math.max(60000*2**(attempt-1),Number.isFinite(error.retryAfterMs)?error.retryAfterMs:0);
    return {status:'retry',reason:code==='rate'?'요청 제한 · 안내 시각까지 대기':'일시 실패 · 재시도 대기',next:new Date(Date.parse(at)+delay).toISOString()};
  }
  return {status:'failed',reason:'내부 처리 오류 · 관리자 확인 필요',next:at};
}

async function compose(tx,job,at){
  if(job.kind==='receipt'||job.kind==='assignment'){
    const result=await tx.query('SELECT c.*,u.name AS owner_name,u.email AS owner_email,u.active AS owner_active FROM crm_cases c JOIN crm_users u ON u.id=c.assignee_id WHERE c.tenant_id=$1 AND c.id=$2',[job.tenant_id,job.case_id]);
    const c=result.rows[0];if(!c)return null;
    if(job.kind==='receipt')return {recipient:c.original.email,recipientId:null,subject:'상담 요청이 접수되었습니다',body:`${c.original.name}님, 상담 요청이 접수되었습니다. 담당자가 확인 후 연락드리겠습니다.\n접수 번호: ${c.id}`};
    if(!c.owner_active||['종료','서비스 완료'].includes(c.stage))return null;
    const first=(await tx.query("SELECT due_at,status,excluded FROM crm_tasks WHERE case_id=$1 AND kind='first'",[c.id])).rows[0];
    if(!first||first.status==='complete'||first.excluded)return null;
    return {recipient:c.owner_email,recipientId:c.assignee_id,subject:`신규 상담 배정 · ${c.name}`,body:`담당자: ${c.owner_name}\n고객: ${c.name}\n업무: 신규 상담 첫 연락\n기한: ${displayDate(first.due_at)}\nhttp://127.0.0.1:4180/live/cases/${c.id}`};
  }
  const user=(await tx.query('SELECT * FROM crm_users WHERE id=$1 AND tenant_id=$2 AND active=true',[job.recipient_id,job.tenant_id])).rows[0];if(!user)return null;
  const day=kstDate(at),scheduled=job.kind!=='review';
  if(scheduled){
    const tenant=(await tx.query('SELECT holidays FROM crm_tenants WHERE id=$1',[job.tenant_id])).rows[0];
    if(day!==new Date(job.business_date).toISOString().slice(0,10)||minuteOfDay(at)>=1020||!businessDay(day,tenant.holidays))return null;
  }
  const rows=(await tx.query("SELECT t.*,c.name FROM crm_tasks t JOIN crm_cases c ON c.id=t.case_id WHERE t.tenant_id=$1 AND c.tenant_id=$1 AND c.assignee_id=$2 AND c.stage NOT IN ('종료','서비스 완료') AND t.status='incomplete' AND NOT t.excluded ORDER BY t.due_at NULLS LAST,t.id",[job.tenant_id,user.id])).rows;
  const tasks=rows.filter(t=>job.kind==='first_reminder'?t.kind==='first'&&t.due_at&&kstDate(t.due_at)===day:t.due_at&&(Date.parse(t.due_at)<Date.parse(at)||kstDate(t.due_at)===day));
  tasks.sort((a,b)=>Number(b.kind==='first'&&Date.parse(b.due_at)<Date.parse(at))-Number(a.kind==='first'&&Date.parse(a.due_at)<Date.parse(at))||Date.parse(a.due_at)-Date.parse(b.due_at));
  const missing=job.kind==='review'?(await tx.query("SELECT c.id,c.name FROM crm_cases c WHERE c.tenant_id=$1 AND c.assignee_id=$2 AND c.stage NOT IN ('종료','서비스 완료') AND NOT EXISTS(SELECT 1 FROM crm_tasks t WHERE t.case_id=c.id AND t.status='incomplete' AND NOT t.excluded) ORDER BY c.received_at,c.id",[job.tenant_id,user.id])).rows:[];
  const noDate=job.kind==='review'?rows.filter(t=>!t.due_at):[];
  if(!tasks.length&&!missing.length&&!noDate.length)return null;
  const title=job.kind==='first_reminder'?'오늘 마감 첫 연락 알림':job.kind==='review'?'현재 업무 알림 미리보기':'오늘 업무 통합 알림';
  const items=tasks.map(t=>`- ${t.name} / ${t.title} / ${displayDate(t.due_at)}\n  http://127.0.0.1:4180/live/cases/${t.case_id}`);
  items.push(...noDate.map(t=>`- [기한 확인 필요] ${t.name} / ${t.title}\n  http://127.0.0.1:4180/live/cases/${t.case_id}`),...missing.map(c=>`- [다음 행동 없음] ${c.name}\n  http://127.0.0.1:4180/live/cases/${c.id}`));
  return {recipient:user.email,recipientId:user.id,subject:`${title} · ${items.length}건`,body:`${user.name}님, 아래 업무를 확인해 주세요.\n\n${items.join('\n\n')}`};
}
function displayDate(value){return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'}).format(new Date(value));}

// This provider writes only to the local review inbox. It never sends email.
export async function processNotification(db,{at=new Date().toISOString(),beforeStore}={}){
  return db.transaction(async tx=>{
    const {rows}=await tx.query("SELECT * FROM crm_notification_jobs WHERE status IN ('queued','retry') AND next_run<=$1 ORDER BY next_run,created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",[at]);
    const job=rows[0];if(!job){await heartbeat(tx,'worker',at);return null;}
    const attempt=job.attempts+1;
    await tx.query('UPDATE crm_notification_jobs SET attempts=$2,updated_at=$3 WHERE id=$1',[job.id,attempt,at]);
    await tx.query('SAVEPOINT review_delivery');
    try{
      const message=await compose(tx,job,at);
      if(!message)await tx.query("UPDATE crm_notification_jobs SET status='skipped',reason='실행 시점의 대상 없음 또는 유효 시간 경과' WHERE id=$1",[job.id]);
      else {
        if(beforeStore)await beforeStore(job,message);
        await tx.query('INSERT INTO crm_review_mail(id,job_id,tenant_id,recipient_id,recipient,subject,body,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(job_id) DO NOTHING',[randomUUID(),job.id,job.tenant_id,message.recipientId,message.recipient,message.subject,message.body,at]);
        await tx.query("UPDATE crm_notification_jobs SET status='reviewed',recipient_id=$2,reason='검수함 저장 완료 · 실제 이메일 미발송' WHERE id=$1",[job.id,message.recipientId]);
      }
    }catch(error){
      await tx.query('ROLLBACK TO SAVEPOINT review_delivery');
      const failure=nextFailure(error,attempt,at);
      await tx.query('UPDATE crm_notification_jobs SET status=$2,reason=$3,next_run=$4 WHERE id=$1',[job.id,failure.status,failure.reason,failure.next]);
    }
    await tx.query('RELEASE SAVEPOINT review_delivery');await heartbeat(tx,'worker',at);return {id:job.id};
  });
}

export function notificationService(db,clock=()=>new Date()){
  return {
    async reviewNow(user,key){
      requireValue(typeof key==='string'&&/^[A-Za-z0-9_-]{8,128}$/.test(key),'중복 방지 키가 필요합니다.');
      return db.transaction(async tx=>{
        const at=clock().toISOString(),dedupe=`review:${user.id}:${key}`;
        await enqueue(tx,{tenantId:user.tenantId,recipientId:user.id,kind:'review',key:dedupe,at});
        const job=(await tx.query('SELECT id,status FROM crm_notification_jobs WHERE tenant_id=$1 AND dedupe_key=$2',[user.tenantId,dedupe])).rows[0];return job;
      });
    },
    async inbox(user){
      const jobs=await db.query("SELECT id,kind,status,attempts,reason,created_at,updated_at,next_run FROM crm_notification_jobs WHERE tenant_id=$1 AND ($2='admin' OR recipient_id=$3) ORDER BY created_at DESC,id LIMIT 100",[user.tenantId,user.role,user.id]);
      const mail=await db.query("SELECT id,recipient,subject,body,created_at FROM crm_review_mail WHERE tenant_id=$1 AND ($2='admin' OR recipient_id=$3) ORDER BY created_at DESC,id LIMIT 100",[user.tenantId,user.role,user.id]);
      const runtime=await db.query('SELECT name,last_tick,error FROM crm_runtime_state ORDER BY name');
      return {mode:'review_only',externalSending:false,jobs:jobs.rows.map(j=>({...j,created_at:iso(j.created_at),updated_at:iso(j.updated_at),next_run:iso(j.next_run)})),messages:mail.rows.map(m=>({...m,created_at:iso(m.created_at)})),runtime:runtime.rows};
    },
  };
}
