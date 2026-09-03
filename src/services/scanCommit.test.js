import test from 'node:test';
import assert from 'node:assert/strict';

import { commitFallbackScan } from './scanCommit.js';

test('commitFallbackScan does not return success when the Firestore mirror rejects', async () => {
  const storage = new MapStorage();
  const result = await commitFallbackScan({
    appendToSheet: async () => ({ status: 'success', code: 'JTTH201542488210' }),
    mirrorToFirestore: async () => { throw new Error('Firestore unavailable'); },
    storage,
  });

  assert.equal(result.status, 'firestore_unconfirmed');
  assert.match(result.message, /Firestore/);
  assert.equal(JSON.parse(storage.getItem('scan-to-sheet:firestore-fallback-outbox:v1')).length, 1);
});

test('fallback outbox retries the same Sheet result without duplicating its payload', async () => {
  const storage = new MapStorage();
  let calls = 0;
  const mirroredCodes = [];
  const mirror = async (result) => {
    calls += 1;
    mirroredCodes.push(result.code);
    if (calls === 1) throw new Error('temporary');
  };
  await commitFallbackScan({
    appendToSheet: async () => ({ status: 'success', code: 'JTTH201542488210' }),
    mirrorToFirestore: mirror,
    storage,
  });
  const result = await commitFallbackScan({
    appendToSheet: async () => ({ status: 'success', code: 'NEWCODE12345678' }),
    mirrorToFirestore: mirror,
    storage,
  });
  assert.equal(result.status, 'success');
  assert.equal(JSON.parse(storage.getItem('scan-to-sheet:firestore-fallback-outbox:v1')).length, 0);
  assert.deepEqual(mirroredCodes, ['JTTH201542488210', 'JTTH201542488210', 'NEWCODE12345678']);
});

class MapStorage {
  #items = new Map();
  getItem(key) { return this.#items.get(key) ?? null; }
  setItem(key, value) { this.#items.set(key, value); }
}
