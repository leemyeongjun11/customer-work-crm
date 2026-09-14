import { randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createUser } from './auth.mjs';
import { ApiError } from './rules.mjs';

export function sameSecret(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || !expected) return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function cloudConfig(env = process.env) {
  const origin = new URL(env.PUBLIC_APP_URL);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('PUBLIC_APP_URL must be an HTTPS origin');
  for (const key of ['CRM_PROXY_TOKEN', 'OPS_READ_TOKEN']) if (!/^[A-Za-z0-9_-]{32,128}$/.test(env[key] ?? '')) throw new Error(`Invalid ${key}`);
  if (env.CRM_PROXY_TOKEN === env.OPS_READ_TOKEN) throw new Error('Use different proxy and ops tokens');
  if (!['staging', 'production'].includes(env.CRM_ENVIRONMENT)) throw new Error('Set CRM_ENVIRONMENT');
  return { origin: origin.origin, host: origin.host, proxyToken: env.CRM_PROXY_TOKEN, opsToken: env.OPS_READ_TOKEN, environment: env.CRM_ENVIRONMENT };
}
export function readRelease(path = new URL('../../../release.json', import.meta.url)) {
  const release = JSON.parse(readFileSync(path, 'utf8'));
  if (!/^[a-f0-9]{40}$/.test(release.revision ?? '') || !/^[a-f0-9]{40}$/.test(release.sourceTree ?? '') || !/^\d+-\d+$/.test(release.releaseId ?? '')) throw new Error('Missing or invalid release.json');
  return release;
}
export async function rateLimit(db, key, maximum, at = Date.now()) {
  const window = Math.floor(at / 60000);
  const bucket = createHash('sha256').update(key).digest('hex');
  const row = (await db.query(`INSERT INTO deployment_rate_limits(bucket_key,window_start,hits) VALUES($1,$2,1)
    ON CONFLICT(bucket_key) DO UPDATE SET window_start=$2,hits=CASE WHEN deployment_rate_limits.window_start=$2 THEN deployment_rate_limits.hits+1 ELSE 1 END RETURNING hits`, [bucket, window])).rows[0];
  if (row.hits > maximum) throw new ApiError(429, '요청이 많습니다. 1분 뒤 다시 시도해 주세요.');
}
export function instanceState(db, role, release, { intervalMs = 15000 } = {}) {
  const id = randomUUID(); let ready = false, lastReady = 0, stopped = false, pending = null;
  const isReady = () => ready && (role === 'api' || Date.now() - lastReady < 90000);
  async function beat() {
    if (stopped || pending) return;
    pending = db.query(`INSERT INTO deployment_instances(instance_id,role,revision,source_tree,release_id,ready,heartbeat_at) VALUES($1,$2,$3,$4,$5,$6,now())
      ON CONFLICT(instance_id) DO UPDATE SET ready=$6,heartbeat_at=now()`, [id, role, release.revision, release.sourceTree, release.releaseId, isReady()]);
    try { await pending; } catch { console.error('Runtime heartbeat failed.'); } finally { pending = null; }
  }
  const timer = setInterval(() => void beat(), intervalMs);
  return {
    setReady(value) { ready = value; if(value)lastReady = Date.now(); },
    async health() {
      if (!isReady()) throw new ApiError(503, '서비스 준비 중입니다.');
      await db.query('SELECT 1');
      return { status: 'ok', role, ...release };
    },
    beat,
    async stop() { stopped = true; clearInterval(timer); await pending?.catch(() => {}); await db.query('UPDATE deployment_instances SET ready=false,heartbeat_at=now() WHERE instance_id=$1', [id]); },
  };
}
export async function deploymentStatus(db) {
  const {rows} = await db.query(`SELECT instance_id AS "instanceId",role,revision,source_tree AS "sourceTree",release_id AS "releaseId",ready,heartbeat_at AS "heartbeatAt"
    FROM deployment_instances WHERE heartbeat_at > now() - interval '90 seconds' ORDER BY role,instance_id`);
  return { status: 'ok', components: rows };
}
export async function bootstrapCloud(db, env = process.env) {
  // An absent bootstrap configuration preserves existing accounts. Never reset on restart.
  if (!env.CRM_BOOTSTRAP_ADMIN_EMAIL) return;
  for (const key of ['CRM_BOOTSTRAP_ADMIN_PASSWORD', 'CRM_BOOTSTRAP_STAFF_PASSWORD']) if (!/^[A-Za-z0-9_-]{24,128}$/.test(env[key] ?? '')) throw new Error(`Invalid ${key}`);
  const adminEmail = env.CRM_BOOTSTRAP_ADMIN_EMAIL, staffEmail = env.CRM_BOOTSTRAP_STAFF_EMAIL;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(staffEmail ?? '') || adminEmail.toLowerCase() === staffEmail.toLowerCase()) throw new Error('Invalid bootstrap account emails');
  await db.transaction(async tx => {
    if (db.driver === 'postgres') await tx.query('SELECT pg_advisory_xact_lock(81402027)');
    if ((await tx.query("SELECT id FROM crm_tenants WHERE public_slug='local-review'")).rows.length) return;
    if (Number((await tx.query('SELECT count(*) AS n FROM crm_tenants')).rows[0].n)) throw new Error('Bootstrap only applies to a new empty database');
    const tenantId = randomUUID();
    await tx.query("INSERT INTO crm_tenants(id,name,public_slug) VALUES($1,$2,'local-review')", [tenantId, env.CRM_ENVIRONMENT === 'staging' ? 'CRM 시험 기업' : 'CRM 운영 기업']);
    await createUser(tx, { tenantId, name: '관리자', email: adminEmail, password: env.CRM_BOOTSTRAP_ADMIN_PASSWORD, role: 'admin' });
    const staffId = await createUser(tx, { tenantId, name: '접수 담당 직원', email: staffEmail, password: env.CRM_BOOTSTRAP_STAFF_PASSWORD });
    await tx.query('UPDATE crm_tenants SET default_assignee_id=$2 WHERE id=$1', [tenantId, staffId]);
  });
}
