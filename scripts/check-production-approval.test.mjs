import test from 'node:test';
import assert from 'node:assert/strict';
import { requireOwnerDispatch, verifyOwnerDispatch } from './check-production-approval.mjs';
const revision = 'a'.repeat(40), repo = 'owner/crm';
const context = { repo, runId: '123', revision, approver: 'owner', actor: 'owner', triggeringActor: 'owner', attempt: '1', event: 'workflow_dispatch', ref: 'refs/heads/main', workflowRef: repo + '/.github/workflows/deploy-production.yml@refs/heads/main', confirmed: 'true' };
const run = { id: 123, run_attempt: 1, event: 'workflow_dispatch', path: '.github/workflows/deploy-production.yml', head_branch: 'main', head_sha: revision, repository: { full_name: repo }, actor: { login: 'owner', type: 'User' }, triggering_actor: { login: 'owner', type: 'User' } };
const main = { object: { type: 'commit', sha: revision } };
test('owner can dispatch the dedicated workflow for current main', () => {
  assert.doesNotThrow(() => requireOwnerDispatch(run, main, context));
  assert.doesNotThrow(() => requireOwnerDispatch(run, main, { ...context, approver: 'Owner', confirmed: true }));
});
test('push, other branch/workflow, absent confirmation and another actor are refused', () => {
  for (const patch of [{ event: 'push' }, { ref: 'refs/heads/staging' }, { workflowRef: repo + '/.github/workflows/ci.yml@refs/heads/main' }, { confirmed: 'false' }, { confirmed: undefined }, { actor: 'someone' }, { triggeringActor: 'someone' }, { approver: '' }, { approver: 'someone' }]) {
    assert.throws(() => requireOwnerDispatch(run, main, { ...context, ...patch }));
  }
});
test('remote run identity, human owner, fresh attempt and unchanged main are required', () => {
  for (const patch of [{ id: 124 }, { run_attempt: 2 }, { event: 'push' }, { head_branch: 'staging' }, { head_sha: 'b'.repeat(40) }, { path: '.github/workflows/ci.yml' }, { repository: { full_name: 'other/crm' } }, { actor: { login: 'owner', type: 'Bot' } }, { triggering_actor: { login: 'someone', type: 'User' } }]) {
    assert.throws(() => requireOwnerDispatch({ ...run, ...patch }, main, context));
  }
  assert.throws(() => requireOwnerDispatch(run, main, { ...context, attempt: '2' }));
  assert.throws(() => requireOwnerDispatch(run, { object: { type: 'commit', sha: 'b'.repeat(40) } }, context));
});
test('GitHub lookup fails closed and sends credentials only to the GitHub API', async () => {
  const env = { GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: '123', GITHUB_SHA: revision, PRODUCTION_APPROVER: 'owner', GITHUB_ACTOR: 'owner', GITHUB_TRIGGERING_ACTOR: 'owner', GITHUB_RUN_ATTEMPT: '1', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_WORKFLOW_REF: context.workflowRef, PRODUCTION_CONFIRMED: 'true', GITHUB_TOKEN: 'test-only' };
  await verifyOwnerDispatch(env, async (url, options) => {
    assert.equal(new URL(url).origin, 'https://api.github.com');
    assert.equal(options.redirect, 'error');
    return Response.json(url.endsWith('/123') ? run : main);
  });
  await assert.rejects(verifyOwnerDispatch(env, async () => new Response('', { status: 403 })), /HTTP 403/);
  await assert.rejects(verifyOwnerDispatch(env, async () => { throw new Error('offline'); }), /offline/);
});