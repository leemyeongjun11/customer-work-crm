import {useEffect,useRef,useState} from 'react';

export function useLiveChanges(enabled:boolean,refresh:()=>Promise<void>,expired:()=>void){
  const [state,setState]=useState<'connecting'|'live'|'retrying'>('connecting');
  const callbacks=useRef({refresh,expired});callbacks.current={refresh,expired};
  useEffect(()=>{
    if(!enabled)return;
    let ended=false,connected=false,lastSignal=Date.now(),lastRefresh=Date.now(),pending:ReturnType<typeof setTimeout>|undefined;
    setState('connecting');
    const source=new EventSource('/api/v1/events');
    function schedule(){if(ended||pending)return;pending=setTimeout(()=>{pending=undefined;if(!ended){lastRefresh=Date.now();void callbacks.current.refresh();}},150);}
    function alive(){lastSignal=Date.now();connected=true;setState('live');}
    source.addEventListener('ready',()=>{alive();schedule();});
    source.addEventListener('reset',schedule);
    source.addEventListener('change',schedule);
    source.addEventListener('heartbeat',alive);
    source.addEventListener('checkpoint',()=>{lastSignal=Date.now();});
    source.addEventListener('session-expired',()=>{source.close();callbacks.current.expired();});
    source.addEventListener('unavailable',()=>{connected=false;setState('retrying');});
    source.onerror=()=>{if(!ended){connected=false;setState('retrying');}};
    const poll=setInterval(()=>{
      if(Date.now()-lastSignal>45000){connected=false;setState('retrying');}
      // While disconnected refresh every 15s; while connected refresh time-dependent deadlines every minute.
      if(!connected||Date.now()-lastRefresh>=60000)schedule();
    },15000);
    const focus=()=>schedule();
    const visibility=()=>{if(document.visibilityState==='visible')schedule();};
    window.addEventListener('focus',focus);document.addEventListener('visibilitychange',visibility);
    return()=>{ended=true;source.close();clearInterval(poll);clearTimeout(pending);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',visibility);};
  },[enabled]);
  return state;
}
