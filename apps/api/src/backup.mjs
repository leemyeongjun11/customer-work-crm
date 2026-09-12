import {randomUUID,randomBytes,createHash,createCipheriv,createDecipheriv} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {openDatabase,localRoot} from './db.mjs';
import {ApiError,requireValue,fields,text,iso} from './rules.mjs';

const tables=['crm_tenants','crm_users','crm_cases','crm_tasks','crm_notes','crm_contacts','crm_audit','crm_idempotency','crm_change_proposals','crm_notification_jobs','crm_review_mail','crm_settings_history','crm_source_inquiries','crm_source_events','crm_change_cursors','crm_changes','crm_recovery_state','crm_recovery_errors'];
tables.push('crm_account_history');
const omitted=['crm_sessions','crm_runtime_state','crm_backups'];
const MAX=50*1024*1024;
const signature=async()=>createHash('sha256').update((await readFile(new URL('./schema.sql',import.meta.url),'utf8')).replace(/\r\n/g,'\n')).digest('hex');
const admin=u=>requireValue(u.role==='admin','백업은 관리자만 관리할 수 있습니다.',403);
const view=b=>({id:b.id,status:b.status,reason:b.reason,filename:b.filename,counts:b.counts,createdAt:iso(b.created_at),verifiedAt:iso(b.verified_at),message:b.message});
async function columns(tx){
  const {rows}=await tx.query("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name LIKE 'crm\\_%' ESCAPE '\\' ORDER BY table_name,ordinal_position");
  requireValue(rows.every(r=>tables.includes(r.table_name)||omitted.includes(r.table_name)),'새 데이터 항목의 백업 규칙을 먼저 갱신해야 합니다.',409);
  return rows;
}

export async function companySnapshot(db,tenantId,at=new Date().toISOString()){
  const schemaHash=await signature();
  return db.transaction(async tx=>{
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await columns(tx);const data={};
    for(const table of tables)data[table]=(await tx.query(`SELECT * FROM ${table} WHERE ${table==='crm_tenants'?'id':'tenant_id'}=$1`,[tenantId])).rows;
    requireValue(data.crm_tenants.length===1,'백업할 회사를 찾을 수 없습니다.',404);
    const snapshot={format:'crm-company',version:1,schemaHash,tenantId,createdAt:at,data};
    requireValue(Buffer.byteLength(JSON.stringify(snapshot))<=MAX,'로컬 백업 크기 한도를 초과했습니다. 운영 백업 도구가 필요합니다.',413);
    return snapshot;
  });
}

export function sealBackup(snapshot,key){
  requireValue(Buffer.isBuffer(key)&&key.length===32,'백업 암호화 키를 확인해 주세요.');
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('crm-backup-v1'));
  const encrypted=Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(snapshot)))),cipher.final()]);
  return Buffer.from(JSON.stringify({format:'crm-backup-v1',iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:encrypted.toString('base64')}));
}
export function unsealBackup(bytes,key){
  try{
    requireValue(bytes.length<=MAX*2&&key.length===32,'Invalid backup');
    const e=JSON.parse(bytes.toString('utf8'));requireValue(e.format==='crm-backup-v1','Invalid format');
    const iv=Buffer.from(e.iv,'base64'),tag=Buffer.from(e.tag,'base64');requireValue(iv.length===12&&tag.length===16,'Invalid envelope');
    const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(Buffer.from('crm-backup-v1'));decipher.setAuthTag(tag);
    return JSON.parse(gunzipSync(Buffer.concat([decipher.update(Buffer.from(e.data,'base64')),decipher.final()]),{maxOutputLength:MAX}).toString('utf8'));
  }catch{throw new ApiError(422,'백업 파일이 손상되었거나 암호화 키가 일치하지 않습니다.');}
}

export async function restoreIntoEmpty(db,snapshot){
  // Explicit migration for the delivered 06g backup schema; never accept an unknown fingerprint.
  if(snapshot?.schemaHash==='ab3935611413d6d1be019b35bd1dffd04cbd45cdb28b839f1391f6c3046ab1b8'){
    requireValue(snapshot.data&&Object.keys(snapshot.data).length===tables.length-1&&!Object.hasOwn(snapshot.data,'crm_account_history')&&Array.isArray(snapshot.data.crm_users),'이전 백업 구조를 확인해 주세요.',409);
    requireValue(snapshot.data.crm_users.every(u=>!Object.hasOwn(u,'version')),'이전 계정 구조가 일치하지 않습니다.',409);
    snapshot={...snapshot,schemaHash:await signature(),data:{...snapshot.data,crm_users:snapshot.data.crm_users.map(u=>({...u,version:1})),crm_account_history:[]}};
  }
  requireValue(snapshot?.format==='crm-company'&&snapshot.version===1&&snapshot.schemaHash===await signature(),'이 백업을 만든 코드 버전과 데이터 구조를 확인해 주세요.',409);
  requireValue(snapshot.data&&Object.keys(snapshot.data).length===tables.length&&tables.every(t=>Array.isArray(snapshot.data[t])),'백업 데이터 목록을 확인해 주세요.');
  return db.transaction(async tx=>{
    const metadata=await columns(tx),counts={};
    for(const table of [...tables,...omitted])requireValue(Number((await tx.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n)===0,'복원 대상은 비어 있는 새 데이터베이스여야 합니다.',409);
    requireValue(snapshot.data.crm_tenants.length===1,'회사 백업 범위가 올바르지 않습니다.');
    for(const table of tables){
      const spec=metadata.filter(c=>c.table_name===table),names=spec.map(c=>c.column_name);
      for(const row of snapshot.data[table]){
        requireValue(row&&Object.keys(row).length===names.length&&names.every(n=>Object.hasOwn(row,n)),'백업 항목 구조가 일치하지 않습니다.');
        requireValue(row[table==='crm_tenants'?'id':'tenant_id']===snapshot.tenantId,'다른 회사의 데이터가 섞인 백업입니다.');
        const values=spec.map(c=>row[c.column_name]===null?null:['json','jsonb'].includes(c.data_type)?JSON.stringify(row[c.column_name]):row[c.column_name]);
        await tx.query(`INSERT INTO ${table}(${names.map(n=>`"${n}"`).join(',')}) VALUES(${names.map((_,i)=>`$${i+1}`).join(',')})`,values);
      }
      counts[table]=Number((await tx.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
      requireValue(counts[table]===snapshot.data[table].length,'복원 데이터 수가 일치하지 않습니다.',500);
    }
    // A restored copy must not resume past notifications or stale recovery leases on its own.
    await tx.query("UPDATE crm_notification_jobs SET status='blocked',reason='백업 복원 후 재실행 여부 확인 필요' WHERE status IN ('queued','retry')");
    await tx.query("UPDATE crm_recovery_state SET status='blocked',lease_id=NULL,lease_until=NULL,next_run=NULL,message='백업 복원 후 연결 확인 필요'");
    return {tenantId:snapshot.tenantId,counts,sessionsRestored:0,pendingAutomationHeld:true};
  });
}

export async function restoreToNewDirectory({file,keyFile,directory}){
  const bytes=await readFile(file),key=await readFile(keyFile),snapshot=unsealBackup(bytes,key);
  const target=resolve(directory);await mkdir(dirname(target),{recursive:true});
  // Exclusive creation refuses existing folders, including the running local database.
  await mkdir(target);
  const db=await openDatabase({url:'',directory:target});
  try{return {...await restoreIntoEmpty(db,snapshot),directory:target};}finally{await db.close();}
}

export function backupService(db,{directory=join(localRoot,'backups'),clock=()=>new Date()}={}){
  async function readKey(){
    await mkdir(directory,{recursive:true});const path=join(directory,'backup.key');
    try {await writeFile(path,randomBytes(32),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
    const key=await readFile(path);requireValue(key.length===32,'백업 암호화 키 파일을 확인해 주세요.',503);return key;
  }
  return {
    async list(user){admin(user);return {items:(await db.query('SELECT * FROM crm_backups WHERE tenant_id=$1 ORDER BY created_at DESC,id DESC LIMIT 20',[user.tenantId])).rows.map(view),mode:'local-encrypted',restoreMode:'new-database-only'};},
    async create(user,body,key){
      admin(user);fields(body,['reason']);const reason=text(body.reason,'백업 이유',500);
      requireValue(typeof key==='string'&&/^[A-Za-z0-9_-]{8,128}$/.test(key),'중복 방지 키가 필요합니다.');
      const id=randomUUID(),createdAt=clock().toISOString();
      const claim=await db.transaction(async tx=>{
        const inserted=await tx.query("INSERT INTO crm_backups(id,tenant_id,requested_by,request_key,reason,status,created_at) VALUES($1,$2,$3,$4,$5,'creating',$6) ON CONFLICT(tenant_id,request_key) DO NOTHING RETURNING *",[id,user.tenantId,user.id,key,reason,createdAt]);
        const row=inserted.rows[0]||(await tx.query('SELECT * FROM crm_backups WHERE tenant_id=$1 AND request_key=$2',[user.tenantId,key])).rows[0];
        requireValue(row.reason===reason,'같은 요청 키의 백업 이유가 달라 확인이 필요합니다.',409);
        return {row,fresh:!!inserted.rows[0]};
      });
      if(!claim.fresh)return view(claim.row);
      try{
        const snapshot=await companySnapshot(db,user.tenantId,createdAt),secret=await readKey();
        const filename=`${id}.crmbackup`,file=join(directory,filename);
        await writeFile(file,sealBackup(snapshot,secret),{flag:'wx',mode:0o600});
        const verified=unsealBackup(await readFile(file),secret);
        const testDb=await openDatabase({url:'',directory:''});let result;
        try{result=await restoreIntoEmpty(testDb,verified);}finally{await testDb.close();}
        const row=(await db.query("UPDATE crm_backups SET status='ready',filename=$2,counts=$3,verified_at=$4,message='암호화 저장 및 별도 DB 복원 검증 완료' WHERE id=$1 RETURNING *",[id,filename,JSON.stringify(result.counts),clock().toISOString()])).rows[0];
        return view(row);
      }catch(e){
        const note=e instanceof ApiError?e.message:'백업 저장 또는 복원 검증에 실패했습니다. 서버 저장 공간과 로그를 확인해 주세요.';
        await db.query("UPDATE crm_backups SET status='failed',message=$2 WHERE id=$1",[id,note]);
        throw new ApiError(503,note);
      }
    },
  };
}
