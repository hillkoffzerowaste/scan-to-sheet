import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as attempts from './scanAttempts.js';
import { mergeScanNotes } from './scanNotes.js';

// The Firebase SDK needs browser configuration. Keep production service code real and
// replace only its network boundary with an optimistic transaction store.
async function service(seed = []) {
  const documents = new Map(seed);
  let version = 0;
  let sequence = 0;
  const db = {};
  const ref = (...parts) => ({ id: parts.at(-1), path: parts.filter((p) => typeof p === 'string').join('/') });
  const snapshot = (reference) => ({ exists: () => documents.has(reference.path), data: () => structuredClone(documents.get(reference.path)) });
  const sdk = {
    firestoreDb: db, isFirebaseConfigured: true, firebaseAuth: { currentUser: { uid: 'u1' } },
    collection: (...parts) => ref(...parts), doc: (...parts) => ref(...parts),
    where: (field, operator, value) => ({ field, value }), limit: (max) => ({ max }),
    query: (collection, ...filters) => ({ collection, filters }),
    getDocs: async ({ collection, filters }) => {
      const filter = filters.find((f) => f.field);
      const max = filters.find((f) => f.max).max;
      const docs = [...documents.entries()].filter(([key, value]) => key.startsWith(`${collection.path}/`) && value[filter.field] === filter.value).slice(0, max).map(([key, value]) => ({ id: key.split('/')[1], data: () => structuredClone(value) }));
      return { docs, size: docs.length };
    },
    serverTimestamp: () => 'timestamp', hasMinimumTrackingLength: (code) => code.length >= 8,
    runTransaction: async (_, callback) => {
      for (let retry = 0; retry < 30; retry++) {
        const readVersion = version;
        const writes = [];
        let writing = false;
        const result = await callback({
          get: async (reference) => { assert.equal(writing, false, 'all reads must precede writes'); return snapshot(reference); },
          set: (reference, value) => { writing = true; writes.push([reference.path, structuredClone(value)]); },
        });
        if (version !== readVersion) continue;
        for (const [path, value] of writes) documents.set(path, value);
        if (writes.length) version++;
        return result;
      }
      throw new Error('transaction conflict');
    },
  };
  const dependencies = { ...sdk, ...attempts, mergeScanNotes };
  const source = (await readFile(new URL('./firebaseScans.js', import.meta.url), 'utf8')).replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\s*/gm, '').replace(/export /g, '');
  const api = new Function(...Object.keys(dependencies), `${source}; return { recordAdminScanPrimary, recordPackerScanPrimary };`)(...Object.values(dependencies));
  const scan = (role, changes = {}) => {
    const context = { code: 'AB123456', courier: 'A', date: '2026-09-22', time: '10:00:00', user: { uid: 'u1', displayName: 'First' }, ...changes };
    context.attempt = changes.attempt || { id: `a${++sequence}`, role, tracking: context.code, date: context.date, courier: context.courier, actorUid: context.user.uid, source: 'keyboard' };
    return api[role === 'admin' ? 'recordAdminScanPrimary' : 'recordPackerScanPrimary'](context);
  };
  return { ...api, scan, documents, sdk };
}

test('concurrent first physical scans across dates and couriers share one canonical order', async () => {
  const backend = await service();
  const results = await Promise.all([
    backend.scan('admin'),
    backend.scan('packer', { courier: 'B', date: '2026-09-23', packer: 'Packer' }),
  ]);
  assert.equal(results[0].id, results[1].id);
  const orders = [...backend.documents.entries()].filter(([key]) => key.startsWith('orders/'));
  assert.equal(orders.length, 1);
  assert.equal(orders[0][1].scanTotalAdmin, 1);
  assert.equal(orders[0][1].scanTotalPacker, 1);
  assert.equal(orders[0][1].scanCountRevision, 2);
  assert.equal(orders[0][1].status, 'matched');
});

test('ten retries of same public physical attempt count once and preserve first scan on subsequent scan', async () => {
  const backend = await service();
  const attempt = { id: 'stable', role: 'packer', tracking: 'AB123456', date: '2026-09-22', courier: 'A', actorUid: 'u1', source: 'keyboard' };
  const first = await backend.scan('packer', { attempt, packer: 'First' });
  for (let index = 0; index < 10; index++) assert.equal((await backend.scan('packer', { attempt, packer: 'First' })).scanTotalPacker, 1);
  const second = await backend.scan('packer', { date: '2026-09-23', courier: 'B', packer: 'Second' });
  assert.equal(second.id, first.id);
  assert.equal(second.scanTotalPacker, 2);
  assert.equal(second.packerScan.packer, 'First');
  assert.equal(second.packerScan.scannedAt, '2026-09-22T10:00:00');
  assert.notEqual(second.sheetSyncAttemptId, first.sheetSyncAttemptId);
});

test('public physical entrypoint rejects actor mismatch and legacy split orders without writing', async () => {
  const backend = await service();
  await assert.rejects(backend.scan('admin', { user: { uid: 'other' } }), { code: 'SCAN_ATTEMPT_CONTEXT' });
  assert.equal(backend.documents.size, 0);
  const legacy = await service([['orders/one', { code: 'AB123456', admin: { scannedAt: 'old' } }], ['orders/two', { normalizedCode: 'AB123456', packerScan: { scannedAt: 'old' } }]]);
  await assert.rejects(legacy.scan('admin'), { code: 'SCAN_CANONICAL_CONFLICT' });
  assert.equal(legacy.documents.size, 2);
});

test('physical Packer preserves empty-role repair and records wrong courier against Admin', async () => {
  const backend = await service([['orders/legacy', { code: 'AB123456', normalizedCode: 'AB123456', date: '2026-09-22', courier: 'A', admin: { scannedAt: '2026-09-22T09:00:00' }, packerScan: {}, status: 'pending' }]]);
  const result = await backend.scan('packer', { courier: 'B', packer: 'First' });
  assert.equal(result.packerScan.scannedAt, '2026-09-22T10:00:00');
  assert.equal(result.wrongCourier, true);
  assert.equal(result.sheetNote.includes('B'), true);
  assert.equal(result.scanHistoryUnknown, true);
});

test('event-only legacy history stops for review without creating a fabricated count baseline', async () => {
  const backend = await service([['scanEvents/old', { code: 'AB123456', normalizedCode: 'AB123456' }]]);
  await assert.rejects(backend.scan('admin'), { code: 'SCAN_CANONICAL_CONFLICT' });
  assert.equal(backend.documents.size, 1);
});
