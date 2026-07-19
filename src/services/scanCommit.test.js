import test from 'node:test';
import assert from 'node:assert/strict';

import { commitFallbackScan } from './scanCommit.js';

test('commitFallbackScan does not return success when the Firestore mirror rejects', async () => {
  const result = await commitFallbackScan({
    appendToSheet: async () => ({ status: 'success', code: 'JTTH201542488210' }),
    mirrorToFirestore: async () => { throw new Error('Firestore unavailable'); },
  });

  assert.equal(result.status, 'firestore_unconfirmed');
  assert.match(result.message, /Firestore/);
});
