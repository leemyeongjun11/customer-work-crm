import {randomUUID,createHash} from 'node:crypto';
import {requireValue,fields,text,dayDeadline,kstDate,iso} from './rules.mjs';
const admin=user=>requireValue(user.role==='admin','운영 기준은 관리자만 조회·수정할 수 있습니다.',403);
const settings=t=>({companyName:t.name,defaultAssigneeId:t.default_assignee_id,holidays:t.holidays,version:t.settings_version});
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export function operationService(db,clock=()=>new Date()){
  return {
    async settings(user){
      admin(user);const t=(await db.query('SELECT * FROM crm_tenants WHERE id=$1',[user.tenantId])).rows[0];requireValue(t,'회사 설정을 찾을 수 없습니다.',404);
      const users=(await db.query('SELECT id,name,active FROM crm_users WHERE tenant_id=$1 ORDER BY name,id',[user.tenantId])).rows;
      const history=(await db.query('SELECT h.*,u.name AS actor_name FROM crm_settings_history h JOIN crm_users u ON u.id=h.actor_id WHERE h.tenant_id=$1 ORDER BY h.created_at DESC,h.id LIMIT 30',[user.tenantId])).rows;
      return {...settings(t),users,history:history.map(h=>({id:h.id,actor:h.actor_name,before:h.before_value,after:h.after_value,reason:h.reason,at:iso(h.created_at)}))};
    },
    async updateSettings(user,body,key){
      admin(user);fields(body,['defaultAssigneeId','holidays','expectedVersion','reason','confirmed']);
      requireValue(body.confirmed===true,'설정 적용 범위를 확인해 주세요.');
      requireValue(typeof key==='string'&&/^[A-Za-z0-9_-]{8,128}$/.test(key),'중복 방지 키가 필요합니다.');
      requireValue(Number.isInteger(body.expectedVersion)&&body.expectedVersion>0,'설정 버전이 필요합니다.');
      requireValue(typeof body.defaultAssigneeId==='string'&&/^[0-9a-f-]{36}$/i.test(body.defaultAssigneeId),'접수 담당자를 선택해 주세요.');
      requireValue(Array.isArray(body.holidays)&&body.holidays.length<=366,'회사 휴일은 최대 366개까지 입력해 주세요.');
      for(const day of body.holidays)dayDeadline(day);
      requireValue(new Set(body.holidays).size===body.holidays.length,'휴일에 중복된 날짜가 있습니다.');
      const holidays=[...body.holidays].sort(),reason=text(body.reason,'변경 이유',1000);
      const hash=createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex');
      return db.transaction(async tx=>{
        const tenant=(await tx.query('SELECT * FROM crm_tenants WHERE id=$1 FOR UPDATE',[user.tenantId])).rows[0];requireValue(tenant,'회사 설정을 찾을 수 없습니다.',404);
        const ids=[user.tenantId,user.id,'settings',key];
        await tx.query('INSERT INTO crm_idempotency(tenant_id,actor_scope,operation,key,request_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[...ids,hash]);
        const saved=(await tx.query('SELECT * FROM crm_idempotency WHERE tenant_id=$1 AND actor_scope=$2 AND operation=$3 AND key=$4 FOR UPDATE',ids)).rows[0];
        requireValue(saved.request_hash===hash,'같은 요청 키의 내용이 다릅니다.',409);if(saved.response)return saved.response;
        requireValue(tenant.settings_version===body.expectedVersion,'다른 설정이 먼저 저장되었습니다. 최신 내용을 확인해 주세요.',409);
        const target=(await tx.query('SELECT id FROM crm_users WHERE id=$1 AND tenant_id=$2 AND active=true FOR SHARE',[body.defaultAssigneeId,user.tenantId])).rows[0];requireValue(target,'같은 회사의 활성 직원을 선택해 주세요.');
        const after={...settings(tenant),defaultAssigneeId:target.id,holidays,version:tenant.settings_version+1};
        await tx.query('UPDATE crm_tenants SET default_assignee_id=$2,holidays=$3,settings_version=settings_version+1 WHERE id=$1',[user.tenantId,target.id,JSON.stringify(holidays)]);
        await tx.query('INSERT INTO crm_settings_history(id,tenant_id,actor_id,before_value,after_value,reason,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),user.tenantId,user.id,JSON.stringify(settings(tenant)),JSON.stringify(after),reason,clock().toISOString()]);
        await tx.query('UPDATE crm_idempotency SET response=$5 WHERE tenant_id=$1 AND actor_scope=$2 AND operation=$3 AND key=$4',[...ids,JSON.stringify(after)]);return after;
      });
    },
    async firstContactMetrics(user,{from,to}={}){
      const now=clock().toISOString(),today=kstDate(now);
      from=from||`${today.slice(0,7)}-01`;to=to||today;
      dayDeadline(from);dayDeadline(to);
      requireValue(from<=to&&(Date.parse(to)-Date.parse(from))/86400000<=365,'조회 기간은 시작일부터 최대 366일로 선택해 주세요.');
      const start=new Date(`${from}T00:00:00+09:00`).toISOString(),end=new Date(Date.parse(`${to}T00:00:00+09:00`)+86400000).toISOString();
      const {rows}=await db.query(`WITH targets AS (SELECT c.id,c.name,c.stage,c.assignee_id,u.name AS assignee_name,t.id AS task_id,t.status,t.excluded,t.original_due_at,t.completed_at,
        (SELECT outcome FROM crm_contacts k WHERE k.task_id=t.id AND k.outcome IN ('connected','sms') AND k.actual_at=t.completed_at ORDER BY k.recorded_at DESC,k.id DESC LIMIT 1) AS outcome
        FROM crm_cases c JOIN crm_tasks t ON t.case_id=c.id AND t.tenant_id=c.tenant_id AND t.kind='first' JOIN crm_users u ON u.id=c.assignee_id
        WHERE c.tenant_id=$1 AND ($2='admin' OR c.assignee_id=$3) AND t.original_due_at >= $4 AND t.original_due_at < $5
        ), scored AS (SELECT *,CASE WHEN original_due_at>$6 THEN 'not_yet_due'
          WHEN status='complete' AND completed_at IS NOT NULL AND NOT excluded THEN CASE WHEN completed_at<=original_due_at THEN 'on_time' ELSE 'late' END
          ELSE 'incomplete' END AS result FROM targets)
        SELECT count(*)::int AS total,
          (count(*) FILTER(WHERE result='on_time'))::int AS on_time,
          (count(*) FILTER(WHERE result='late'))::int AS late,
          (count(*) FILTER(WHERE result='incomplete'))::int AS incomplete,
          (count(*) FILTER(WHERE result='not_yet_due'))::int AS not_yet_due,
          (count(*) FILTER(WHERE result IN ('on_time','late') AND outcome='connected'))::int AS connected,
          (count(*) FILTER(WHERE result IN ('on_time','late') AND outcome='sms'))::int AS sms,
          (count(*) FILTER(WHERE result<>'not_yet_due' AND excluded))::int AS excluded,
          (SELECT coalesce(json_agg(item),'[]'::json) FROM (SELECT * FROM scored ORDER BY original_due_at,id LIMIT 100) item) AS items
        FROM scored`,[user.tenantId,user.role,user.id,start,end,now]);
      const r=rows[0],onTime=r.on_time,late=r.late,incomplete=r.incomplete,notYetDue=r.not_yet_due,connected=r.connected,sms=r.sms,excluded=r.excluded;
      const items=r.items.map(i=>({id:i.id,name:i.name,stage:i.stage,assignee:i.assignee_name,originalDueAt:iso(i.original_due_at),completedAt:iso(i.completed_at),result:i.result,outcome:i.status==='complete'&&!i.excluded?i.outcome:null,excluded:i.excluded}));
      const denominator=onTime+late+incomplete;
      return {from,to,asOf:now,target:100,denominator,onTime,late,incomplete,notYetDue,connected,sms,excluded,rate:denominator?onTime/denominator*100:null,items,totalItems:r.total,definition:'최초 기한이 조회 기간에 속하고 현재까지 도래한 모든 상담. 종료·관리 제외만으로 분모에서 빼지 않음.',provisional:true};
    },
  };
}
