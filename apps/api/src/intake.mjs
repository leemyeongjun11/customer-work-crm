import {randomUUID} from 'node:crypto';
import {fields,requireValue,text,firstDeadline} from './rules.mjs';
import {enqueue} from './notifications.mjs';
import {appendChange} from './changes.mjs';

export function validateInquiry(body) {
  fields(body,['customerType','name','person','phone','email','size','memo']);
  requireValue(['company','person'].includes(body.customerType),'개인 또는 회사를 선택해 주세요.');
  const name=text(body.name,'이름·업체명'),person=body.customerType==='company'?text(body.person,'담당자명'):name;
  const phone=text(body.phone,'연락처',30),email=text(body.email,'이메일',254).toLowerCase();
  requireValue(/^[0-9+() -]{8,30}$/.test(phone),'연락처를 확인해 주세요.');
  requireValue(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'이메일을 확인해 주세요.');
  return {customerType:body.customerType,name,person,phone,email,size:text(body.size,'회사 규모',100,true),memo:text(body.memo,'상담 내용',4000)};
}

// Caller holds the tenant row lock. Case, first task and notification jobs share its transaction.
export async function insertInquiry(tx,tenant,original,{receivedAt,recordedAt,source='public',sourceInquiryId=null}) {
  const owner=await tx.query('SELECT id FROM crm_users WHERE id=$1 AND tenant_id=$2 AND active=true FOR SHARE',[tenant.default_assignee_id,tenant.id]);
  requireValue(owner.rows[0],'접수 담당자 설정을 확인 중입니다. 잠시 후 다시 시도해 주세요.',503);
  const dueAt=firstDeadline(receivedAt,tenant.holidays),id=randomUUID();
  await tx.query('INSERT INTO crm_cases(id,tenant_id,assignee_id,customer_type,name,person,phone,email,size,original,received_at,deadline_policy) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[id,tenant.id,tenant.default_assignee_id,original.customerType,original.name,original.person,original.phone,original.email,original.size,JSON.stringify(original),receivedAt,JSON.stringify({settingsVersion:tenant.settings_version,timeZone:'Asia/Seoul',rule:'next_business_day_17',holidays:tenant.holidays})]);
  await tx.query("INSERT INTO crm_tasks(id,tenant_id,case_id,title,kind,due_at,original_due_at,created_at) VALUES($1,$2,$3,'신규 상담 첫 연락','first',$4,$4,$5)",[randomUUID(),tenant.id,id,dueAt,recordedAt]);
  await tx.query('INSERT INTO crm_audit(id,tenant_id,case_id,actor_id,action,payload,created_at) VALUES($1,$2,$3,NULL,$4,$5,$6)',[randomUUID(),tenant.id,id,'상담 접수·담당자 배정',JSON.stringify({dueAt,assigneeId:tenant.default_assignee_id,source,sourceInquiryId,receivedAt,recordedAt}),recordedAt]);
  await enqueue(tx,{tenantId:tenant.id,caseId:id,kind:'receipt',key:`receipt:${id}`,at:recordedAt});
  await enqueue(tx,{tenantId:tenant.id,caseId:id,recipientId:tenant.default_assignee_id,kind:'assignment',key:`assignment:${id}`,at:recordedAt});
  await appendChange(tx,tenant.id,id,recordedAt);
  return {receiptId:id,receivedAt,firstContactDueAt:dueAt};
}
