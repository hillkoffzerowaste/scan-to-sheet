import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { commitFallbackScan, getFallbackOutbox } from './scanCommit.js';

const OUTBOX_KEY = 'scan-to-sheet:firestore-fallback-outbox:v1';
const PACKER_CONTEXT = {
  type: 'packer', courier: 'Flash', user: { uid: 'packer-user', email: 'packer@example.test', displayName: 'Packer' },
  packer: 'Pack A', note: 'original note',
};
const ADMIN_CONTEXT = {
  type: 'admin', courier: 'J&T', user: { uid: 'admin-user', email: 'admin@example.test', displayName: 'Admin' },
  packer: '', note: '',
};

test('commitFallbackScan does not return success when the Firestore mirror rejects', async () => {
  const storage = new MapStorage();
  const result = await commitFallbackScan({
    context: PACKER_CONTEXT,
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
    context: PACKER_CONTEXT,
    appendToSheet: async () => ({ status: 'success', code: 'JTTH201542488210' }),
    mirrorToFirestore: mirror,
    storage,
  });
  const result = await commitFallbackScan({
    context: PACKER_CONTEXT,
    appendToSheet: async () => ({ status: 'success', code: 'NEWCODE12345678' }),
    mirrorToFirestore: mirror,
    storage,
  });
  assert.equal(result.status, 'success');
  assert.equal(JSON.parse(storage.getItem('scan-to-sheet:firestore-fallback-outbox:v1')).length, 0);
  assert.deepEqual(mirroredCodes, ['JTTH201542488210', 'JTTH201542488210', 'NEWCODE12345678']);
});

test('fallback outbox recovers every adjacent pending result before appending a new scan', async () => {
  const storage = await storageWithPendingScans();
  const operations = [];
  const result = await commitFallbackScan({
    context: PACKER_CONTEXT,
    appendToSheet: async () => {
      operations.push('append:NEW12345678');
      return { status: 'success', code: 'NEW12345678' };
    },
    mirrorToFirestore: async (sheetResult) => {
      operations.push(`mirror:${sheetResult.code}`);
    },
    storage,
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(operations, [
    'mirror:FIRST12345678',
    'mirror:SECOND12345678',
    'mirror:THIRD12345678',
    'append:NEW12345678',
    'mirror:NEW12345678',
  ]);
  assert.deepEqual(getFallbackOutbox(storage), []);
});

test('fallback outbox retains the failed retry and its successors along with a failed new scan', async () => {
  const storage = await storageWithPendingScans();
  const mirroredCodes = [];
  const result = await commitFallbackScan({
    context: PACKER_CONTEXT,
    appendToSheet: async () => ({ status: 'success', code: 'NEW12345678' }),
    mirrorToFirestore: async (sheetResult) => {
      mirroredCodes.push(sheetResult.code);
      if (sheetResult.code === 'SECOND12345678' || sheetResult.code === 'NEW12345678') {
        throw new Error('Firestore unavailable');
      }
    },
    storage,
  });

  assert.equal(result.status, 'firestore_unconfirmed');
  assert.deepEqual(mirroredCodes, ['FIRST12345678', 'SECOND12345678', 'NEW12345678']);
  assert.deepEqual(getFallbackOutbox(storage).map((entry) => entry.result), [
    { status: 'success', code: 'SECOND12345678' },
    { status: 'success', code: 'THIRD12345678' },
    { status: 'success', code: 'NEW12345678' },
  ]);
});

test('retries with the original role, courier and actor after the active scan context changes', async () => {
  const storage = new MapStorage();
  const context = structuredClone(PACKER_CONTEXT);
  context.user.accessToken = 'must-not-persist';
  const oldResult = { status: 'success', code: 'OLD12345678', courier: 'Flash', date: '2026-09-10', time: '09:00:00' };
  const newResult = { status: 'admin_scan', code: 'NEW12345678', courier: 'J&T', date: '2026-09-10', time: '09:01:00' };
  await commitFallbackScan({
    storage, context,
    appendToSheet: async () => {
      context.type = 'admin';
      context.courier = 'J&T';
      context.user.uid = 'changed-user';
      context.packer = 'Pack B';
      context.note = 'changed note';
      return oldResult;
    },
    mirrorToFirestore: async () => { throw new Error('offline'); },
  });

  const stored = JSON.parse(storage.getItem(OUTBOX_KEY));
  assert.deepEqual(stored[0].context, PACKER_CONTEXT);
  assert.deepEqual(stored[0].result, oldResult);
  const events = [];
  const result = await commitFallbackScan({
    storage, context: ADMIN_CONTEXT,
    appendToSheet: async () => newResult,
    mirrorToFirestore: async (sheetResult, mirrorContext) => {
      events.push({ ...mirrorContext, result: sheetResult });
    },
  });
  assert.deepEqual(result, newResult);
  assert.deepEqual(events, [
    { ...PACKER_CONTEXT, result: oldResult },
    { ...ADMIN_CONTEXT, result: newResult },
  ]);
  assert.deepEqual(getFallbackOutbox(storage), []);
});

for (const { fields, type, courier = 'Flash' } of [
  { fields: { status: 'duplicate', isPacker: true }, type: 'packer' },
  { fields: { status: 'duplicate', isPacker: false }, type: 'admin' },
  { fields: { status: 'success' }, type: 'packer' },
  { fields: { status: 'cancelled' }, type: 'packer' },
  { fields: { status: 'returned' }, type: 'packer' },
  { fields: { status: 'admin_scan' }, type: 'admin' },
  { fields: { status: 'admin_matched', isPacker: false }, type: 'admin' },
  { fields: { status: 'success', selectedCourier: 'J&T' }, type: 'packer', courier: 'J&T' },
]) {
  test(`migrates a legacy ${JSON.stringify(fields)} without borrowing the current actor`, async () => {
    const storage = new MapStorage();
    const legacy = { code: 'OLD12345678', courier: 'Flash', ...fields };
    storage.setItem(OUTBOX_KEY, JSON.stringify([legacy]));
    const events = [];
    await commitFallbackScan({
      storage, context: ADMIN_CONTEXT,
      appendToSheet: async () => ({ status: 'admin_scan', code: 'NEW12345678' }),
      mirrorToFirestore: async (result, context) => { events.push({ result, context }); },
    });
    assert.deepEqual(events[0], {
      result: legacy,
      context: { type, courier, user: null, packer: '', note: '' },
    });
    assert.deepEqual(getFallbackOutbox(storage), []);
  });
}

for (const legacy of [
  { code: 'OLD12345678', status: 'duplicate', courier: 'Flash' },
  { code: 'OLD12345678', status: 'admin_matched', courier: 'Flash' },
  { code: 'OLD12345678', status: 'success' },
  { code: 'OLD12345678', status: 'success', isPacker: false, courier: 'Flash' },
  { code: 'OLD12345678', status: 'admin_scan', isPacker: true, courier: 'Flash' },
  { code: 'OLD12345678', status: 'unknown', courier: 'Flash' },
]) {
  test(`retains ambiguous legacy metadata ${JSON.stringify(legacy)} without writing either backend`, async () => {
    const storage = new MapStorage();
    const original = JSON.stringify([legacy]);
    storage.setItem(OUTBOX_KEY, original);
    const operations = [];
    await assert.rejects(commitFallbackScan({
      storage, context: PACKER_CONTEXT,
      appendToSheet: async () => { operations.push('append'); return { code: 'NEW12345678' }; },
      mirrorToFirestore: async () => { operations.push('mirror'); },
    }), { code: 'FALLBACK_CONTEXT_AMBIGUOUS' });
    assert.deepEqual(operations, []);
    assert.equal(storage.getItem(OUTBOX_KEY), original);
  });
}

test('persists migrated legacy context even when its retry remains offline', async () => {
  const storage = new MapStorage();
  const legacy = { status: 'success', code: 'OLD12345678', courier: 'Flash' };
  storage.setItem(OUTBOX_KEY, JSON.stringify([legacy]));
  await commitFallbackScan({
    storage, context: ADMIN_CONTEXT,
    appendToSheet: async () => ({ status: 'admin_scan', code: 'NEW12345678' }),
    mirrorToFirestore: async () => { throw new Error('offline'); },
  });
  const [oldEntry, newEntry] = JSON.parse(storage.getItem(OUTBOX_KEY));
  assert.deepEqual(oldEntry.result, legacy);
  assert.deepEqual(oldEntry.context, { type: 'packer', courier: 'Flash', user: null, packer: '', note: '' });
  assert.deepEqual(newEntry.context, ADMIN_CONTEXT);
});

test('rejects unreadable or unwritable storage before appending a Sheet row', async () => {
  for (const method of ['getItem', 'setItem']) {
    const storage = new MapStorage();
    storage[method] = () => { throw new Error('storage denied'); };
    const operations = [];
    await assert.rejects(commitFallbackScan({
      storage, context: PACKER_CONTEXT,
      appendToSheet: async () => { operations.push('append'); return { code: 'NEW12345678' }; },
      mirrorToFirestore: async () => { operations.push('mirror'); },
    }), { code: method === 'getItem' ? 'FALLBACK_OUTBOX_READ_FAILED' : 'FALLBACK_OUTBOX_WRITE_FAILED' });
    assert.deepEqual(operations, []);
  }
});

test('preserves corrupt persisted data instead of replacing it with an empty outbox', async () => {
  for (const raw of ['{broken', '{}']) {
    const storage = new MapStorage();
    storage.setItem(OUTBOX_KEY, raw);
    await assert.rejects(commitFallbackScan({
      storage, context: PACKER_CONTEXT,
      appendToSheet: async () => assert.fail('must not append'),
      mirrorToFirestore: async () => assert.fail('must not mirror'),
    }), { code: 'FALLBACK_OUTBOX_READ_FAILED' });
    assert.equal(storage.getItem(OUTBOX_KEY), raw);
  }
});

test('reports a storage failure after Sheet success and retains the unsaved scan for retry', async () => {
  const storage = new MapStorage();
  const oldResult = { status: 'success', code: 'OLD12345678' };
  const originalSetItem = storage.setItem.bind(storage);
  const result = await commitFallbackScan({
    storage, context: PACKER_CONTEXT,
    appendToSheet: async () => {
      storage.setItem = () => { throw new Error('quota exceeded'); };
      return oldResult;
    },
    mirrorToFirestore: async () => { throw new Error('offline'); },
  });
  assert.equal(result.status, 'firestore_unconfirmed');
  assert.equal(result.error?.code, 'FALLBACK_OUTBOX_WRITE_FAILED');
  assert.deepEqual(getFallbackOutbox(storage)[0].result, oldResult);
  storage.setItem = originalSetItem;
  const mirrored = [];
  await commitFallbackScan({
    storage, context: ADMIN_CONTEXT,
    appendToSheet: async () => ({ status: 'admin_scan', code: 'NEW12345678' }),
    mirrorToFirestore: async (result, context) => { mirrored.push({ result, context }); },
  });
  assert.deepEqual(mirrored[0], { result: oldResult, context: PACKER_CONTEXT });
  assert.deepEqual(getFallbackOutbox(storage), []);
});

test('does not evict old unconfirmed scans when the fallback outbox is full', async () => {
  const storage = new MapStorage();
  const pending = Array.from({ length: 50 }, (_, index) => ({ status: 'success', code: `OLD12345678${index}`, courier: 'Flash' }));
  storage.setItem(OUTBOX_KEY, JSON.stringify(pending));
  await assert.rejects(commitFallbackScan({
    storage, context: PACKER_CONTEXT,
    appendToSheet: async () => assert.fail('must not append without outbox capacity'),
    mirrorToFirestore: async () => { throw new Error('offline'); },
  }), { code: 'FALLBACK_OUTBOX_FULL' });
  assert.deepEqual(getFallbackOutbox(storage).map((entry) => entry.result), pending);
});

test('serializes overlapping fallback commits so neither failed scan is overwritten', async () => {
  await assertConcurrentCommitsKeepBoth(commitFallbackScan, commitFallbackScan, new MapStorage());
});

test('both App fallback callbacks mirror recovered scans with their stored context', async () => {
  const source = await readFile(new URL('../App.jsx', import.meta.url), 'utf8');
  // Execute the actual option factories with only the network boundaries substituted.
  const factories = [...source.matchAll(/result = await commitFallbackScan\((\{[\s\S]*?\n\s*\})\);/g)];
  assert.equal(factories.length, 2);
  for (const [index, match] of factories.entries()) {
    const context = index === 0 ? PACKER_CONTEXT : ADMIN_CONTEXT;
    const oldContext = index === 0 ? ADMIN_CONTEXT : PACKER_CONTEXT;
    const storage = new MapStorage();
    const oldResult = { status: index === 0 ? 'admin_scan' : 'success', code: 'OLD12345678' };
    await commitFallbackScan({
      storage, context: oldContext,
      appendToSheet: async () => oldResult,
      mirrorToFirestore: async () => { throw new Error('offline'); },
    });
    const newResult = { status: index === 0 ? 'success' : 'admin_scan', code: 'NEW12345678' };
    const events = [];
    const bindings = {
      runWithGoogleRetry: (append) => append('test-token', {}),
      appendScanGoogle: async () => newResult,
      appendAdminScanGoogle: async () => newResult,
      scanCourier: context.courier,
      validation: { code: newResult.code },
      scanEmail: context.user.email,
      scanUser: context.user,
      packerName: context.packer,
      scanNote: context.note,
      marketplaceOrder: null,
      mirrorScanToFirestore: async (event) => { events.push(event); },
    };
    const options = new Function(...Object.keys(bindings), `return (${match[1]});`)(...Object.values(bindings));
    assert.deepEqual(await commitFallbackScan({ ...options, storage }), newResult);
    assert.deepEqual(events, [
      { ...oldContext, result: oldResult },
      { ...context, result: newResult },
    ]);
  }
});

test('coordinates independent module instances through the browser lock', async (t) => {
  const storage = new MapStorage();
  const originals = ['localStorage', 'navigator'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const tails = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    locks: { request(name, work) {
      const task = (tails.get(name) ?? Promise.resolve()).catch(() => {}).then(work);
      tails.set(name, task);
      return task;
    } },
  } });
  const firstModule = await import('./scanCommit.js?lock-test-first');
  const secondModule = await import('./scanCommit.js?lock-test-second');
  await assertConcurrentCommitsKeepBoth(firstModule.commitFallbackScan, secondModule.commitFallbackScan);
});

async function assertConcurrentCommitsKeepBoth(firstCommit, secondCommit, storage) {
  let releaseFirst;
  let startedFirst;
  const firstStarted = new Promise((resolve) => { startedFirst = resolve; });
  const gate = new Promise((resolve) => { releaseFirst = resolve; });
  const first = firstCommit({
    storage, context: PACKER_CONTEXT,
    appendToSheet: async () => {
      startedFirst();
      await gate;
      return { status: 'success', code: 'FIRST12345678' };
    },
    mirrorToFirestore: async () => { throw new Error('offline'); },
  });
  await firstStarted;
  const second = secondCommit({
    storage, context: ADMIN_CONTEXT,
    appendToSheet: async () => ({ status: 'admin_scan', code: 'SECOND12345678' }),
    mirrorToFirestore: async () => { throw new Error('offline'); },
  });
  await new Promise((resolve) => setImmediate(resolve));
  releaseFirst();
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map((result) => result.status), ['firestore_unconfirmed', 'firestore_unconfirmed']);
  assert.deepEqual(JSON.parse((storage ?? globalThis.localStorage).getItem(OUTBOX_KEY)).map(({ result, context }) => ({ code: result?.code, type: context?.type })), [
    { code: 'FIRST12345678', type: 'packer' },
    { code: 'SECOND12345678', type: 'admin' },
  ]);
}

async function storageWithPendingScans() {
  const storage = new MapStorage();
  for (const code of ['FIRST12345678', 'SECOND12345678', 'THIRD12345678']) {
    await commitFallbackScan({
      context: PACKER_CONTEXT,
      appendToSheet: async () => ({ status: 'success', code }),
      mirrorToFirestore: async () => { throw new Error('Firestore unavailable'); },
      storage,
    });
  }
  return storage;
}

class MapStorage {
  #items = new Map();
  getItem(key) { return this.#items.get(key) ?? null; }
  setItem(key, value) { this.#items.set(key, value); }
}
