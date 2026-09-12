// Independent of notification scheduling: a slow source must not stall due alerts.
export function startRecoveryPolling(recovery,{tenantIds=[],intervalMs=60000,onError=()=>console.error('Inquiry recovery polling failed.')}={}){
  let stopped=false,running=null;
  async function tick(){
    if(stopped||running)return;
    running=(async()=>{for(const id of tenantIds){if(stopped)break;try{await recovery.run(id);}catch{onError();}}})();
    try{await running;}finally{running=null;}
  }
  const timer=tenantIds.length?setInterval(()=>void tick(),intervalMs):null;
  if(tenantIds.length)void tick();
  return {tick,async stop(){stopped=true;if(timer)clearInterval(timer);if(running)await running;}};
}
