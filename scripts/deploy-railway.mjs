import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const manifest = JSON.parse(readFileSync('infra/railway/services.json', 'utf8'));
const revision = process.env.GITHUB_SHA;
const releaseId = `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
const sourceTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(revision ?? '') || !/^[0-9]+-[0-9]+$/.test(releaseId)) {
  throw new Error('Deploy must use a concrete GitHub Actions revision and run identity');
}
for (const key of ['RAILWAY_TOKEN', 'RAILWAY_ENVIRONMENT_ID', ...manifest.services.map(s => s.serviceVariable)]) {
  if (!process.env[key]) throw new Error(`Missing configuration: ${key}`);
}
if (execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== revision) {
  throw new Error('Checkout does not match the requested release');
}
// A fresh tracked-file archive excludes .env files, uncommitted files and previous build output.
const directory = mkdtempSync(join(tmpdir(), 'crm-railway-release-'));
try {
  const archive = join(directory, 'source.tar');
  const source = join(directory, 'source');
  execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, revision]);
  mkdirSync(source);
  execFileSync('tar', ['-xf', archive, '-C', source]);
  writeFileSync(join(source, 'release.json'), JSON.stringify({ revision, sourceTree, releaseId }));
  // These generated files are required build inputs; gitignore excludes them in the working tree.
  // The archive only contains tracked source, so remove this ignore file in the disposable copy.
  rmSync(join(source, '.gitignore'), { force: true });
  for (const service of manifest.services) {
    cpSync(join(source, 'infra', 'railway', `${service.name}.json`), join(source, 'railway.json'));
    console.log(`Deploying ${service.name} at ${revision}`);
    // --ci only completes the build. release-check.mjs must confirm the running release afterwards.
    execFileSync('railway', [
      'up', source, '--path-as-root', '--ci',
      '--service', process.env[service.serviceVariable],
      '--environment', process.env.RAILWAY_ENVIRONMENT_ID
    ], { stdio: 'inherit', timeout: 20 * 60 * 1000 });
  }
} finally {
  // Only the fresh directory created above is removed; repository files are never deleted.
  rmSync(directory, { recursive: true, force: true });
}
