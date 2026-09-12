import { appendFileSync, readFileSync } from 'node:fs';
const target = process.argv[2];
if (!['staging', 'production'].includes(target)) throw new Error('Invalid deployment target');
const expectedRef = `refs/heads/${target === 'production' ? 'main' : 'staging'}`;
if (process.env.GITHUB_REF !== expectedRef || !process.env.GITHUB_ENV) throw new Error('Incorrect GitHub deployment branch or context');
const targets = JSON.parse(readFileSync('infra/railway/targets.json', 'utf8'));
const manifest = JSON.parse(readFileSync('infra/railway/services.json', 'utf8'));
if (targets.environments.staging === targets.environments.production) throw new Error('Environments must be separate');
const values = { RAILWAY_ENVIRONMENT_ID: targets.environments[target] };
for (const service of manifest.services) values[service.serviceVariable] = targets.services[service.name];
for (const value of Object.values(values)) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value ?? '')) throw new Error('Invalid Railway target identifier');
}
appendFileSync(process.env.GITHUB_ENV, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
console.log(`Selected ${target} service identifiers. No deployment has been started.`);
