import { pathToFileURL } from 'node:url';

const workflow = '.github/workflows/deploy-production.yml';
const shaPattern = /^[a-f0-9]{40}$/;

export async function githubRead(repo, path, token, fetcher = fetch) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') || !token) throw new Error('Missing GitHub verification context');
  const response = await fetcher(`https://api.github.com/repos/${repo}/${path}`, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
    redirect: 'error', signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`GitHub verification failed (HTTP ${response.status}); deployment stopped`);
  return response.json();
}

export function requireOwnerDispatch(run, main, context) {
  const { repo, runId, revision, approver, actor, triggeringActor, attempt, event, ref, workflowRef, confirmed } = context;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') || !/^\d+$/.test(runId ?? '') || !shaPattern.test(revision ?? '')) throw new Error('Invalid release context');
  if (!/^[a-zA-Z0-9-]+$/.test(approver ?? '')) throw new Error('Set PRODUCTION_APPROVER to the owner GitHub login');
  const owner = approver.toLowerCase();
  if (owner !== repo.split('/')[0].toLowerCase()) throw new Error('Production approver must be this personal repository owner');
  if (confirmed !== true && confirmed !== 'true') throw new Error('Confirm production deployment before starting a new run');
  if (event !== 'workflow_dispatch' || ref !== 'refs/heads/main' || workflowRef !== `${repo}/${workflow}@refs/heads/main`) throw new Error('Production requires the dedicated manual workflow on main');
  if (String(attempt) !== '1' || run?.run_attempt !== 1) throw new Error('Reruns are disabled; start and confirm a new production run');
  if (String(run?.id) !== String(runId) || run?.event !== 'workflow_dispatch' || run?.path !== workflow || run?.head_branch !== 'main' || run?.head_sha !== revision || run?.repository?.full_name !== repo) throw new Error('GitHub run does not match the requested production release');
  for (const user of [run.actor, run.triggering_actor]) {
    if (user?.type !== 'User' || user?.login?.toLowerCase() !== owner) throw new Error('Only the configured owner may start production deployment');
  }
  if (actor?.toLowerCase() !== owner || triggeringActor?.toLowerCase() !== owner) throw new Error('Unexpected workflow actor');
  if (main?.object?.type !== 'commit' || main?.object?.sha !== revision) throw new Error('Main changed; review the new version and start a new production run');
}

export async function verifyOwnerDispatch(env = process.env, fetcher = fetch) {
  const repo = env.GITHUB_REPOSITORY, runId = env.GITHUB_RUN_ID;
  if (!/^\d+$/.test(runId ?? '')) throw new Error('Invalid workflow run ID');
  const [run, main] = await Promise.all([
    githubRead(repo, `actions/runs/${runId}`, env.GITHUB_TOKEN, fetcher),
    githubRead(repo, 'git/ref/heads/main', env.GITHUB_TOKEN, fetcher)
  ]);
  requireOwnerDispatch(run, main, {
    repo, runId, revision: env.GITHUB_SHA, approver: env.PRODUCTION_APPROVER,
    actor: env.GITHUB_ACTOR, triggeringActor: env.GITHUB_TRIGGERING_ACTOR,
    attempt: env.GITHUB_RUN_ATTEMPT, event: env.GITHUB_EVENT_NAME, ref: env.GITHUB_REF,
    workflowRef: env.GITHUB_WORKFLOW_REF, confirmed: env.PRODUCTION_CONFIRMED
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await verifyOwnerDispatch();
    console.log('Owner-initiated manual production run and current main revision verified.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
