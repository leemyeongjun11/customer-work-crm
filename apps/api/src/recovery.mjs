import {randomUUID,createHash} from 'node:crypto';
import {ApiError,requireValue,fields,iso} from './rules.mjs';
import {ingestionService} from './ingestion.mjs';

const id=value=>typeof value==='string'?value.slice(0,128):null;
const itemKey=item=>createHash('sha256').update(JSON.stringify([item?.eventId??null,item?.sourceInquiryId??null])).digest('hex');
const message=error=>error instanceof ApiError?error.message:'누락 보충 처리에 실패했습니다. 연결과 저장 상태를 확인해 주세요.';

export function recoveryService(db,{clock=()=>new Date(),fetchPage}={}){
  const importer=ingestionService(db,{clock});
  const at=()=>clock().toISOString();
  const configured=tenantId=>typeof fetchPage==='function'&&(!fetchPage.tenantIds||fetchPage.tenantIds.includes(tenantId));
  async function finish(tenantId,lease,status,note,nextRun,cursor,success=false){
    const r=await db.query('UPDATE crm_recovery_state SET lease_id=NULL,lease_until=NULL,status=$3,message=$4,next_run=$5,cursor=CASE WHEN $6 THEN $7 ELSE cursor END,last_success=CASE WHEN $6 THEN $8 ELSE last_success END WHERE tenant_id=$1 AND lease_id=$2 RETURNING tenant_id',[tenantId,lease,status,note,nextRun,success,cursor??null,at()]);
    requireValue(r.rows.length,'다른 복구 실행이 시작되어 현재 실행을 중단했습니다.',409);
  }
  return {
    async status(user){
      requireValue(user.role==='admin','연동 복구 내역은 관리자만 확인할 수 있습니다.',403);
      const state=(await db.query('SELECT status,last_attempt,last_success,next_run,message FROM crm_recovery_state WHERE tenant_id=$1',[user.tenantId])).rows[0];
      const errors=(await db.query('SELECT event_id,source_inquiry_id,status_code,message,first_seen,last_seen FROM crm_recovery_errors WHERE tenant_id=$1 AND resolved_at IS NULL ORDER BY last_seen DESC LIMIT 100',[user.tenantId])).rows;
      const received=(await db.query("SELECT count(*)::int AS total,max(ingested_at) AS last_received FROM crm_source_inquiries WHERE tenant_id=$1 AND source='emergent'",[user.tenantId])).rows[0];
      return {configured:configured(user.tenantId),state:state?{status:state.status,lastAttempt:iso(state.last_attempt),lastSuccess:iso(state.last_success),nextRun:iso(state.next_run),message:state.message}:null,received:{total:received.total,lastReceived:iso(received.last_received)},errors:errors.map(e=>({eventId:e.event_id,sourceInquiryId:e.source_inquiry_id,status:e.status_code,message:e.message,firstSeen:iso(e.first_seen),lastSeen:iso(e.last_seen)}))};
    },
    async run(tenantId){
      requireValue(configured(tenantId),'Emergent 누락 보충 연결이 아직 설정되지 않았습니다.',503);
      const lease=randomUUID();
      const claim=await db.transaction(async tx=>{
        await tx.query('INSERT INTO crm_recovery_state(tenant_id) VALUES($1) ON CONFLICT DO NOTHING',[tenantId]);
        const current=(await tx.query('SELECT * FROM crm_recovery_state WHERE tenant_id=$1 FOR UPDATE',[tenantId])).rows[0];
        if(current.status==='blocked')return {skip:'blocked'};
        if(current.lease_id&&new Date(current.lease_until)>clock())return {skip:'running'};
        if(current.next_run&&new Date(current.next_run)>clock())return {skip:'waiting'};
        await tx.query("UPDATE crm_recovery_state SET lease_id=$2,lease_until=$3,status='running',last_attempt=$4 WHERE tenant_id=$1",[tenantId,lease,new Date(clock().getTime()+60000).toISOString(),at()]);
        return {cursor:current.cursor};
      });
      if(claim.skip)return {status:claim.skip};
      try{
        // Adapter must fetch a bounded authenticated page; no network request exists by default.
        const controller=new AbortController();let timeout;
        let page;
        try {page=await Promise.race([
          Promise.resolve().then(()=>fetchPage({tenantId,cursor:claim.cursor,limit:100,signal:controller.signal})),
          new Promise((_,reject)=>{timeout=setTimeout(()=>{controller.abort();reject(new ApiError(503,'보충 조회 응답이 지연되어 다음 실행에서 다시 확인합니다.'));},10000);}),
        ]);}finally{clearTimeout(timeout);}
        fields(page,['items','nextCursor','hasMore']);
        requireValue(Array.isArray(page.items)&&page.items.length<=100,'누락 보충 목록은 최대 100건이어야 합니다.');
        requireValue(typeof page.nextCursor==='string'&&page.nextCursor.length>0&&page.nextCursor.length<=2048&&typeof page.hasMore==='boolean','보충 조회의 다음 위치를 확인해 주세요.');
        requireValue(!page.hasMore||(page.items.length>0&&page.nextCursor!==claim.cursor),'진행되지 않는 보충 조회 위치입니다.');
        let created=0,duplicates=0,failed=0;
        for(const item of page.items){
          const held=await db.query('UPDATE crm_recovery_state SET lease_until=$3 WHERE tenant_id=$1 AND lease_id=$2 RETURNING tenant_id',[tenantId,lease,new Date(clock().getTime()+60000).toISOString()]);
          requireValue(held.rows.length,'복구 실행 권한이 변경되었습니다.',409);
          try{
            const result=await importer.importVerified(tenantId,item);if(result.status===201)created++;else duplicates++;
            await db.query('UPDATE crm_recovery_errors SET resolved_at=$3 WHERE tenant_id=$1 AND item_key=$2',[tenantId,itemKey(item),at()]);
          }catch(error){
            failed++;
            await db.query('INSERT INTO crm_recovery_errors(tenant_id,item_key,event_id,source_inquiry_id,status_code,message,first_seen,last_seen) VALUES($1,$2,$3,$4,$5,$6,$7,$7) ON CONFLICT(tenant_id,item_key) DO UPDATE SET status_code=EXCLUDED.status_code,message=EXCLUDED.message,last_seen=EXCLUDED.last_seen,resolved_at=NULL',[tenantId,itemKey(item),id(item?.eventId),id(item?.sourceInquiryId),error instanceof ApiError?error.status:503,message(error),at()]);
          }
        }
        const nextRun=new Date(clock().getTime()+60000).toISOString();
        await finish(tenantId,lease,failed?'needs_review':'idle',failed?`${failed}건의 오류를 확인해야 합니다. 조회 위치는 유지됩니다.`:'페이지 저장 완료',nextRun,page.nextCursor,!failed);
        return {status:failed?'needs_review':'completed',created,duplicates,failed,hasMore:page.hasMore};
      }catch(error){
        const blocked=[401,403].includes(error.status),delay=error.status===429?Math.max(60,Math.min(Number(error.retryAfterSeconds)||60,86400)):60;
        await finish(tenantId,lease,blocked?'blocked':'retry',message(error),blocked?null:new Date(clock().getTime()+delay*1000).toISOString());
        return {status:blocked?'blocked':'retry'};
      }
    },
    async resume(user){
      requireValue(user.role==='admin','연동 복구 재개는 관리자만 할 수 있습니다.',403);
      requireValue(configured(user.tenantId),'Emergent 누락 보충 연결이 아직 설정되지 않았습니다.',503);
      await db.query("UPDATE crm_recovery_state SET status='idle',next_run=NULL,message='관리자가 연결 확인 후 재개' WHERE tenant_id=$1 AND status='blocked' AND lease_id IS NULL",[user.tenantId]);
      return {ok:true};
    },
  };
}
