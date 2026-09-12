import {authenticate} from './auth.mjs';
import {requireValue} from './rules.mjs';

// Transactional counter, not a sequence: a later commit must never overtake an earlier cursor.
export async function appendChange(tx,tenantId,caseId,at,previousAssigneeId=null){
  const row=(await tx.query('INSERT INTO crm_change_cursors(tenant_id,revision) VALUES($1,1) ON CONFLICT(tenant_id) DO UPDATE SET revision=crm_change_cursors.revision+1 RETURNING revision',[tenantId])).rows[0];
  await tx.query('INSERT INTO crm_changes(tenant_id,revision,case_id,previous_assignee_id,created_at) VALUES($1,$2,$3,$4,$5)',[tenantId,row.revision,caseId,previousAssigneeId,at]);
}

export async function changePage(db,user,cursor){
  return db.transaction(async tx=>{
    const {rows:[bounds]}=await tx.query('SELECT coalesce((SELECT revision FROM crm_change_cursors WHERE tenant_id=$1),0)::text AS latest,(SELECT min(revision)::text FROM crm_changes WHERE tenant_id=$1) AS earliest',[user.tenantId]);
    const latest=bounds.latest,earliest=bounds.earliest;
    if(cursor===null||BigInt(cursor)>BigInt(latest)||(earliest&&BigInt(cursor)<BigInt(earliest)-1n)||(!earliest&&BigInt(cursor)<BigInt(latest)))return {reset:true,cursor:latest,items:[]};
    const {rows}=await tx.query('SELECT e.revision::text,e.case_id,e.previous_assignee_id,c.assignee_id FROM crm_changes e JOIN crm_cases c ON c.id=e.case_id AND c.tenant_id=e.tenant_id WHERE e.tenant_id=$1 AND e.revision>$2 AND e.revision<=$3 ORDER BY e.revision LIMIT 100',[user.tenantId,cursor,latest]);
    const items=rows.filter(e=>user.role==='admin'||e.assignee_id===user.id||e.previous_assignee_id===user.id).map(e=>({revision:e.revision,caseId:user.role==='admin'||e.assignee_id===user.id?e.case_id:null}));
    return {reset:false,cursor:rows.at(-1)?.revision||cursor,items};
  });
}

export function createChangeStreams(db,{clock=()=>new Date(),pollMs=1000}={}){
  const active=new Set(),counts=new Map();
  return {
    async open(req,res,user){
      const raw=req.headers['last-event-id'];
      requireValue(raw===undefined||(typeof raw==='string'&&/^\d{1,19}$/.test(raw)&&BigInt(raw)<=9223372036854775807n),'변경 기록 위치를 확인해 주세요.',400);
      requireValue((counts.get(user.id)||0)<5,'열린 실시간 연결이 많습니다. 사용하지 않는 탭을 닫아 주세요.',429);
      counts.set(user.id,(counts.get(user.id)||0)+1);
      let cursor=raw??null,ended=false,timer,ticks=0;
      const stop=()=>{if(ended)return;ended=true;clearTimeout(timer);active.delete(stop);const n=(counts.get(user.id)||1)-1;if(n)counts.set(user.id,n);else counts.delete(user.id);res.end();};
      active.add(stop);res.once('close',stop);
      res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});
      res.flushHeaders();
      const send=(event,data,id)=>{if(ended)return;if(!res.write(`${id===undefined?'':`id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))stop();};
      res.write('retry: 3000\n\n');
      async function poll(){
        try{
          const current=await authenticate(db,req.headers.cookie,clock());
          if(current.tenantId!==user.tenantId||current.role!==user.role){send('session-expired',{});return stop();}
          const page=await changePage(db,current,cursor);
          if(ended)return;
          if(page.reset)send('reset',{},page.cursor);
          else {for(const item of page.items)send('change',{caseId:item.caseId},item.revision);if(page.cursor!==cursor)send('checkpoint',{},page.cursor);}
          cursor=page.cursor;
          if(ticks++===0)send('ready',{},cursor);
          else if(ticks%15===0)send('heartbeat',{});
        }catch(error){send(error.status===401?'session-expired':'unavailable',{});return stop();}
        if(!ended){timer=setTimeout(poll,pollMs);timer.unref?.();}
      }
      void poll();
    },
    close(){for(const stop of [...active])stop();},
  };
}
