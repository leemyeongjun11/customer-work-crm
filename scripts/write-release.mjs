import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const sourceTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
const releaseId = `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
if (revision !== process.env.GITHUB_SHA || !/^[0-9]+-[0-9]+$/.test(releaseId)) {
  throw new Error('Invalid release context');
}
writeFileSync('release.json', JSON.stringify({ revision, sourceTree, releaseId }));
