import { randomBytes, randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDatabase, localRoot } from './db.mjs';
import { createUser } from './auth.mjs';

export async function provision(db,{company='로컬 검수 기업',slug='local-review',password,adminEmail='admin@crm.local',staffEmail='staff@crm.local'}={}){
  return db.transaction(async tx=>{
    const tenantId=randomUUID();
    await tx.query('INSERT INTO crm_tenants(id,name,public_slug) VALUES($1,$2,$3)',[tenantId,company,slug]);
    const adminId=await createUser(tx,{tenantId,name:'검수 관리자',email:adminEmail,password,role:'admin'});
    const staffId=await createUser(tx,{tenantId,name:'접수 담당 직원',email:staffEmail,password});
    await tx.query('UPDATE crm_tenants SET default_assignee_id=$2 WHERE id=$1',[tenantId,staffId]);
    return {tenantId,adminId,staffId};
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.env.NODE_ENV==='production'||process.env.DATABASE_URL)throw new Error('Local account setup must only run against the local review database.');
  const db=await openDatabase();
  try{
    const existing=await db.query('SELECT id FROM crm_tenants WHERE public_slug=$1',['local-review']);
    if(existing.rows.length)console.log(`Existing local accounts preserved. Access file: ${localRoot}/access.txt`);
    else{
      const password=`Local-${randomBytes(12).toString('base64url')}`;
      await provision(db,{password});
      await mkdir(localRoot,{recursive:true});
      await writeFile(`${localRoot}/access.txt`, `6차 실제 저장 검수 전용 계정\n주소: http://127.0.0.1:4180/live\n관리자: admin@crm.local\n담당 직원: staff@crm.local\n두 계정의 검수 비밀번호: ${password}\n\n이 파일은 Git에서 제외됩니다. 외부 운영 계정으로 사용하지 않습니다.\n`,{mode:0o600});
      console.log(`Local accounts created. Access file: ${localRoot}/access.txt`);
    }
  }finally{await db.close();}
}
