import { pathToFileURL } from 'node:url';

export function requireOwnerApproval(reviews, approver, attempt) {
  if (!approver || !/^[a-zA-Z0-9-]+$/.test(approver)) throw new Error('Set PRODUCTION_APPROVER to the owner GitHub login');
  // Reviews do not identify run attempts. Use a fresh workflow run for every production retry.
  if (String(attempt) !== '1') throw new Error('Start a new production workflow run and approve it; reruns are disabled');
  if (!Array.isArray(reviews)) throw new Error('Invalid GitHub approval response');
  const productionReviews = reviews.filter(review => review.environments?.some(env => env.name === 'production'));
  if (productionReviews.some(review => review.state !== 'approved')) throw new Error('Production review was not approved');
  const approved = productionReviews.some(review => review.state === 'approved' &&
    review.user?.type === 'User' && review.user?.login?.toLowerCase() === approver.toLowerCase());
  if (!approved) throw new Error('Production requires an explicit GitHub environment approval from the configured owner');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: run, GITHUB_TOKEN: token } = process.env;
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') || !/^\d+$/.test(run ?? '') || !token) {
      throw new Error('Missing GitHub approval lookup context');
    }
    const response = await fetch(`https://api.github.com/repos/${repo}/actions/runs/${run}/approvals`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
      redirect: 'error', signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`Cannot verify production approval (HTTP ${response.status}); deployment stopped`);
    requireOwnerApproval(await response.json(), process.env.PRODUCTION_APPROVER, process.env.GITHUB_RUN_ATTEMPT);
    console.log('Explicit owner approval for this production workflow run verified.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
