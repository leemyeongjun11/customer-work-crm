import test from 'node:test';
import assert from 'node:assert/strict';
import { requireOwnerApproval } from './check-production-approval.mjs';
const review = { state: 'approved', user: { login: 'owner', type: 'User' }, environments: [{ name: 'production' }] };
test('only explicit production approval by the configured owner passes', () => {
  assert.doesNotThrow(() => requireOwnerApproval([review], 'owner', '1'));
  for (const reviews of [[], [{ ...review, user: { login: 'another', type: 'User' } }],
    [{ ...review, environments: [{ name: 'staging' }] }], [{ ...review, state: 'rejected' }]]) {
    assert.throws(() => requireOwnerApproval(reviews, 'owner', '1'));
  }
});
test('missing owner, malformed response and a rerun with an old approval fail closed', () => {
  assert.throws(() => requireOwnerApproval([review], '', '1'));
  assert.throws(() => requireOwnerApproval({}, 'owner', '1'));
  assert.throws(() => requireOwnerApproval([review], 'owner', '2'));
});
