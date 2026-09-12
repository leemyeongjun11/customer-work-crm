import {randomUUID,createHash} from 'node:crypto';
import {requireValue,fields,text,iso} from './rules.mjs';
const admin=u=>requireValue(u.role==='admin','직원 계정은 관리자만 관리할 수 있습니다.',403);
const validId=id=>requireValue(typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),'직원을 찾을 수 없습니다.',404);
const view=u=>({id:u.id,name:u.name,email:u.email,role:u.role,active:u.active,version:u.version});
async function impact(tx,tenantId,id){
  const tenant=(await tx.query('SELECT default_assignee_id FROM crm_tenants WHERE id=$1',[tenantId])).rows[0];
  const rows=(await tx.query("SELECT id,name,stage FROM crm_cases WHERE tenant_id=$1 AND assignee_id=$2 AND stage NOT IN ('서비스 완료','종료') ORDER BY received_at,id",[tenantId,id])).rows;
  return {isDefault:tenant.default_assignee_id===id,openCount:rows.length,cases:rows.slice(0,100)};
}
export function accountService(db,clock=()=>new Date()){
  return {
    async list(user){
      admin(user);
      const items=(await db.query('SELECT id,name,email,role,active,version FROM crm_users WHERE tenant_id=$1 ORDER BY active DESC,name,id',[user.tenantId])).rows.map(view);
      const history=(await db.query('SELECT h.*,u.name AS user_name,a.name AS actor_name FROM crm_account_history h JOIN crm_users u ON u.id=h.user_id JOIN crm_users a ON a.id=h.actor_id WHERE h.tenant_id=$1 ORDER BY h.created_at DESC,h.id LIMIT 30',[user.tenantId])).rows.map(h=>({id:h.id,userName:h.user_name,actorName:h.actor_name,active:h.after_active,reason:h.reason,at:iso(h.created_at)}));
      return {items,history};
    },
    async preview(user,id){
      admin(user);validId(id);const target=(await db.query('SELECT * FROM crm_users WHERE tenant_id=$1 AND id=$2',[user.tenantId,id])).rows[0];requireValue(target,'직원을 찾을 수 없습니다.',404);
      return {user:view(target),...await impact(db,user.tenantId,id)};
    },
    async change(user,id,body,key){
      admin(user);validId(id);fields(body,['active','expectedVersion','reason','confirmed']);
      requireValue(typeof body.active==='boolean'&&body.confirmed===true,'변경 내용을 확인해 주세요.');
      requireValue(Number.isInteger(body.expectedVersion)&&body.expectedVersion>0,'최신 계정 버전이 필요합니다.');
      const reason=text(body.reason,'변경 이유',1000);
      requireValue(typeof key==='string'&&/^[A-Za-z0-9_-]{8,128}$/.test(key),'중복 방지 키가 필요합니다.');
      const hash=createHash('sha256').update(JSON.stringify({id,active:body.active,expectedVersion:body.expectedVersion,reason,confirmed:true})).digest('hex');
      return db.transaction(async tx=>{
        // Same order as intake and settings: tenant, then user. Assignment targets hold FOR SHARE.
        await tx.query('SELECT id FROM crm_tenants WHERE id=$1 FOR UPDATE',[user.tenantId]);
        const target=(await tx.query('SELECT * FROM crm_users WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[user.tenantId,id])).rows[0];requireValue(target,'직원을 찾을 수 없습니다.',404);
        requireValue(target.role==='staff'&&target.id!==user.id,'이 화면에서는 일반 직원의 사용 상태만 변경할 수 있습니다.',403);
        const ids=[user.tenantId,user.id,'account-status',key];
        await tx.query('INSERT INTO crm_idempotency(tenant_id,actor_scope,operation,key,request_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[...ids,hash]);
        const saved=(await tx.query('SELECT * FROM crm_idempotency WHERE tenant_id=$1 AND actor_scope=$2 AND operation=$3 AND key=$4 FOR UPDATE',ids)).rows[0];
        requireValue(saved.request_hash===hash,'같은 요청 키의 내용이 다릅니다.',409);if(saved.response)return saved.response;
        requireValue(target.version===body.expectedVersion,'다른 변경이 먼저 저장되었습니다. 최신 상태를 다시 확인해 주세요.',409);
        requireValue(target.active!==body.active,'이미 같은 사용 상태입니다.',409);
        if(!body.active){const pending=await impact(tx,user.tenantId,id);requireValue(!pending.isDefault,'운영 기준에서 신규 문의 기본 담당자를 먼저 변경해 주세요.',409);requireValue(pending.openCount===0,`진행 중인 영업건 ${pending.openCount}건을 먼저 인계해 주세요.`,409);}
        const result=(await tx.query('UPDATE crm_users SET active=$3,version=version+1 WHERE tenant_id=$1 AND id=$2 RETURNING *',[user.tenantId,id,body.active])).rows[0];
        await tx.query('DELETE FROM crm_sessions WHERE user_id=$1',[id]);
        await tx.query('INSERT INTO crm_account_history(id,tenant_id,user_id,actor_id,before_active,after_active,reason,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),user.tenantId,id,user.id,target.active,body.active,reason,clock().toISOString()]);
        const response=view(result);await tx.query('UPDATE crm_idempotency SET response=$5 WHERE tenant_id=$1 AND actor_scope=$2 AND operation=$3 AND key=$4',[...ids,JSON.stringify(response)]);return response;
      });
    },
  };
}
