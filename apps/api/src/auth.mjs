import { randomBytes, scrypt as scryptCallback, createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { ApiError, text, requireValue } from './rules.mjs';
const scrypt = promisify(scryptCallback);
const options = {N:32768,r:8,p:1,maxmem:64*1024*1024};
const digest = token => createHash('sha256').update(token).digest('hex');

export async function createUser(tx, {tenantId, name, email, password, role = 'staff'}) {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, 64, options)).toString('hex');
  const id = randomUUID();
  await tx.query('INSERT INTO crm_users(id,tenant_id,name,email,role,password_hash,password_salt) VALUES($1,$2,$3,$4,$5,$6,$7)', [id,tenantId,name,email.toLowerCase(),role,hash,salt]);
  return id;
}
export async function login(db, emailValue, password, now = new Date()) {
  const email = text(emailValue, '이메일', 254).toLowerCase();
  requireValue(typeof password === 'string' && password.length <= 1024, '이메일 또는 비밀번호를 확인해 주세요.',401);
  const {rows} = await db.query('SELECT * FROM crm_users WHERE email=$1 AND active=true', [email]);
  const user = rows[0];
  const actual = await scrypt(password, user?.password_salt || 'absent-account-constant-salt', 64, options);
  if (!user || !timingSafeEqual(actual, Buffer.from(user.password_hash,'hex'))) throw new ApiError(401,'이메일 또는 비밀번호를 확인해 주세요.');
  const token = randomBytes(32).toString('base64url');
  await db.transaction(async tx=>{
    const fresh=(await tx.query('SELECT * FROM crm_users WHERE id=$1 FOR SHARE',[user.id])).rows[0];
    requireValue(fresh?.active&&fresh.password_hash===user.password_hash&&fresh.version===user.version,'계정 상태가 변경되었습니다. 다시 로그인해 주세요.',401);
    await tx.query('INSERT INTO crm_sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)', [digest(token), user.id, new Date(now.getTime()+8*3600000).toISOString()]);
  });
  await db.query('DELETE FROM crm_sessions WHERE expires_at < $1', [now.toISOString()]);
  return {token,user:publicUser(user)};
}
export function publicUser(user) { return {id:user.id,tenantId:user.tenant_id,name:user.name,email:user.email,role:user.role}; }
export async function authenticate(db, cookie, now = new Date()) {
  const token = /(?:^|;\s*)crm_session=([A-Za-z0-9_-]{43})(?:;|$)/.exec(cookie || '')?.[1];
  if (!token) throw new ApiError(401,'로그인이 필요합니다.');
  const {rows} = await db.query('SELECT u.* FROM crm_users u JOIN crm_sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>$2 AND u.active=true', [digest(token),now.toISOString()]);
  if (!rows[0]) throw new ApiError(401,'로그인이 만료되었습니다. 다시 로그인해 주세요.');
  return {...publicUser(rows[0]),tokenHash:digest(token)};
}
export function sessionCookie(token, clear = false) {
  return `crm_session=${clear ? '' : token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${clear ? 0 : 28800}`;
}
