import { randomUUID, createHash } from 'node:crypto';
import { ApiError, requireValue, fields, text, dayDeadline, timestamp, iso, kstDate } from './rules.mjs';
import { describeTask } from '../../../packages/domain/task-types.ts';
import {validateInquiry,insertInquiry} from './intake.mjs';
import {appendChange} from './changes.mjs';

const closed = c => ['서비스 완료','종료'].includes(c.stage);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
const hash = body => createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex');
const caseView = c => ({id:c.id,name:c.name,person:c.person,phone:c.phone,email:c.email,size:c.size,customerType:c.customer_type,requestMemo:c.request_memo??c.original.memo,stage:c.stage,assigneeId:c.assignee_id,assigneeName:c.assignee_name,original:c.original,receivedAt:iso(c.received_at),version:c.version});
const proposalView = p => ({id:p.id,type:p.type,reason:p.reason,status:p.status,proposedAssigneeId:p.proposed_assignee_id,version:p.version,caseVersion:p.case_version,createdAt:iso(p.created_at)});
const taskView = t => ({id:t.id,caseId:t.case_id,title:t.title,taskType:t.task_type,description:t.description,kind:t.kind,status:t.status,excluded:t.excluded,dueAt:iso(t.due_at),originalDueAt:iso(t.original_due_at),completedAt:iso(t.completed_at),completedBy:t.completed_by,version:t.version,deadlineStatus:t.due_at?'known':'needs_confirmation'});

export function createService(db, clock = () => new Date()) {
  const now = () => clock().toISOString();
  async function access(tx, user, id, lock = false) {
    requireValue(/^[0-9a-f-]{36}$/i.test(id), '영업건을 찾을 수 없습니다.',404);
    const {rows} = await tx.query(`SELECT c.*,u.name AS assignee_name FROM crm_cases c JOIN crm_users u ON u.id=c.assignee_id WHERE c.id=$1 AND c.tenant_id=$2 AND ($3='admin' OR c.assignee_id=$4) ${lock?'FOR UPDATE OF c':''}`, [id,user.tenantId,user.role,user.id]);
    requireValue(rows[0], '영업건을 찾을 수 없거나 접근 권한이 없습니다.',404);
    return rows[0];
  }
  async function audit(tx, tenantId, caseId, actorId, action, payload) {
    await tx.query('INSERT INTO crm_audit(id,tenant_id,case_id,actor_id,action,payload,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [randomUUID(),tenantId,caseId,actorId,action,JSON.stringify(payload),now()]);
    await appendChange(tx,tenantId,caseId,now(),payload.beforeAssigneeId||null);
  }
  async function once(tx, tenantId, actor, operation, key, body, execute) {
    requireValue(typeof key === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(key), '중복 방지 키가 필요합니다.');
    const values = [tenantId,actor,operation,key];
    const requestHash = hash(body);
    await tx.query('INSERT INTO crm_idempotency(tenant_id,actor_scope,operation,key,request_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [...values, requestHash]);
    const {rows} = await tx.query('SELECT * FROM crm_idempotency WHERE tenant_id=$1 AND actor_scope=$2 AND operation=$3 AND key=$4 FOR UPDATE', values);
    requireValue(rows[0].request_hash === requestHash, '같은 요청 키로 다른 내용을 저장할 수 없습니다.',409);
    if (rows[0].response) return rows[0].response;
    const result = await execute();
    await tx.query('UPDATE crm_idempotency SET response=$5 WHERE tenant_id=$1 AND actor_scope=$2 AND operation=$3 AND key=$4', [...values,JSON.stringify(result)]);
    return result;
  }
  async function writeCase(user, caseId, operation, key, body, execute) {
    return db.transaction(async tx => {
      const c = await access(tx,user,caseId,true);
      return once(tx,user.tenantId,user.id,operation,key,body,async()=> {
        requireValue(!closed(c), '종료된 영업건은 변경할 수 없습니다.',409);
        return execute(tx,c);
      });
    });
  }
  function version(actual, expected) {
    requireValue(Number.isInteger(expected) && expected > 0, '변경할 기록의 버전이 필요합니다.');
    requireValue(actual === expected, '다른 변경이 먼저 저장되었습니다. 최신 내용을 확인하고 다시 입력해 주세요.',409);
  }
  async function proposalAccess(tx,user,id) {
    requireValue(/^[0-9a-f-]{36}$/i.test(id),'변경 요청을 찾을 수 없습니다.',404);
    const {rows}=await tx.query('SELECT * FROM crm_change_proposals WHERE id=$1 AND tenant_id=$2',[id,user.tenantId]);
    requireValue(rows[0],'변경 요청을 찾을 수 없습니다.',404);return rows[0];
  }
  async function targetUser(tx,tenantId,id) {
    requireValue(typeof id==='string'&&/^[0-9a-f-]{36}$/i.test(id),'변경할 담당자를 선택해 주세요.');
    const {rows}=await tx.query('SELECT id,name FROM crm_users WHERE id=$1 AND tenant_id=$2 AND active=true FOR SHARE',[id,tenantId]);
    requireValue(rows[0],'활성 상태인 같은 회사의 담당자를 선택해 주세요.');return rows[0];
  }
  return {
    async assignees(user) {
      requireValue(user.role==='admin','담당자 변경은 관리자만 할 수 있습니다.',403);
      const {rows}=await db.query('SELECT id,name,role FROM crm_users WHERE tenant_id=$1 AND active=true ORDER BY name,id',[user.tenantId]);return {items:rows};
    },
    async updateCustomer(user,id,body,key) {
      fields(body,['customerType','name','person','phone','email','size','requestMemo','reason','expectedVersion']);
      requireValue(['company','person'].includes(body.customerType),'개인 또는 회사를 선택해 주세요.');
      const name=text(body.name,'이름·업체명'),person=body.customerType==='company'?text(body.person,'고객 담당자명'):name;
      const phone=text(body.phone,'연락처',30),email=text(body.email,'이메일',254).toLowerCase();
      requireValue(/^[0-9+() -]{8,30}$/.test(phone),'연락처를 확인해 주세요.');
      requireValue(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'이메일을 확인해 주세요.');
      const size=text(body.size,'회사 규모',100,true),memo=text(body.requestMemo,'고객 요청 내용',4000),reason=text(body.reason,'변경 이유',1000);
      return writeCase(user,id,`customer:${id}`,key,body,async(tx,c)=>{
        version(c.version,body.expectedVersion);
        await tx.query('UPDATE crm_cases SET customer_type=$2,name=$3,person=$4,phone=$5,email=$6,size=$7,request_memo=$8,version=version+1 WHERE id=$1',[id,body.customerType,name,person,phone,email,size,memo]);
        await audit(tx,user.tenantId,id,user.id,'고객 정보 수정',{reason,before:caseView(c),after:{customerType:body.customerType,name,person,phone,email,size,requestMemo:memo}});
        return {id,version:c.version+1};
      });
    },
    async changeStage(user,id,body,key) {
      fields(body,['stage','reason','expectedVersion']);
      requireValue(['접수','상담 진행','제안·협의','계약 완료','서비스 진행'].includes(body.stage),'종료·서비스 완료는 남은 업무를 확인한 뒤 확정해 주세요.');
      const reason=text(body.reason,'변경 이유',1000);
      return writeCase(user,id,`stage:${id}`,key,body,async(tx,c)=>{
        version(c.version,body.expectedVersion);requireValue(c.stage!==body.stage,'현재와 다른 단계를 선택해 주세요.');
        await tx.query('UPDATE crm_cases SET stage=$2,version=version+1 WHERE id=$1',[id,body.stage]);
        await audit(tx,user.tenantId,id,user.id,'영업 단계 변경',{reason,beforeStage:c.stage,afterStage:body.stage});return {id,version:c.version+1};
      });
    },
    async proposeChange(user,id,body,key) {
      fields(body,['type','reason','proposedAssigneeId','expectedVersion']);
      requireValue(['close','service_complete','reassign'].includes(body.type),'변경 종류를 확인해 주세요.');
      requireValue(body.type==='reassign'||body.proposedAssigneeId===undefined,'종료 요청에는 담당자를 지정할 수 없습니다.');
      const reason=text(body.reason,'변경 이유',1000);
      return writeCase(user,id,`proposal:${id}`,key,body,async(tx,c)=>{
        version(c.version,body.expectedVersion);
        if(body.type==='reassign'){await targetUser(tx,user.tenantId,body.proposedAssigneeId);requireValue(c.assignee_id!==body.proposedAssigneeId,'현재와 다른 담당자를 선택해 주세요.');}
        const proposalId=randomUUID();
        await tx.query('INSERT INTO crm_change_proposals(id,tenant_id,case_id,type,reason,proposed_assignee_id,case_version,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[proposalId,user.tenantId,id,body.type,reason,body.proposedAssigneeId||null,c.version,user.id,now()]);
        await audit(tx,user.tenantId,id,user.id,'변경 확인 요청',{proposalId,type:body.type,reason,proposedAssigneeId:body.proposedAssigneeId||null});
        return {id:proposalId,status:'pending',version:1,caseVersion:c.version};
      });
    },
    async previewChange(user,id) {
      return db.transaction(async tx=>{
        const p=await proposalAccess(tx,user,id),c=await access(tx,user,p.case_id,true);
        const tasks=await tx.query("SELECT * FROM crm_tasks WHERE tenant_id=$1 AND case_id=$2 AND status='incomplete' AND NOT excluded ORDER BY created_at,id",[user.tenantId,c.id]);
        const target=p.type==='reassign'?(await tx.query('SELECT id,name,active FROM crm_users WHERE tenant_id=$1 AND id=$2',[user.tenantId,p.proposed_assignee_id])).rows[0]:null;
        return {proposal:proposalView(p),salesCase:caseView(c),openTasks:tasks.rows.map(taskView),proposedAssignee:target,canDecide:(p.type!=='reassign'||user.role==='admin')&&p.status==='pending'};
      });
    },
    async decideChange(user,id,decision,body,key) {
      fields(body,decision==='approve'?['expectedCaseVersion','expectedProposalVersion','confirmed']:['expectedCaseVersion','expectedProposalVersion','reason']);
      requireValue(decision==='approve'||decision==='reject','변경 처리 종류를 확인해 주세요.');
      if(decision==='approve')requireValue(body.confirmed===true,'영향을 확인한 뒤 확정해 주세요.');
      else text(body.reason,'제외 이유',1000);
      return db.transaction(async tx=>{
        const found=await proposalAccess(tx,user,id),c=await access(tx,user,found.case_id,true);
        const p=(await tx.query('SELECT * FROM crm_change_proposals WHERE id=$1 FOR UPDATE',[id])).rows[0];
        requireValue(p.type!=='reassign'||user.role==='admin','담당자 변경은 관리자만 확정할 수 있습니다.',403);
        return once(tx,user.tenantId,user.id,`${decision}:${id}`,key,body,async()=>{
          version(c.version,body.expectedCaseVersion);version(p.version,body.expectedProposalVersion);
          requireValue(p.status==='pending','이미 처리된 변경 요청입니다.',409);
          if(decision==='approve')requireValue(!closed(c),'이미 종료된 영업건입니다.',409);
          let afterStage=c.stage,afterAssigneeId=c.assignee_id,afterAssigneeName=c.assignee_name;
          if(decision==='approve'){
            if(p.type==='reassign'){const target=await targetUser(tx,user.tenantId,p.proposed_assignee_id);requireValue(c.assignee_id!==p.proposed_assignee_id,'이미 해당 담당자에게 배정되었습니다.',409);afterAssigneeId=p.proposed_assignee_id;afterAssigneeName=target.name;}
            else afterStage=p.type==='close'?'종료':'서비스 완료';
            await tx.query('UPDATE crm_cases SET stage=$2,assignee_id=$3,version=version+1 WHERE id=$1',[c.id,afterStage,afterAssigneeId]);
          }
          const status=decision==='approve'?'approved':'rejected';
          await tx.query('UPDATE crm_change_proposals SET status=$2,decided_by=$3,decided_at=$4,version=version+1 WHERE id=$1',[id,status,user.id,now()]);
          await audit(tx,user.tenantId,c.id,user.id,decision==='reject'?'변경 요청 제외':p.type==='reassign'?'담당자 변경 확정':p.type==='close'?'영업건 종료 확정':'서비스 완료 확정',{proposalId:id,reason:decision==='reject'?body.reason:p.reason,beforeStage:c.stage,afterStage,beforeAssigneeId:c.assignee_id,afterAssigneeId,beforeAssigneeName:c.assignee_name,afterAssigneeName});
          return {id,status,version:p.version+1,caseVersion:c.version+(decision==='approve'?1:0)};
        });
      });
    },
    async publicInfo(slug) {
      const {rows} = await db.query('SELECT name FROM crm_tenants WHERE public_slug=$1',[slug]);
      requireValue(rows[0],'접수 주소를 찾을 수 없습니다.',404);
      return {companyName:rows[0].name};
    },
    async intake(slug, body, key) {
      const original=validateInquiry(body);
      return db.transaction(async tx => {
        const {rows} = await tx.query('SELECT * FROM crm_tenants WHERE public_slug=$1 FOR UPDATE',[slug]);
        const tenant = rows[0]; requireValue(tenant,'접수 주소를 찾을 수 없습니다.',404);
        return once(tx,tenant.id,'public',`intake:${slug}`,key,body,async()=> {
          const at=now();return insertInquiry(tx,tenant,original,{receivedAt:at,recordedAt:at});
        });
      });
    },
    async cases(user, search = '') {
      requireValue(search.length <= 200,'검색어는 200자 이내로 입력해 주세요.');
      const {rows} = await db.query("SELECT c.*,u.name AS assignee_name FROM crm_cases c JOIN crm_users u ON u.id=c.assignee_id WHERE c.tenant_id=$1 AND ($2='admin' OR c.assignee_id=$3) AND ($4='' OR strpos(lower(c.name || ' ' || c.person || ' ' || (c.original->>'memo') || ' ' || coalesce(c.request_memo,'')),lower($4))>0) ORDER BY c.received_at DESC,c.id DESC LIMIT 100",[user.tenantId,user.role,user.id,search]);
      return {items:rows.map(caseView),limit:100};
    },
    async detail(user,id) {
      return db.transaction(async tx => {
        const c = await access(tx,user,id);
        const tasks = await tx.query('SELECT * FROM crm_tasks WHERE tenant_id=$1 AND case_id=$2 ORDER BY created_at,id',[user.tenantId,id]);
        const notes = await tx.query('SELECT n.*,u.name AS author FROM crm_notes n JOIN crm_users u ON u.id=n.author_id WHERE n.tenant_id=$1 AND n.case_id=$2 ORDER BY n.created_at DESC,n.id',[user.tenantId,id]);
        const events = await tx.query("SELECT a.*,coalesce(u.name,'시스템') AS author FROM crm_audit a LEFT JOIN crm_users u ON u.id=a.actor_id WHERE a.tenant_id=$1 AND a.case_id=$2 ORDER BY a.created_at DESC,a.id LIMIT 100",[user.tenantId,id]);
        const proposals=await tx.query("SELECT * FROM crm_change_proposals WHERE tenant_id=$1 AND case_id=$2 AND status='pending' ORDER BY created_at,id",[user.tenantId,id]);
        return {salesCase:caseView(c),proposals:proposals.rows.map(proposalView),tasks:tasks.rows.map(taskView),notes:notes.rows.map(n=>({id:n.id,body:n.body,author:n.author,at:iso(n.created_at)})),activities:events.rows.map(a=>({id:a.id,action:a.action,payload:a.payload,author:a.author,at:iso(a.created_at)}))};
      });
    },
    async board(user) {
      const at=now(),today=kstDate(at);
      const {rows} = await db.query("SELECT t.*,c.name,c.stage,c.received_at,c.original->>'memo' AS request,u.name AS assignee_name FROM crm_tasks t JOIN crm_cases c ON c.id=t.case_id JOIN crm_users u ON u.id=c.assignee_id WHERE t.tenant_id=$1 AND c.tenant_id=$1 AND ($2='admin' OR c.assignee_id=$3) AND t.status='incomplete' AND NOT t.excluded AND c.stage NOT IN ('종료','서비스 완료') ORDER BY t.due_at NULLS LAST,t.id LIMIT 200",[user.tenantId,user.role,user.id]);
      const result = {overdue:[],today:[],upcoming:[],needsReview:[],now:at,limit:200};
      for (const t of rows) {
        const item={...taskView(t),caseName:t.name,stage:t.stage,assigneeName:t.assignee_name,request:t.request};
        if(!t.due_at)result.needsReview.push(item);
        else if(Date.parse(t.due_at)<Date.parse(at))result.overdue.push(item);
        else if(kstDate(t.due_at)===today || (t.kind==='first'&&kstDate(t.received_at)===today))result.today.push(item);
        else result.upcoming.push(item);
      }
      result.overdue.sort((a,b)=>Number(b.kind==='first')-Number(a.kind==='first') || Date.parse(a.dueAt)-Date.parse(b.dueAt));
      const missing=await db.query("SELECT c.*,u.name AS assignee_name FROM crm_cases c JOIN crm_users u ON u.id=c.assignee_id WHERE c.tenant_id=$1 AND ($2='admin' OR c.assignee_id=$3) AND c.stage NOT IN ('종료','서비스 완료') AND NOT EXISTS(SELECT 1 FROM crm_tasks t WHERE t.case_id=c.id AND t.status='incomplete' AND NOT t.excluded) ORDER BY c.received_at,c.id LIMIT 100",[user.tenantId,user.role,user.id]);
      result.missingNext=missing.rows.map(caseView);
      result.attentionCount=(await db.query("SELECT count(*)::int AS n FROM crm_notification_jobs WHERE tenant_id=$1 AND ($2='admin' OR recipient_id=$3) AND status IN ('failed','blocked','unknown')",[user.tenantId,user.role,user.id])).rows[0].n;
      return result;
    },
    async addTask(user,id,body,key) {
      fields(body,['taskType','description','date','expectedVersion']);
      let content; try {content=describeTask(text(body.taskType,'업무 종류'),text(body.description,'상세 내용',1000,true));} catch(e){throw new ApiError(422,e.message);}
      const dueAt=body.date ? dayDeadline(body.date) : null;
      return writeCase(user,id,`tasks:${id}`,key,body,async(tx,c)=>{
        version(c.version,body.expectedVersion); const taskId=randomUUID();
        await tx.query("INSERT INTO crm_tasks(id,tenant_id,case_id,title,task_type,description,kind,due_at,original_due_at,created_at) VALUES($1,$2,$3,$4,$5,$6,'work',$7,$7,$8)",[taskId,user.tenantId,id,content.title,content.taskType,content.description,dueAt,now()]);
        await tx.query('UPDATE crm_cases SET version=version+1 WHERE id=$1',[id]);
        await audit(tx,user.tenantId,id,user.id,'다음 행동 등록',{taskId,...content,dueAt});
        return {id:taskId,caseVersion:c.version+1};
      });
    },
    async addNote(user,id,body,key) {
      fields(body,['body','expectedVersion']); const content=text(body.body,'상담 메모',4000);
      return writeCase(user,id,`notes:${id}`,key,body,async(tx,c)=>{
        version(c.version,body.expectedVersion); const noteId=randomUUID();
        await tx.query('INSERT INTO crm_notes(id,tenant_id,case_id,body,author_id,created_at) VALUES($1,$2,$3,$4,$5,$6)',[noteId,user.tenantId,id,content,user.id,now()]);
        await tx.query('UPDATE crm_cases SET version=version+1 WHERE id=$1',[id]);
        await audit(tx,user.tenantId,id,user.id,'상담 메모 저장',{noteId});
        return {id:noteId,caseVersion:c.version+1};
      });
    },
    async taskCase(user,taskId) {
      requireValue(/^[0-9a-f-]{36}$/i.test(taskId),'업무를 찾을 수 없습니다.',404);
      const {rows}=await db.query('SELECT case_id FROM crm_tasks WHERE id=$1 AND tenant_id=$2',[taskId,user.tenantId]);
      requireValue(rows[0],'업무를 찾을 수 없습니다.',404);return rows[0].case_id;
    },
    async updateTask(user,caseId,taskId,action,body,key) {
      fields(body,action==='contact'?['taskId','outcome','actualAt','memo','expectedVersion']:action==='complete'?['actualAt','memo','expectedVersion']:action==='due'?['date','reason','expectedVersion']:['reason','expectedVersion']);
      return writeCase(user,caseId,`${action}:${taskId}`,key,body,async(tx,c)=>{
        const {rows}=await tx.query('SELECT * FROM crm_tasks WHERE id=$1 AND tenant_id=$2 AND case_id=$3 FOR UPDATE',[taskId,user.tenantId,caseId]);
        const t=rows[0];requireValue(t,'업무를 찾을 수 없습니다.',404);version(t.version,body.expectedVersion);
        const before=taskView(t);let payload;
        if(action==='contact'||action==='complete') {
          requireValue(t.status==='incomplete'&&!t.excluded,'이미 처리된 업무입니다.',409);
          requireValue(action==='contact'?t.kind==='first':t.kind==='work','첫 연락은 연락 결과로 기록해 주세요.');
          const actualAt=timestamp(body.actualAt,now(),c.received_at); const memo=text(body.memo,'상담 메모',4000,true);
          const outcome=action==='contact'?body.outcome:'completed';
          requireValue(action!=='contact'||['connected','sms','attempt'].includes(outcome),'연락 결과를 선택해 주세요.');
          if(action==='contact')await tx.query('INSERT INTO crm_contacts(id,tenant_id,case_id,task_id,outcome,actual_at,recorded_at,actor_id,memo) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[randomUUID(),user.tenantId,caseId,taskId,outcome,actualAt,now(),user.id,memo]);
          if(outcome!=='attempt')await tx.query("UPDATE crm_tasks SET status='complete',completed_at=$2,completed_by=$3,version=version+1 WHERE id=$1",[taskId,actualAt,user.id]);
          else await tx.query('UPDATE crm_tasks SET version=version+1 WHERE id=$1',[taskId]);
          if(outcome==='connected'&&c.stage==='접수')await tx.query("UPDATE crm_cases SET stage='상담 진행' WHERE id=$1",[caseId]);
          if(memo)await tx.query('INSERT INTO crm_notes(id,tenant_id,case_id,body,author_id,created_at) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),user.tenantId,caseId,memo,user.id,now()]);
          payload={before,outcome,actualAt,memo};
        } else if(action==='due') {
          requireValue(t.status==='incomplete'&&!t.excluded,'이미 처리된 업무입니다.',409);
          const reason=text(body.reason,'변경 이유',1000);const dueAt=dayDeadline(body.date);
          await tx.query('UPDATE crm_tasks SET due_at=$2,original_due_at=coalesce(original_due_at,$2),version=version+1 WHERE id=$1',[taskId,dueAt]);payload={before,dueAt,reason};
        } else {
          const reason=text(body.reason,'변경 이유',1000);
          requireValue(action==='reopen'?t.status==='complete':t.status==='incomplete'&&!t.excluded,'현재 상태에서는 처리할 수 없습니다.',409);
          if(action==='reopen')await tx.query("UPDATE crm_tasks SET status='incomplete',completed_at=NULL,completed_by=NULL,version=version+1 WHERE id=$1",[taskId]);
          else await tx.query('UPDATE crm_tasks SET excluded=true,version=version+1 WHERE id=$1',[taskId]);
          payload={before,reason};
        }
        await tx.query('UPDATE crm_cases SET version=version+1 WHERE id=$1',[caseId]);
        await audit(tx,user.tenantId,caseId,user.id,{contact:'첫 연락 결과',complete:'업무 완료',due:'기한 변경',reopen:'완료 취소',exclude:'업무 제외'}[action],payload);
        return {id:taskId,version:t.version+1,caseVersion:c.version+1};
      });
    },
  };
}
