import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openDatabase } from './db.mjs';
import { authenticate, login, sessionCookie } from './auth.mjs';
import { ApiError, fields, requireValue } from './rules.mjs';
import { createService } from './service.mjs';
import {notificationService} from './notifications.mjs';
import {startLocalAutomation} from './local-automation.mjs';
import {operationService} from './operations.mjs';
import {ingestionService,readWebhookKeys} from './ingestion.mjs';
import {createChangeStreams} from './changes.mjs';
import {recoveryService} from './recovery.mjs';
import {backupService} from './backup.mjs';
import {accountService} from './accounts.mjs';
import {readExportConnections,exportPageFetcher} from './emergent-export.mjs';
import {startRecoveryPolling} from '../../scheduler/src/recovery-polling.mjs';

const dist = fileURLToPath(new URL('../../web/dist/',import.meta.url));
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
async function rawJsonBody(req) {
  requireValue(req.headers['content-type']?.split(';')[0] === 'application/json','JSON 형식이 필요합니다.',415);
  let length=0;const chunks=[];
  for await(const chunk of req) {length+=chunk.length;requireValue(length<=16384,'입력 내용이 너무 큽니다.',413);chunks.push(chunk);}
  return Buffer.concat(chunks);
}
async function jsonBody(req) {
  const raw=await rawJsonBody(req);
  try {return JSON.parse(raw.toString('utf8'));} catch {throw new ApiError(400,'JSON 내용을 확인해 주세요.');}
}
export function makeServer(db, {clock=()=>new Date(),allowedOrigin,webhookKeys=[],eventPollMs=1000,recoveryFetchPage,backupDirectory}={}) {
  const service=createService(db,clock),notifications=notificationService(db,clock),operations=operationService(db,clock);const buckets=new Map();
  const ingestion=ingestionService(db,{clock,keys:webhookKeys});
  const streams=createChangeStreams(db,{clock,pollMs:eventPollMs});
  const recovery=recoveryService(db,{clock,fetchPage:recoveryFetchPage});
  const backups=backupService(db,{clock,directory:backupDirectory});
  const accounts=accountService(db,clock);
  function limit(req,kind,maximum) {
    const at=Date.now(),key=`${kind}:${req.socket.remoteAddress}`;
    for(const [k,v]of buckets)if(v.until<at)buckets.delete(k);
    const bucket=buckets.get(key)||{count:0,until:at+60000};bucket.count++;buckets.set(key,bucket);
    if(bucket.count>maximum)throw new ApiError(429,'요청이 많습니다. 1분 뒤 다시 시도해 주세요.');
  }
  const server=createServer(async(req,res)=>{
    const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    try {
      const host=req.headers.host||'';
      requireValue(/^(127\.0\.0\.1|localhost):\d+$/.test(host),'로컬 검수 주소로 접속해 주세요.',403);
      const origin=allowedOrigin || `http://${host}`;
      const url=new URL(req.url,origin); const path=url.pathname;
      if(path==='/api/v1/integrations/emergent/inquiries'&&req.method==='POST'){
        limit(req,'webhook',120);
        let result;
        try {result=await ingestion.receive(req.headers,await rawJsonBody(req));}
        catch(error){if(error instanceof ApiError)throw error;console.error('Inquiry ingestion failed',error.name,error.code||'');throw new ApiError(503,'문의 저장에 실패했습니다. 동일한 이벤트 ID로 다시 전송해 주세요.');}
        return reply(result.status,result.data);
      }
      if(['POST','PATCH','DELETE'].includes(req.method))requireValue(req.headers.origin===origin,'요청 출처를 확인할 수 없습니다.',403);
      if(path==='/health/ready'){await db.query('SELECT 1');return reply(200,{status:'ok',role:'api',mode:'local-mvp',database:db.driver,productionReady:false});}
      const prefix='/api/v1';
      if(path.startsWith(`${prefix}/`)) {
        limit(req,'api',300);
        if(path===`${prefix}/auth/login`&&req.method==='POST') {
          limit(req,'login',10);const body=await jsonBody(req);fields(body,['email','password']);
          const result=await login(db,body.email,body.password,clock());res.setHeader('Set-Cookie',sessionCookie(result.token));return reply(200,{user:result.user});
        }
        const intake=/^\/api\/v1\/public\/inquiries\/([a-z0-9-]{1,64})$/.exec(path);
        if(intake) {
          if(req.method==='GET')return reply(200,await service.publicInfo(intake[1]));
          if(req.method==='POST'){limit(req,'intake',15);return reply(201,await service.intake(intake[1],await jsonBody(req),req.headers['idempotency-key']));}
          throw new ApiError(405,'지원하지 않는 요청입니다.');
        }
        const user=await authenticate(db,req.headers.cookie,clock());
        if(path===`${prefix}/admin/users`&&req.method==='GET')return reply(200,await accounts.list(user));
        const accountRoute=/^\/api\/v1\/admin\/users\/([0-9a-f-]{36})\/(preview|status)$/.exec(path);
        if(accountRoute){const [,id,action]=accountRoute;
          if(action==='preview'&&req.method==='GET')return reply(200,await accounts.preview(user,id));
          if(action==='status'&&req.method==='POST')return reply(200,await accounts.change(user,id,await jsonBody(req),req.headers['idempotency-key']));
        }
        if(path===`${prefix}/events`&&req.method==='GET')return await streams.open(req,res,user);
        if(path===`${prefix}/admin/backups`&&req.method==='GET')return reply(200,await backups.list(user));
        if(path===`${prefix}/admin/backups`&&req.method==='POST'){
          requireValue(user.role==='admin','백업은 관리자만 관리할 수 있습니다.',403);limit(req,'backup',3);
          return reply(200,await backups.create(user,await jsonBody(req),req.headers['idempotency-key']));
        }
        if(path===`${prefix}/admin/integrations/emergent`&&req.method==='GET')return reply(200,await recovery.status(user));
        if(path===`${prefix}/admin/integrations/emergent/recover`&&req.method==='POST'){
          requireValue(user.role==='admin','연동 복구는 관리자만 실행할 수 있습니다.',403);fields(await jsonBody(req),[]);limit(req,'recovery',5);
          return reply(200,await recovery.run(user.tenantId));
        }
        if(path===`${prefix}/admin/integrations/emergent/resume`&&req.method==='POST'){
          const body=await jsonBody(req);fields(body,['confirmed']);requireValue(body.confirmed===true,'인증 설정을 확인한 뒤 재개해 주세요.');
          return reply(200,await recovery.resume(user));
        }
        if(path===`${prefix}/auth/me`&&req.method==='GET'){const {tokenHash,...visible}=user;return reply(200,{user:visible});}
        if(path===`${prefix}/auth/logout`&&req.method==='POST'){await db.query('DELETE FROM crm_sessions WHERE token_hash=$1',[user.tokenHash]);res.setHeader('Set-Cookie',sessionCookie('',true));return reply(200,{ok:true});}
        if(path===`${prefix}/workboard`&&req.method==='GET')return reply(200,await service.board(user));
        if(path===`${prefix}/admin/settings`&&req.method==='GET')return reply(200,await operations.settings(user));
        if(path===`${prefix}/admin/settings`&&req.method==='PATCH')return reply(200,await operations.updateSettings(user,await jsonBody(req),req.headers['idempotency-key']));
        if(path===`${prefix}/metrics/first-contact`&&req.method==='GET')return reply(200,await operations.firstContactMetrics(user,{from:url.searchParams.get('from'),to:url.searchParams.get('to')}));
        if(path===`${prefix}/notifications`&&req.method==='GET')return reply(200,await notifications.inbox(user));
        if(path===`${prefix}/notifications/review`&&req.method==='POST'){
          fields(await jsonBody(req),[]);limit(req,'review',10);
          return reply(202,await notifications.reviewNow(user,req.headers['idempotency-key']));
        }
        if(path===`${prefix}/assignees`&&req.method==='GET')return reply(200,await service.assignees(user));
        if(path===`${prefix}/cases`&&req.method==='GET')return reply(200,await service.cases(user,url.searchParams.get('search')||''));
        const proposalRoute=/^\/api\/v1\/change-proposals\/([0-9a-f-]+)\/(preview|approve|reject)$/.exec(path);
        if(proposalRoute){
          const [,id,action]=proposalRoute;
          if(action==='preview'&&req.method==='GET')return reply(200,await service.previewChange(user,id));
          if(['approve','reject'].includes(action)&&req.method==='POST')return reply(200,await service.decideChange(user,id,action,await jsonBody(req),req.headers['idempotency-key']));
        }
        const caseRoute=/^\/api\/v1\/cases\/([0-9a-f-]+)(?:\/(tasks|notes|contacts|stage|change-proposals))?$/.exec(path);
        if(caseRoute) {
          const [,id,action]=caseRoute;
          if(!action&&req.method==='GET')return reply(200,await service.detail(user,id));
          if(!action&&req.method==='PATCH')return reply(200,await service.updateCustomer(user,id,await jsonBody(req),req.headers['idempotency-key']));
          if(req.method==='POST'&&action){
            const body=await jsonBody(req),key=req.headers['idempotency-key'];
            if(action==='tasks')return reply(201,await service.addTask(user,id,body,key));
            if(action==='notes')return reply(201,await service.addNote(user,id,body,key));
            if(action==='contacts')return reply(201,await service.updateTask(user,id,body.taskId,'contact',body,key));
            if(action==='stage')return reply(200,await service.changeStage(user,id,body,key));
            if(action==='change-proposals')return reply(201,await service.proposeChange(user,id,body,key));
          }
        }
        const taskRoute=/^\/api\/v1\/tasks\/([0-9a-f-]+)(?:\/(complete|reopen|exclude))?$/.exec(path);
        if(taskRoute) {
          const [,id,action]=taskRoute;
          if((req.method==='POST'&&action)||(req.method==='PATCH'&&!action)){
            const body=await jsonBody(req),caseId=await service.taskCase(user,id);
            return reply(200,await service.updateTask(user,caseId,id,action||'due',body,req.headers['idempotency-key']));
          }
        }
        throw new ApiError(404,'아직 연결되지 않았거나 존재하지 않는 API입니다.');
      }
      requireValue(req.method==='GET'||req.method==='HEAD','지원하지 않는 요청입니다.',405);
      if(path==='/'){res.writeHead(302,{Location:'/live'});res.end();return;}
      const asset=path.startsWith('/assets/');
      requireValue(asset||path.startsWith('/live'),'실제 저장 검수는 /live 주소에서 진행해 주세요.',404);
      const file=asset?resolve(dist,`.${decodeURIComponent(path)}`):resolve(dist,'index.html');
      requireValue(file.startsWith(resolve(dist)+sep),'잘못된 파일 주소입니다.',404);
      const content=await readFile(file);
      res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':asset?'public, max-age=31536000, immutable':'no-store'});
      res.end(req.method==='HEAD'?undefined:content);
    }catch(error){
      if(res.headersSent){res.end();return;}
      const status=error instanceof ApiError?error.status:error.code==='ENOENT'?404:500;
      if(status===429)res.setHeader('Retry-After','60');
      if(status===500)console.error('Request failed',error.name,error.code||'');
      reply(status,{error:{message:status===500?'저장 또는 조회에 실패했습니다. 입력을 유지하고 잠시 후 다시 시도해 주세요.':error.code==='ENOENT'?'화면 파일이 없습니다. 웹 빌드를 먼저 실행해 주세요.':error.message}});
    }
  });
  server.closeStreams=()=>streams.close();
  server.startRecoveryPolling=()=>startRecoveryPolling(recovery,{tenantIds:recoveryFetchPage?.tenantIds||[]});
  return server;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.env.NODE_ENV==='production')throw new Error('This first delivery is a loopback-only review server; production deployment is not enabled.');
  const webhookKeys=readWebhookKeys(process.env.CRM_EMERGENT_KEYS);
  const recoveryFetchPage=exportPageFetcher(readExportConnections(process.env.CRM_EMERGENT_EXPORTS));
  const db=await openDatabase();const server=makeServer(db,{webhookKeys,recoveryFetchPage});const port=Number(process.env.CRM_LOCAL_PORT||4180);
  const stopAutomation=startLocalAutomation(db);
  const recoveryPolling=server.startRecoveryPolling();
  server.listen(port,'127.0.0.1',()=>console.log(`CRM live review: http://127.0.0.1:${port}/live (persistent ${db.driver})`));
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.closeStreams();server.close(async()=>{await Promise.all([stopAutomation(),recoveryPolling.stop()]);await db.close();process.exit(0);});server.closeIdleConnections();});
}
