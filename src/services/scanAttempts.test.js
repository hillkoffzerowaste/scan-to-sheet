import test from 'node:test';
import assert from 'node:assert/strict';
import * as scans from './scanAttempts.js';

test('physical scans increment each role and derive duplicates without guessing old history', () => {
  assert.equal(typeof scans.nextScanCounts, 'function');
  assert.deepEqual(scans.nextScanCounts(null, 'admin'), { scanTotalAdmin: 1, scanTotalPacker: 0, scanDuplicateAdmin: 0, scanDuplicatePacker: 0, scanCountRevision: 1, scanHistoryUnknown: false });
  const legacy = scans.nextScanCounts({ admin: { scannedAt: 'old' }, packerScan: { scannedAt: 'old' } }, 'packer');
  assert.equal(legacy.scanTotalAdmin, 1);
  assert.equal(legacy.scanTotalPacker, 2);
  assert.equal(legacy.scanHistoryUnknown, true);
  assert.equal(scans.getScanCountSummary({ ...legacy, scanTotalAdmin: 2 }).risk, true);
});

test('exact normalized tracking keys never collide through path sanitizing', () => {
  assert.equal(typeof scans.scanTrackingKey, 'function');
  assert.equal(scans.scanTrackingKey(' ab/123456 '), scans.scanTrackingKey('AB/123456'));
  assert.notEqual(scans.scanTrackingKey('AB/123456'), scans.scanTrackingKey('AB_123456'));
});

test('attempt context rejects another actor and changed receipt context', () => {
  assert.equal(typeof scans.validateScanAttempt, 'function');
  const attempt = { id: 'a1', role: 'admin', tracking: 'AB123456', date: '2026-09-22', courier: 'A', actorUid: 'u1', source: 'keyboard' };
  assert.throws(() => scans.validateScanAttempt(attempt, { actorUid: 'u2', role: 'admin', tracking: 'AB123456', date: attempt.date, courier: 'A' }), { code: 'SCAN_ATTEMPT_CONTEXT' });
  assert.throws(() => scans.validateScanAttempt(attempt, { actorUid: 'u1', role: 'admin', tracking: 'AB123456', date: attempt.date, courier: 'A' }, { ...attempt, source: 'camera' }), { code: 'SCAN_ATTEMPT_REUSED' });
});

test('atomic attempt replay counts once and preserves first actor across courier/date', async () => {
  assert.equal(typeof scans.commitScanAttemptTransaction, 'function');
  const documents = new Map();
  const transaction = { get: async (ref) => ({ exists: () => documents.has(ref), data: () => documents.get(ref) }), set: (ref, value) => documents.set(ref, value) };
  const attempt = { id: 'a1', role: 'admin', tracking: 'AB123456', date: '2026-09-22', courier: 'A', actorUid: 'u1', source: 'keyboard' };
  const commit = (a) => scans.commitScanAttemptTransaction({ transaction, attempt: a, pointerRef: 'pointer', receiptRef: a.id, orderRef: (id) => id, candidate: null, timestamp: 'now', makeOrder: (old) => ({ ...(old || {}), code: a.tracking, admin: old?.admin || { scannedAt: a.date, scannedBy: a.actorUid } }) });
  const first = await commit(attempt);
  for (let index = 0; index < 10; index++) assert.equal((await commit(attempt)).replayed, true);
  const second = await commit({ ...attempt, id: 'a2', actorUid: 'u2', date: '2026-09-23', courier: 'B' });
  assert.equal(second.id, first.id);
  assert.equal(second.order.scanTotalAdmin, 2);
  assert.equal(second.order.scanDuplicateAdmin, 1);
  assert.equal(second.order.admin.scannedBy, 'u1');
});


test('verification cannot certify counts from an older revision', () => {
  assert.equal(typeof scans.canVerifyScanRevision, 'function');
  assert.equal(scans.canVerifyScanRevision({ scanCountRevision: 2 }, { scanCountRevision: 1 }), false);
  assert.equal(scans.canVerifyScanRevision({ scanCountRevision: 2 }, { scanCountRevision: 2 }), true);
  assert.equal(scans.canVerifyScanRevision({ scanCountRevision: 2 }, {}), false);
});

test('corrupt persisted counts require review instead of inventing a new baseline', () => {
  assert.throws(() => scans.nextScanCounts({ scanTotalAdmin: 1.5, scanTotalPacker: 0 }, 'admin'), { code: 'SCAN_COUNTS_INVALID' });
  assert.throws(() => scans.nextScanCounts({ scanTotalAdmin: 1, scanTotalPacker: -1 }, 'admin'), { code: 'SCAN_COUNTS_INVALID' });
  assert.throws(() => scans.nextScanCounts({ scanTotalAdmin: 1 }, 'admin'), { code: 'SCAN_COUNTS_INVALID' });
});

test('legacy parsed rows with absent extension cells retain an unknown history', () => {
  const summary = scans.getScanCountSummary({ scanTotalAdmin: undefined, scanTotalPacker: undefined, scanCountRevision: undefined, code: 'AB123456' });
  assert.equal(summary.scanHistoryUnknown, true);
});

test('attempt identifiers and required context must be actual strings', () => {
  const context = { actorUid: 'u1', role: 'admin', tracking: 'AB123456', date: '2026-09-22', courier: 'A' };
  assert.throws(() => scans.validateScanAttempt({ ...context, source: 'keyboard' }, context), { code: 'SCAN_ATTEMPT_CONTEXT' });
});

test('contention retries only a permission denial proven to have a newer committed revision', async () => {
  assert.equal(typeof scans.runScanAttemptWithContentionRetry, 'function');
  let calls = 0;
  const result = await scans.runScanAttemptWithContentionRetry({ commit: async (observe) => {
    observe(1); if (++calls === 1) throw Object.assign(new Error('concurrent'), { code: 'permission-denied' }); return 'saved';
  }, readCurrentRevision: async () => 2 });
  assert.equal(result, 'saved');
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(scans.runScanAttemptWithContentionRetry({ commit: async (observe) => { observe(2); calls++; throw Object.assign(new Error('denied'), { code: 'permission-denied' }); }, readCurrentRevision: async () => 2 }), { code: 'permission-denied' });
  assert.equal(calls, 1);
});
