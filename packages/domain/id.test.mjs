import test from 'node:test';
import assert from 'node:assert/strict';
import { createId } from './id.ts';

test('LAN HTTP preview can create records when randomUUID is unavailable', () => {
  const insecureContextCrypto = { getRandomValues: values => crypto.getRandomValues(values) };
  const ids = Array.from({length: 100}, () => createId(insecureContextCrypto));
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
