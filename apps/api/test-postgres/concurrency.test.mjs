import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {openDatabase} from '../src/db.mjs';
import {provision} from '../src/setup.mjs';
import {ingestionService} from '../src/ingestion.mjs';
import {createService} from '../src/service.mjs';
import {processNotification} from '../src/notifications.mjs';
import {companySnapshot,restoreIntoEmpty} from '../src/backup.mjs';

// Refuse missing configuration and non-CI targets rather than silently skip a required gate.
const raw=process.env.CRM_TEST_DATABASE_URL;
if(!raw)throw new Error('CRM_TEST_DATABASE_URL is required. PostgreSQL checks were not run.');
let url;try{url=new URL(raw);}catch{throw new Error('Invalid dedicated CI database configuration.');}
if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||url.pathname!=='/crm_ci'||url.search||url.hash)throw new Error('Use the dedicated loopback crm_ci database; other database targets are refused.');

test('PostgreSQL 다중 연결: 중복 수신·동시 수정·Worker 경합·PGlite 복원 호환',async t=>{
  const control=new pg.Client({connectionString:raw,connectionTimeoutMillis:5000});
  const name=`crm_ci_${randomUUID().replaceAll('-','')}`;let created=false,a,b,restored;
  t.after(async()=>{
    await Promise.all([a?.close(),b?.close(),restored?.close()]);
    try{if(created){assert.match(name,/^crm_ci_[0-9a-f]{32}$/);await control.query(`DROP DATABASE "${name}"`);}}finally{await control.end();}
  });
  await control.connect();await control.query(`CREATE DATABASE "${name}"`);created=true;
  const target=new URL(url);target.pathname=`/${name}`;
  a=await openDatabase({url:target.href});b=await openDatabase({url:target.href});
  assert.equal(a.driver,'postgres');assert.equal(b.driver,'postgres');
  const pidA=(await a.query('SELECT pg_backend_pid() AS id')).rows[0].id,pidB=(await b.query('SELECT pg_backend_pid() AS id')).rows[0].id;assert.notEqual(pidA,pidB);
  const c=await provision(a,{password:'CI-only-password-2026'}),actor={id:c.adminId,tenantId:c.tenantId,role:'admin'};
  const event={schemaVersion:1,eventType:'inquiry.created',eventId:'ci-event-1',sourceInquiryId:'ci-inquiry-1',sourceReceivedAt:new Date().toISOString(),payload:{customerType:'person',name:'PostgreSQL 동시 접수',phone:'010-0000-0000',email:'pg-ci@example.com',requestMemo:'중복 없이 저장할 상담'}};
  const received=await Promise.all([a,b].map(db=>ingestionService(db).importVerified(c.tenantId,event)));
  assert.deepEqual(received.map(r=>r.status).sort(),[200,201]);assert.equal(Number((await a.query('SELECT count(*) AS n FROM crm_cases')).rows[0].n),1);
  const id=(await a.query('SELECT id FROM crm_cases')).rows[0].id;
  const writes=await Promise.allSettled([a,b].map(db=>createService(db).changeStage(actor,id,{stage:'상담 진행',expectedVersion:1,reason:'동시 수정 검수'},randomUUID())));
  assert.equal(writes.filter(r=>r.status==='fulfilled').length,1);assert.equal(writes.find(r=>r.status==='rejected').reason.status,409);
  const at=new Date(Date.now()+1000).toISOString();await Promise.all([a,b].map(db=>processNotification(db,{at})));
  while(await processNotification(a,{at})){}
  const mail=(await a.query('SELECT job_id FROM crm_review_mail')).rows;assert.equal(mail.length,2);assert.equal(new Set(mail.map(m=>m.job_id)).size,2);
  assert.ok((await a.query('SELECT attempts FROM crm_notification_jobs')).rows.every(r=>r.attempts===1));
  const snapshot=await companySnapshot(a,c.tenantId);restored=await openDatabase({url:'',directory:''});
  const result=await restoreIntoEmpty(restored,snapshot);assert.equal(result.counts.crm_cases,1);assert.equal(result.counts.crm_review_mail,2);
});
