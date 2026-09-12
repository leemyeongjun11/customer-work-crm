import {runScheduler} from '../../scheduler/src/run.mjs';
import {runWorker} from '../../worker/src/run.mjs';
export function startLocalAutomation(db){
  let running=null,stopped=false,nextSchedule=0;
  async function cycle(){
    if(stopped||running)return;
    running=(async()=>{
      const at=new Date().toISOString();
      try{
        if(Date.now()>=nextSchedule){await runScheduler(db,at);nextSchedule=Date.now()+30000;}
        await runWorker(db,at);
        await db.query("INSERT INTO crm_runtime_state(name,last_tick,error) VALUES('automation',$1,'') ON CONFLICT(name) DO UPDATE SET last_tick=$1,error=''",[at]);
      }catch{
        console.error('Local automation cycle failed; retrying at the next cycle.');
        try{await db.query("INSERT INTO crm_runtime_state(name,last_tick,error) VALUES('automation',$1,'자동화 실행 점검 필요') ON CONFLICT(name) DO UPDATE SET last_tick=$1,error='자동화 실행 점검 필요'",[at]);}catch{}
      }
    })();
    try{await running;}finally{running=null;}
  }
  const timer=setInterval(()=>void cycle(),5000);void cycle();
  return async()=>{stopped=true;clearInterval(timer);if(running)await running;};
}
