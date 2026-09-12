import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {request} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {readyComponents} from './release-check.mjs';

// Disposable CI containers only. No Railway credentials or customer data are used.
const release=JSON.parse(readFileSync('release.json','utf8'));
const prefix=`crm-smoke-${randomBytes(5).toString('hex')}`,network=`${prefix}-net`,containers=[];
const password=randomBytes(24).toString('base64url'),proxy=randomBytes(32).toString('base64url'),ops=randomBytes(32).toString('base64url');
const env={NODE_ENV:'production',PORT:'8080',PUBLIC_APP_URL:'https://crm.example.test',CRM_ENVIRONMENT:'staging',CRM_PROXY_TOKEN:proxy,OPS_READ_TOKEN:ops,DATABASE_URL:`postgresql://crm:${password}@postgres:5432/crm_ci`,CRM_BOOTSTRAP_ADMIN_EMAIL:'admin@example.test',CRM_BOOTSTRAP_STAFF_EMAIL:'staff@example.test',CRM_BOOTSTRAP_ADMIN_PASSWORD:password,CRM_BOOTSTRAP_STAFF_PASSWORD:randomBytes(24).toString('base64url'),API_INTERNAL_URL:'http://api.railway.internal:8080'};
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:120000,stdio:['ignore','pipe','pipe']}).trim();
function start(name,image,extra=[],variables={}){const id=`${prefix}-${name}`;containers.push(id);docker('run','--detach','--name',id,'--network',network,...extra,...Object.entries(variables).flatMap(([k,v])=>['--env',`${k}=${v}`]),image);return id;}
async function until(fn,label){for(let i=0;i<60;i++){try{if(await fn())return;}catch{}await delay(1000);}throw new Error(`Timed out: ${label}`);}
function call(path,{method='GET',body,cookie,authorization}={}){return new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port:18089,path,method,headers:{Host:'crm.example.test','X-Forwarded-Proto':'https','X-Real-IP':'192.0.2.2',Origin:env.PUBLIC_APP_URL,'Content-Type':'application/json','Idempotency-Key':randomUUID(),...(cookie?{Cookie:cookie}:{}),...(authorization?{Authorization:authorization}:{})}},res=>{let text='';res.setEncoding('utf8');res.on('data',s=>text+=s);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text,json:()=>JSON.parse(text)}));});req.on('error',reject);req.setTimeout(5000,()=>req.destroy(new Error('timeout')));req.end(body?JSON.stringify(body):undefined);});}
try{
  docker('network','create',network);
  const pg=start('postgres','postgres:17-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0',['--network-alias','postgres'],{POSTGRES_USER:'crm',POSTGRES_DB:'crm_ci',POSTGRES_PASSWORD:password});
  await until(()=>{docker('exec',pg,'pg_isready','-U','crm','-d','crm_ci');return true;},'PostgreSQL');
  for(const role of ['api','worker','scheduler'])start(role,`crm-${role}:${release.revision}`,['--network-alias',`${role}.railway.internal`],env);
  start('web',`crm-web:${release.revision}`,['--publish','127.0.0.1:18089:8080'],env);
  await until(async()=>{const r=await call('/api/health/ready');return r.status===200&&r.json().revision===release.revision;},'API readiness');
  assert.equal((await call('/live')).status,200);
  const signed=await call('/api/v1/auth/login',{method:'POST',body:{email:env.CRM_BOOTSTRAP_ADMIN_EMAIL,password}});
  assert.equal(signed.status,200);const header=signed.headers['set-cookie'][0];assert.match(header,/^__Host-crm_session=/);assert.match(header,/; Secure/);const cookie=header.split(';')[0];
  const receipt=await call('/api/v1/public/inquiries/local-review',{method:'POST',body:{customerType:'person',name:'Container verification',phone:'010-0000-0000',email:'synthetic@example.test',memo:'Disposable automated verification'}});assert.equal(receipt.status,201);const id=receipt.json().receiptId;
  let detail=(await call(`/api/v1/cases/${id}`,{cookie})).json();assert.equal(detail.tasks.length,1);
  const contact=await call(`/api/v1/cases/${id}/contacts`,{cookie,method:'POST',body:{taskId:detail.tasks[0].id,outcome:'connected',actualAt:new Date().toISOString(),expectedVersion:1}});assert.equal(contact.status,201);
  // Recreate the API container: its filesystem is gone, but PostgreSQL/session/task data must remain.
  docker('rm','--force',`${prefix}-api`);containers.splice(containers.indexOf(`${prefix}-api`),1);
  start('api',`crm-api:${release.revision}`,['--network-alias','api.railway.internal'],env);
  await until(async()=>{const r=await call(`/api/v1/cases/${id}`,{cookie});return r.status===200&&r.json().tasks[0].status==='complete';},'persisted case/session after API recreation');
  assert.equal((await call('/api/internal/ops/release')).status,401);
  await until(async()=>{const r=await call('/api/internal/ops/release',{authorization:`Bearer ${ops}`});return r.status===200&&readyComponents(r.json(),release.revision,release.releaseId);},'all runtime roles');
  console.log('Four real containers passed login, intake, contact, persistent restart and release-heartbeat verification.');
}catch(error){for(const id of containers){try{console.error(`${id}:\n${docker('logs','--tail','30',id)}`);}catch{}}throw error;
}finally{for(const id of containers){try{docker('rm','--force',id);}catch{}}try{docker('network','rm',network);}catch{}}
