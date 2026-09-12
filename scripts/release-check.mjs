import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

export function isExpectedRelease(body, revision, releaseId, role) {
  return body?.status === 'ok' && body?.revision === revision &&
    body?.releaseId === releaseId && body?.role === role;
}

export function readyComponents(body, revision, releaseId, now = Date.now()) {
  if (body?.status !== 'ok' || !Array.isArray(body.components)) return false;
  // Include all active instances, not just the last writer for a role.
  // Old or unhealthy live instances prevent a partially deployed release from passing.
  return ['api', 'worker', 'scheduler'].every(role => {
    const instances = body.components.filter(item => item.role === role);
    return instances.length > 0 && instances.every(item => {
      const age = now - Date.parse(item.heartbeatAt);
      return item.ready === true && item.revision === revision && item.releaseId === releaseId &&
        Number.isFinite(age) && age >= -5000 && age < 90000;
    });
  });
}

export async function waitForRelease({ baseUrl, token, revision, releaseId, sourceTree, allowExistingRun = false, attempts = 40, intervalMs = 15000 }) {
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('CRM_BASE_URL must be a plain HTTPS origin without credentials');
  }
  if (!token || !/^[a-f0-9]{40}$/.test(revision) || (!allowExistingRun && !/^[0-9]+-[0-9]+$/.test(releaseId))) {
    throw new Error('Missing ops token or invalid release identity');
  }
  if (!/^[a-f0-9]{40}$/.test(sourceTree ?? '')) throw new Error('Missing source tree identity');
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const [web, api, components] = await Promise.all([
        fetch(new URL('/health/ready', url), { redirect: 'error', signal: AbortSignal.timeout(10000) }),
        fetch(new URL('/api/health/ready', url), { redirect: 'error', signal: AbortSignal.timeout(10000) }),
        fetch(new URL('/api/internal/ops/release', url), {
          redirect: 'error', signal: AbortSignal.timeout(10000),
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);
      if (web.ok && api.ok && components.ok) {
        const [w, a, c] = await Promise.all([web.json(), api.json(), components.json()]);
        // A staging-to-main merge can change the commit SHA without changing source files.
        // Compare the full Git tree, then require all staging roles to share one commit/run.
        const expectedRun = allowExistingRun ? w.releaseId : releaseId;
        const expectedRevision = allowExistingRun ? w.revision : revision;
        if (/^[0-9]+-[0-9]+$/.test(expectedRun) &&
            /^[a-f0-9]{40}$/.test(expectedRevision ?? '') &&
            w.sourceTree === sourceTree && a.sourceTree === sourceTree &&
            c.components?.every(item => item.sourceTree === sourceTree) &&
            isExpectedRelease(w, expectedRevision, expectedRun, 'web') &&
            isExpectedRelease(a, expectedRevision, expectedRun, 'api') && readyComponents(c, expectedRevision, expectedRun)) {
          console.log('Expected web/API release and live worker/scheduler heartbeats verified.');
          return;
        }
      }
    } catch {
      // Never log authorization tokens, response bodies, or redirected URLs.
    }
    console.log(`Release is not ready (${attempt}/${attempts}).`);
    if (attempt < attempts) await delay(intervalMs);
  }
  throw new Error('Release readiness could not be confirmed; inspect Railway deployments and application logs');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await waitForRelease({
      baseUrl: process.env.CRM_BASE_URL,
      token: process.env.OPS_READ_TOKEN,
      revision: process.env.GITHUB_SHA,
      sourceTree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim(),
      releaseId: `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`,
      allowExistingRun: process.argv.includes('--qualify-staging')
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
