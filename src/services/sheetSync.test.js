import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSheetSyncFailureUpdates } from './sheetSync.js';
import * as sheetSync from './sheetSync.js';

const recoveryOrders = (count) => Array.from({ length: count }, (_, index) => ({
  id: `order-${index}`, code: `TH${index}`, sheetSyncAttemptId: `attempt-${index}`,
}));

test('a rejected Firestore acknowledgement cannot be reported as a verified scan', () => {
  assert.equal(typeof sheetSync.requireSheetSyncAcknowledgement, 'function');
  assert.equal(sheetSync.requireSheetSyncAcknowledgement(true), true);
  for (const value of [false, null, undefined]) {
    assert.throws(() => sheetSync.requireSheetSyncAcknowledgement(value), { code: 'SHEET_SYNC_NOT_ACKNOWLEDGED' });
  }
});

test('a late failure cannot downgrade an already verified attempt', () => {
  assert.equal(typeof sheetSync.canApplySheetSyncResult, 'function');
  const verified = { sheetSyncAttemptId: 'attempt-1', sheetSyncStatus: 'verified' };
  assert.equal(sheetSync.canApplySheetSyncResult(verified, { attemptId: 'attempt-1', ok: false }), false);
  assert.equal(sheetSync.canApplySheetSyncResult(verified, { attemptId: 'attempt-2', ok: true }), false);
  assert.equal(sheetSync.canApplySheetSyncResult(verified, { ok: true }), false);
  assert.equal(sheetSync.canApplySheetSyncResult(verified, { attemptId: 'attempt-1', ok: true }), true);
  assert.equal(sheetSync.canApplySheetSyncResult({ ...verified, sheetSyncStatus: 'writing' }, { attemptId: 'attempt-1', ok: false }), true);
});

function recoveryDependencies(overrides = {}) {
  return {
    claim: async (order) => order,
    markWriting: async () => true,
    write: async (orders) => orders.map((order) => ({ order, result: { confirmed: true } })),
    isConfirmed: (result) => result?.confirmed === true,
    markResult: async () => true,
    ...overrides,
  };
}

test('manual candidate reads cover selected historical scan dates, include stale writing and legacy states', async () => {
  assert.equal(typeof sheetSync.collectManualSheetRecoveryCandidates, 'function');
  const reads = [];
  const orders = [
    { id: 'writing', code: 'TH1', sheetSyncStatus: 'writing', admin: { scannedAt: '2026-09-09T10:00:00' } },
    { id: 'legacy', code: 'TH2', packerScan: { scannedAt: '2026-09-09T11:00:00' } },
    { id: 'verified', code: 'TH3', sheetSyncStatus: 'verified', packerScan: { scannedAt: '2026-09-09T12:00:00' } },
  ];
  const result = await sheetSync.collectManualSheetRecoveryCandidates({
    dates: ['2026-09-09'], role: 'both', cap: 3,
    readDate: async (date) => { reads.push(['date', date]); return orders; },
    readPacker: async (date) => { reads.push(['packer', date]); return [orders[1]]; },
    readAdmin: async (date) => { reads.push(['admin', date]); return [orders[0]]; },
  });
  assert.deepEqual(reads, [['date', '2026-09-09'], ['packer', '2026-09-09'], ['admin', '2026-09-09']]);
  assert.deepEqual(result.candidates.map((order) => order.id), ['writing', 'legacy', 'verified']);
  assert.equal(result.limited, true);
});

test('manual candidate read failures are not silently treated as a complete day', async () => {
  assert.equal(typeof sheetSync.collectManualSheetRecoveryCandidates, 'function');
  await assert.rejects(sheetSync.collectManualSheetRecoveryCandidates({
    dates: ['2026-09-09'], role: 'admin', cap: 3000,
    readDate: async () => [], readPacker: async () => [],
    readAdmin: async () => { throw Object.assign(new Error('offline'), { code: 'unavailable' }); },
  }), { code: 'unavailable' });
});

test('manual recovery drains all 45 candidates in bounded batches exactly once', async () => {
  assert.equal(typeof sheetSync.runSheetRecovery, 'function');
  const written = [];
  const progress = [];
  const outcome = await sheetSync.runSheetRecovery({
    candidates: recoveryOrders(45),
    ...recoveryDependencies({
      write: async (orders) => {
        written.push(orders.map((order) => order.id));
        return orders.map((order) => ({ order, result: { confirmed: true } }));
      },
    }),
    onProgress: (state) => progress.push(state.considered),
  });
  assert.deepEqual(written.map((batch) => batch.length), [20, 20, 5]);
  assert.equal(new Set(written.flat()).size, 45);
  assert.deepEqual(progress, [20, 40, 45]);
  assert.deepEqual(outcome, { considered: 45, claimed: 45, synced: 45, failed: 0, skipped: 0 });
});

test('recovery does not write an order after its writing lease is lost', async () => {
  assert.equal(typeof sheetSync.runSheetRecovery, 'function');
  const written = [];
  const outcome = await sheetSync.runSheetRecovery({
    candidates: recoveryOrders(3),
    ...recoveryDependencies({
      markWriting: async (order) => order.id !== 'order-1',
      write: async (orders) => {
        written.push(...orders.map((order) => order.id));
        return orders.map((order) => ({ order, result: { confirmed: true } }));
      },
    }),
  });
  assert.deepEqual(written, ['order-0', 'order-2']);
  assert.equal(outcome.skipped, 1);
  assert.equal(outcome.synced, 2);
});

test('recovery counts missing results and failed Firestore acknowledgements as failures', async () => {
  assert.equal(typeof sheetSync.runSheetRecovery, 'function');
  const marked = [];
  const outcome = await sheetSync.runSheetRecovery({
    candidates: recoveryOrders(4),
    ...recoveryDependencies({
      write: async ([first, second, third]) => [third, second, first].map((order) => ({ order, result: { confirmed: true } })),
      markResult: async (order, update) => {
        marked.push([order.id, update.ok]);
        if (order.id === 'order-1') throw new Error('offline');
        return order.id !== 'order-2';
      },
    }),
  });
  assert.deepEqual(marked, [['order-0', true], ['order-1', true], ['order-2', true], ['order-3', false]]);
  assert.equal(outcome.synced, 1);
  assert.equal(outcome.failed, 3);
});

test('a failed batch stays recoverable while subsequent batches still run', async () => {
  assert.equal(typeof sheetSync.runSheetRecovery, 'function');
  const marked = [];
  let batch = 0;
  const outcome = await sheetSync.runSheetRecovery({
    candidates: recoveryOrders(21),
    ...recoveryDependencies({
      write: async (orders) => {
        if (batch++ === 0) throw new Error('timeout');
        return orders.map((order) => ({ order, result: { confirmed: true } }));
      },
      markResult: async (order, update) => { marked.push([order.id, update.ok]); return true; },
    }),
  });
  assert.equal(outcome.failed, 20);
  assert.equal(outcome.synced, 1);
  assert.equal(marked.filter(([, ok]) => !ok).length, 20);
  assert.deepEqual(marked.at(-1), ['order-20', true]);
});

test('one failed claim does not strand previously claimed orders', async () => {
  assert.equal(typeof sheetSync.runSheetRecovery, 'function');
  const outcome = await sheetSync.runSheetRecovery({
    candidates: recoveryOrders(3),
    ...recoveryDependencies({ claim: async (order) => {
      if (order.id === 'order-1') throw new Error('offline');
      return order;
    } }),
  });
  assert.deepEqual(outcome, { considered: 3, claimed: 2, synced: 2, failed: 1, skipped: 0 });
});

test('builds failure updates for every claimed Sheet sync', () => {
  const updates = buildSheetSyncFailureUpdates([
    { id: 'order-1', sheetSyncAttemptId: 'attempt-1' },
    { id: 'order-2', sheetSyncAttemptId: 'attempt-2' },
  ], new Error('Google API request timed out'));

  assert.deepEqual(updates.map(({ orderId, attemptId, error }) => ({
    orderId,
    attemptId,
    error: error.message,
  })), [
    { orderId: 'order-1', attemptId: 'attempt-1', error: 'ซิงก์ Google Sheet ไม่สำเร็จ' },
    { orderId: 'order-2', attemptId: 'attempt-2', error: 'ซิงก์ Google Sheet ไม่สำเร็จ' },
  ]);
});

test('keeps an actionable Thai Sheet error for recovery diagnostics', () => {
  const [update] = buildSheetSyncFailureUpdates(
    [{ id: 'order-1' }],
    new Error('Google ตอบสนองช้าเกินกำหนด กรุณาลองใหม่'),
  );
  assert.equal(update.error.message, 'Google ตอบสนองช้าเกินกำหนด กรุณาลองใหม่');
});
