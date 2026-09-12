import test from 'node:test';
import assert from 'node:assert/strict';
import { requireSuccessfulStaging, verifyStagingRelease } from './check-staging-release.mjs';
const repo = 'owner/crm', release = { revision: 'a'.repeat(40), sourceTree: 'b'.repeat(40), releaseId: '123-1' };
const run = { id: 123, run_attempt: 1, repository: { full_name: repo }, path: '.github/workflows/ci.yml', event: 'push', head_branch: 'staging', head_sha: release.revision, status: 'completed', conclusion: 'success' };
const jobs = { jobs: [{ name: 'staging / deploy', status: 'completed', conclusion: 'success', steps: [{ name: 'Confirm running release', conclusion: 'success' }] }] };
test('running staging release requires its own successful CI and deployment job', () => {
  assert.doesNotThrow(() => requireSuccessfulStaging(run, jobs, release, repo));
  for (const patch of [{ id: 124 }, { run_attempt: 2 }, { conclusion: 'failure' }, { status: 'in_progress' }, { event: 'workflow_dispatch' }, { head_branch: 'main' }, { head_sha: 'c'.repeat(40) }, { path: '.github/workflows/other.yml' }]) {
    assert.throws(() => requireSuccessfulStaging({ ...run, ...patch }, jobs, release, repo));
  }
  assert.throws(() => requireSuccessfulStaging(run, { jobs: [] }, release, repo));
  assert.throws(() => requireSuccessfulStaging(run, { jobs: [{ ...jobs.jobs[0], conclusion: 'skipped' }] }, release, repo));
  assert.throws(() => requireSuccessfulStaging(run, { jobs: [{ ...jobs.jobs[0], steps: [] }] }, release, repo));
});
test('staging CI lookup uses the actual live release and aborts on lookup failure', async () => {
  const paths = [], env = { GITHUB_REPOSITORY: repo, GITHUB_TOKEN: 'test', GITHUB_SHA: 'c'.repeat(40), CRM_SOURCE_TREE: release.sourceTree };
  await verifyStagingRelease(env, async options => { assert.equal(options.allowExistingRun, true); return release; }, async (_repo, path) => { paths.push(path); return path.includes('/jobs') ? jobs : run; });
  assert.deepEqual(paths.sort(), ['actions/runs/123', 'actions/runs/123/attempts/1/jobs?per_page=100']);
  await assert.rejects(verifyStagingRelease(env, async () => release, async () => { throw new Error('lookup failed'); }), /lookup failed/);
});
