import {processNotification} from '../../api/src/notifications.mjs';
export async function runWorker(db,at=new Date().toISOString(),limit=20){
  let processed=0;
  for(let i=0;i<limit;i++){if(!await processNotification(db,{at}))break;processed++;}
  return {processed};
}
