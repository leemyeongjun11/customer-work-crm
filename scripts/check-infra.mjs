import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('infra/railway/services.json', 'utf8'));
assert.match(manifest.railwayCliVersion, /^\d+\.\d+\.\d+$/);
assert.deepEqual(manifest.services.map(s => s.name), ['api', 'worker', 'scheduler', 'web']);
for (const service of manifest.services) {
  const config = JSON.parse(readFileSync(`infra/railway/${service.name}.json`, 'utf8'));
  assert.equal(config.build.builder, 'DOCKERFILE');
  assert.equal(config.build.dockerfilePath, `${service.directory}/Dockerfile`);
  assert.equal(config.deploy.healthcheckPath, '/health/ready');
  assert.ok(config.deploy.healthcheckTimeout > 0);
  assert.equal(config.deploy.restartPolicyType, 'ON_FAILURE');
  assert.deepEqual(Object.keys(config.deploy.multiRegionConfig), ['asia-southeast1-eqsg3a']);
  assert.ok(config.deploy.multiRegionConfig['asia-southeast1-eqsg3a'].numReplicas >= 1);
  assert.equal(config.deploy.cronSchedule, undefined, 'Scheduler is a persistent service, not a Railway cron');
  if (process.argv.includes('--require-app')) {
    assert.ok(existsSync(config.build.dockerfilePath), `Application not supplied: ${config.build.dockerfilePath}`);
  }
}
if (process.argv.includes('--require-app')) {
  assert.ok(existsSync('scripts/ci-app.sh'), 'Implement scripts/ci-app.sh with actual application tests before enabling deploy');
}
console.log('Infrastructure configuration checks passed. This is not an application readiness check.');
