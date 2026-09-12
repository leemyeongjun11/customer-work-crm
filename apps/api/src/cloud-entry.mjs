import { createServer } from 'node:http';
import { openDatabase } from './db.mjs';
import { makeServer } from './server.mjs';
import { cloudConfig, readRelease, instanceState, bootstrapCloud } from './cloud.mjs';
import { readWebhookKeys } from './ingestion.mjs';
import { readExportConnections, exportPageFetcher } from './emergent-export.mjs';
import { recoveryService } from './recovery.mjs';
import { startRecoveryPolling } from '../../scheduler/src/recovery-polling.mjs';
import { runScheduler } from '../../scheduler/src/run.mjs';
import { runWorker } from '../../worker/src/run.mjs';

const role = process.argv[2], config = cloudConfig(), release = readRelease();
if (!['api', 'worker', 'scheduler'].includes(role)) throw new Error('Invalid service role');
const databaseUrl = new URL(process.env.DATABASE_URL);
if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) throw new Error('Cloud requires PostgreSQL');
const port = Number(process.env.PORT || 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const db = await openDatabase(), state = instanceState(db, role, release);
const fetchPage = exportPageFetcher(readExportConnections(process.env.CRM_EMERGENT_EXPORTS));
let active = null, stopped = false, timer, recoveryPolling;
async function cycle() {
  if (stopped || active) return;
  active = (async () => {
    try {
      const at = new Date().toISOString();
      if (role === 'worker') await runWorker(db, at);
      if (role === 'scheduler') {
        await runScheduler(db, at);
        await db.query('DELETE FROM deployment_rate_limits WHERE window_start < $1', [Math.floor(Date.now() / 60000) - 5]);
      }
      state.setReady(true);
    } catch { state.setReady(false); console.error(`${role} cycle failed; retrying on next interval.`); }
    await state.beat();
  })();
  try { await active; } finally { active = null; }
}
let server;
if (role === 'api') {
  await bootstrapCloud(db);
  server = makeServer(db, { cloud: config, health: () => state.health(), webhookKeys: readWebhookKeys(process.env.CRM_EMERGENT_KEYS), recoveryFetchPage: fetchPage });
  state.setReady(true); await state.beat();
} else {
  server = createServer(async (req, res) => {
    if (req.url !== '/health/ready' || req.method !== 'GET') { res.writeHead(404); res.end(); return; }
    try { const result = await state.health(); res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(result)); }
    catch { res.writeHead(503); res.end('Not ready'); }
  });
  await cycle(); timer = setInterval(() => void cycle(), role === 'worker' ? 5000 : 30000);
  if (role === 'scheduler') recoveryPolling = startRecoveryPolling(recoveryService(db, { fetchPage }), { tenantIds: fetchPage?.tenantIds || [] });
}
server.listen(port, '::', () => console.log(`CRM ${config.environment} ${role} ready on port ${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  stopped = true; clearInterval(timer); server.closeStreams?.();
  const force = setTimeout(() => process.exit(1), 25000); force.unref();
  server.close(async () => {
    try { await active; await recoveryPolling?.stop(); await state.stop(); await db.close(); process.exit(0); }
    catch { process.exit(1); }
  });
  server.closeIdleConnections();
});
