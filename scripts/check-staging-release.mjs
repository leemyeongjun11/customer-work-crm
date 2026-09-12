import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { githubRead } from './check-production-approval.mjs';
import { waitForRelease } from './release-check.mjs';

export function requireSuccessfulStaging(run, jobs, release, repo) {
  const [runId, attempt] = release.releaseId.split('-');
  if (String(run?.id) !== runId || String(run?.run_attempt) !== attempt || run?.repository?.full_name !== repo ||
      run?.path !== '.github/workflows/ci.yml' || run?.event !== 'push' || run?.head_branch !== 'staging' ||
      run?.head_sha !== release.revision || run?.status !== 'completed' || run?.conclusion !== 'success') {
    throw new Error('The running staging release must have a successful staging CI run');
  }
  const deploy = jobs?.jobs?.find(job => job.name === 'staging / deploy');
  if (deploy?.status !== 'completed' || deploy?.conclusion !== 'success' ||
      !deploy.steps?.some(step => step.name === 'Confirm running release' && step.conclusion === 'success')) {
    throw new Error('Staging deployment and readiness check must have completed successfully');
  }
}

export async function verifyStagingRelease(env = process.env, probe = waitForRelease, read = githubRead) {
  const release = await probe({ baseUrl: env.CRM_BASE_URL, token: env.OPS_READ_TOKEN,
    revision: env.GITHUB_SHA, sourceTree: env.CRM_SOURCE_TREE, allowExistingRun: true });
  if (!/^\d+-\d+$/.test(release?.releaseId ?? '')) throw new Error('Invalid staging run identity');
  const [runId, attempt] = release.releaseId.split('-');
  const [run, jobs] = await Promise.all([
    read(env.GITHUB_REPOSITORY, `actions/runs/${runId}`, env.GITHUB_TOKEN),
    read(env.GITHUB_REPOSITORY, `actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`, env.GITHUB_TOKEN)
  ]);
  requireSuccessfulStaging(run, jobs, release, env.GITHUB_REPOSITORY);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await verifyStagingRelease({ ...process.env,
      CRM_SOURCE_TREE: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim() });
    console.log('Identical source is running in staging and its deployment CI succeeded.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
