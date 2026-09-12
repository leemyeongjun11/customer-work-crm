import test from 'node:test';
import assert from 'node:assert/strict';
import { isExpectedRelease, readyComponents, waitForRelease } from './release-check.mjs';

const revision = 'a'.repeat(40);
const sourceTree = 'c'.repeat(40);
const releaseId = '123-1';
const now = Date.parse('2026-09-12T00:00:00Z');
function ready() {
  return { status: 'ok', components: ['api', 'worker', 'scheduler'].map(role => ({
    role, revision, sourceTree, releaseId, ready: true, heartbeatAt: new Date(now - 1000).toISOString()
  })) };
}
test('HTTP success from an older commit or prior run is not a successful release', () => {
  const body = { status: 'ok', revision, releaseId, role: 'web' };
  assert.equal(isExpectedRelease(body, revision, releaseId, 'web'), true);
  assert.equal(isExpectedRelease({ ...body, revision: 'b'.repeat(40) }, revision, releaseId, 'web'), false);
  assert.equal(isExpectedRelease({ ...body, releaseId: '123-2' }, revision, releaseId, 'web'), false);
});
test('all runtime roles need fresh, ready instances at the intended release', () => {
  assert.equal(readyComponents(ready(), revision, releaseId, now), true);
  for (const property of [
    { heartbeatAt: new Date(now - 90000).toISOString() },
    { heartbeatAt: 'invalid' },
    { heartbeatAt: new Date(now + 60000).toISOString() },
    { ready: false }, { revision: 'b'.repeat(40) }
  ]) {
    const body = ready();
    Object.assign(body.components[1], property);
    assert.equal(readyComponents(body, revision, releaseId, now), false);
  }
});
test('missing worker or mixed old/new live instances fail the check', () => {
  const missing = ready();
  missing.components = missing.components.filter(c => c.role !== 'worker');
  assert.equal(readyComponents(missing, revision, releaseId, now), false);
  const mixed = ready();
  mixed.components.push({ ...mixed.components[1], revision: 'b'.repeat(40) });
  assert.equal(readyComponents(mixed, revision, releaseId, now), false);
});
test('probe refuses plaintext or credential-bearing origins before sending its token', async () => {
  for (const baseUrl of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/path']) {
    await assert.rejects(waitForRelease({ baseUrl, token: 'test', revision, releaseId }), /HTTPS origin/);
  }
});

test('staging qualification accepts a merge commit with identical source and matching live roles', async t => {
  const responses = ready();
  responses.components.forEach(item => { item.heartbeatAt = new Date().toISOString(); });
  t.mock.method(globalThis, 'fetch', async url => {
    const path = new URL(url).pathname;
    const body = path.endsWith('/ops/release') ? responses : {
      status: 'ok', revision, sourceTree, releaseId, role: path.startsWith('/api/') ? 'api' : 'web'
    };
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  });
  await waitForRelease({ baseUrl: 'https://example.com', token: 'test', revision: 'b'.repeat(40), sourceTree,
    releaseId: '456-1', allowExistingRun: true, attempts: 1 });
  responses.components[1].releaseId = '122-1';
  await assert.rejects(waitForRelease({ baseUrl: 'https://example.com', token: 'test', revision, sourceTree,
    releaseId: '456-1', allowExistingRun: true, attempts: 1 }), /could not be confirmed/);
  responses.components[1].releaseId = releaseId;
  await assert.rejects(waitForRelease({ baseUrl: 'https://example.com', token: 'test', revision,
    sourceTree: 'd'.repeat(40), allowExistingRun: true, attempts: 1 }), /could not be confirmed/);
});

test('ordinary deploy verification rejects the old run even at the same commit', async t => {
  const responses = ready();
  responses.components.forEach(item => { item.heartbeatAt = new Date().toISOString(); });
  t.mock.method(globalThis, 'fetch', async url => new Response(JSON.stringify(
    new URL(url).pathname.endsWith('/ops/release') ? responses : {
      status: 'ok', revision, sourceTree, releaseId, role: new URL(url).pathname.startsWith('/api/') ? 'api' : 'web'
    }
  )));
  await assert.rejects(waitForRelease({ baseUrl: 'https://example.com', token: 'test', revision, sourceTree,
    releaseId: '456-1', attempts: 1 }), /could not be confirmed/);
});
