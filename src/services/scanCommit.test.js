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

class MapStorage {
  #items = new Map();
  getItem(key) { return this.#items.get(key) ?? null; }
  setItem(key, value) { this.#items.set(key, value); }
}
