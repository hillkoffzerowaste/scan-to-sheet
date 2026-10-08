import assert from 'node:assert/strict';
import test from 'node:test';

import { createFirestoreStore } from './firestoreStore.js';

function fakeFirestore() {
  const documents = new Map();
  const keyFor = (collection, id) => `${collection}/${id}`;
  const refFor = (collection, id) => ({
    id,
    path: keyFor(collection, id),
    async get() {
      const value = documents.get(keyFor(collection, id));
      return { exists: Boolean(value), data: () => value };
    },
    async set(value) {
      documents.set(keyFor(collection, id), { ...value });
    },
    async delete() {
      documents.delete(keyFor(collection, id));
    },
  });

  return {
    collection(name) {
      return { doc: (id) => refFor(name, id) };
    },
    async runTransaction(work) {
      const writes = [];
      const transaction = {
        async get(ref) {
          const value = documents.get(ref.path);
          return { exists: Boolean(value), data: () => value };
        },
        set(ref, value) { writes.push(() => documents.set(ref.path, { ...value })); },
        delete(ref) { writes.push(() => documents.delete(ref.path)); },
      };
      const result = await work(transaction);
      writes.forEach((write) => write());
      return result;
    },
  };
}

test('Firestore store keeps a session across requests and expires it by TTL', async () => {
  const db = fakeFirestore();
  let now = 1_000;
  const store = createFirestoreStore(db, { now: () => now, sessionTtlMs: 100 });

  await store.setSession('session-1', { email: 'operator@example.com', refreshToken: 'refresh' });
  assert.deepEqual(await store.getSession('session-1'), {
    email: 'operator@example.com',
    refreshToken: 'refresh',
  });

  now = 1_101;
  assert.equal(await store.getSession('session-1'), null);
});

test('Firestore lock prevents a second writer until the first lease is released', async () => {
  const db = fakeFirestore();
  let now = 2_000;
  const store = createFirestoreStore(db, { now: () => now, lockTtlMs: 500 });

  assert.deepEqual(await store.acquireLock('master', 'writer-a'), { acquired: true, retryAfterMs: 250 });
  const busy = await store.acquireLock('master', 'writer-b');
  assert.equal(busy.acquired, false);
  assert.ok(busy.retryAfterMs > 0);

  assert.equal(await store.releaseLock('master', 'writer-b'), false);
  assert.equal(await store.releaseLock('master', 'writer-a'), true);
  assert.equal((await store.acquireLock('master', 'writer-b')).acquired, true);

  now = 3_000;
  assert.equal((await store.acquireLock('other', 'writer-c')).acquired, true);
});

test('Firestore rate gate returns a bounded retry delay at the shared request limit', async () => {
  const db = fakeFirestore();
  let now = 4_000;
  const store = createFirestoreStore(db, { now: () => now });

  assert.equal((await store.throttle('request-1', { limit: 2, windowMs: 1_000 })).acquired, true);
  assert.equal((await store.throttle('request-2', { limit: 2, windowMs: 1_000 })).acquired, true);
  const blocked = await store.throttle('request-3', { limit: 2, windowMs: 1_000 });
  assert.equal(blocked.acquired, false);
  assert.ok(blocked.retryAfterMs > 0);

  now += 1_001;
  assert.equal((await store.throttle('request-4', { limit: 2, windowMs: 1_000 })).acquired, true);
});
