import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../src/db.mjs';
import {makeServer} from '../src/server.mjs';
import {webServer} from '../../web/server.mjs';
import {bootstrapCloud,cloudConfig,rateLimit,instanceState,deploymentStatus} from '../src/cloud.mjs';

const env={PUBLIC_APP_URL:'https://crm.example.test',CRM_ENVIRONMENT:'staging',CRM_PROXY_TOKEN:'p'.repeat(40),OPS_READ_TOKEN:'o'.repeat(40),CRM_BOOTSTRAP_ADMIN_EMAIL:'admin@example.test',CRM_BOOTSTRAP_STAFF_EMAIL:'staff@example.test',CRM_BOOTSTRAP_ADMIN_PASSWORD:'a'.repeat(32),CRM_BOOTSTRAP_STAFF_PASSWORD:'s'.repeat(32)};
const release={revision:'a'.repeat(40),sourceTree:'b'.repeat(40),releaseId:'123-1'};
test('Cloud proxy enforces HTTPS origin, secure sessions, ops authentication and streams',async t=>{
  const db=await openDatabase({url:'',directory:''}),dist=await mkdtemp(join(tmpdir(),'crm-cloud-test-'));
  await writeFile(join(dist,'index.html'),'<html>Cloud test</html>');
  const servers=[],controllers=[];
  t.after(async()=>{for(const c of controllers)c.abort();for(const s of servers.reverse()){s.closeStreams?.();s.closeAllConnections();await new Promise(r=>s.close(r));}await db.close();await rm(dist,{recursive:true,force:true});});
  await bootstrapCloud(db,env);
  await bootstrapCloud(db,{...env,CRM_BOOTSTRAP_ADMIN_PASSWORD:'changed'.repeat(5)});
  assert.equal((await db.query('SELECT count(*)::int n FROM crm_users')).rows[0].n,2);
  const config=cloudConfig(env),api=makeServer(db,{cloud:config,health:async()=>({status:'ok',role:'api',...release}),eventPollMs:25});
  servers.push(api);await new Promise(r=>api.listen(0,'127.0.0.1',r));
  const apiUrl=`http://127.0.0.1:${api.address().port}`;
  const web=webServer({config,release,apiUrl,dist});servers.push(web);await new Promise(r=>web.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${web.address().port}`;
  config.host=new URL(base).host; // Node fetch controls Host; simulate the edge on this loopback listener.
  const headers={Host:config.host,'X-Forwarded-Proto':'https',Origin:config.origin,'Content-Type':'application/json','X-Real-IP':'192.0.2.1'};
  const call=(path,options={})=>fetch(base+path,{...options,headers:{...headers,...options.headers}});
  assert.equal((await fetch(apiUrl+'/v1/auth/me')).status,403);
  assert.equal((await fetch(base+'/live')).status,403);
  assert.equal((await call('/live')).status,200);
  assert.equal((await call('/.env')).status,404);
  assert.equal((await call('/api/internal/ops/release')).status,401);
  assert.equal((await call('/api/internal/ops/release',{headers:{Authorization:`Bearer ${env.OPS_READ_TOKEN}`,'X-CRM-Proxy-Token':'attacker'}})).status,200);
  assert.equal((await call('/api/health/ready')).status,200);
  const loginBody=JSON.stringify({email:env.CRM_BOOTSTRAP_ADMIN_EMAIL,password:env.CRM_BOOTSTRAP_ADMIN_PASSWORD});
  assert.equal((await call('/api/v1/auth/login',{method:'POST',body:loginBody,headers:{Origin:'https://evil.test'}})).status,403);
  const signed=await call('/api/v1/auth/login',{method:'POST',body:loginBody});assert.equal(signed.status,200);
  const cookieHeader=signed.headers.get('set-cookie');assert.match(cookieHeader,/^__Host-crm_session=/);assert.match(cookieHeader,/; Secure/);assert.match(cookieHeader,/HttpOnly/);assert.match(cookieHeader,/SameSite=Strict/);
  const cookie=cookieHeader.split(';')[0];
  assert.equal((await call('/api/v1/auth/me',{headers:{Cookie:cookie.replace('__Host-','')}})).status,401);
  assert.equal((await call('/api/v1/auth/me',{headers:{Cookie:cookie}})).status,200);
  const received=await call('/api/v1/public/inquiries/local-review',{method:'POST',headers:{'Idempotency-Key':randomUUID()},body:JSON.stringify({customerType:'person',name:'Cloud test',phone:'010-0000-0000',email:'test@example.test',memo:'Synthetic test'})});assert.equal(received.status,201);
  assert.equal((await (await call('/api/v1/cases',{headers:{Cookie:cookie}})).json()).items.length,1);
  const controller=new AbortController();controllers.push(controller);
  const stream=await call('/api/v1/events',{headers:{Cookie:cookie},signal:controller.signal});assert.equal(stream.status,200);assert.match(stream.headers.get('content-type'),/text\/event-stream/);
  const reader=stream.body.getReader();let text='';
  while(!text.includes('event: ready')){const chunk=await reader.read();assert.equal(chunk.done,false);text+=new TextDecoder().decode(chunk.value);}
  await db.query('DELETE FROM crm_sessions');
  while(!text.includes('event: session-expired')){const chunk=await reader.read();assert.equal(chunk.done,false);text+=new TextDecoder().decode(chunk.value);}
  controller.abort();
  assert.equal((await call('/api/v1/auth/me',{headers:{Cookie:cookie}})).status,401);
});

test('Cloud rate limits persist across callers, and readiness tracks role instances',async t=>{
  const db=await openDatabase({url:'',directory:''});let state;t.after(async()=>{await state?.stop();await db.close();});
  const outcomes=await Promise.allSettled(Array.from({length:4},()=>rateLimit(db,'same-client',2,60000)));
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,2);
  assert.ok(outcomes.filter(x=>x.status==='rejected').every(x=>x.reason.status===429));
  await rateLimit(db,'same-client',2,120000);
  state=instanceState(db,'worker',release,{intervalMs:100000});
  await assert.rejects(state.health(),e=>e.status===503);state.setReady(true);await state.beat();
  assert.equal((await state.health()).releaseId,'123-1');
  assert.equal((await deploymentStatus(db)).components[0].ready,true);
  state.setReady(false);await state.beat();assert.equal((await deploymentStatus(db)).components[0].ready,false);
});
