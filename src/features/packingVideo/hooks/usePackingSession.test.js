import test from 'node:test';
import assert from 'node:assert/strict';

import { kickCurrentPackingQueue, retryCurrentPackingQueue } from '../logic/queueRef.js';

test('hands a finalized clip to the queue that is current after the queue is replaced', async () => {
  // The queue is recreated after device identity resolves. Holding the old object makes its
  // disposed `kick()` a no-op, leaving a newly finalized clip in IndexedDB until another event.
  let staleKicks = 0;
  let currentKicks = 0;
  const queueRef = {
    current: { kick: async () => { staleKicks += 1; } },
  };

  queueRef.current = { kick: async () => { currentKicks += 1; } };

  await kickCurrentPackingQueue(queueRef);

  assert.equal(staleKicks, 0);
  assert.equal(currentKicks, 1);
});

test('retries a local clip through the queue that is current after the queue is replaced', async () => {
  // The dashboard remains mounted while the queue can be recreated after authentication changes.
  // Retrying through the stale, disposed queue leaves the local clip in a false-success state.
  let staleVideoId = '';
  let currentVideoId = '';
  const queueRef = {
    current: { retry: async (videoId) => { staleVideoId = videoId; } },
  };

  queueRef.current = { retry: async (videoId) => { currentVideoId = videoId; } };

  await retryCurrentPackingQueue(queueRef, 'pv_current');

  assert.equal(staleVideoId, '');
  assert.equal(currentVideoId, 'pv_current');
});
