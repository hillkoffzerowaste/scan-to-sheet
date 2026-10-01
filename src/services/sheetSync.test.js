import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSheetSyncFailureUpdates,
  isRetryableSheetSyncError,
  shouldKeepTargetedSheetRecovery,
} from './sheetSync.js';
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

test('targeted recovery keeps a live writing lease queued for the next retry', () => {
  const now = Date.parse('2026-09-30T06:00:00.000Z');
  assert.equal(shouldKeepTargetedSheetRecovery({
    sheetSyncStatus: 'writing',
    sheetSyncStartedAtIso: '2026-09-30T05:59:30.000Z',
  }, now), true);
  assert.equal(shouldKeepTargetedSheetRecovery({ sheetSyncStatus: 'failed' }, now), false);
  assert.equal(shouldKeepTargetedSheetRecovery({ sheetSyncStatus: 'verified' }, now), false);
});

test('background recovery reserves a bounded slot for historical backlog while today has work', () => {
  const today = Array.from({ length: 10 }, (_, index) => ({ id: `today-${index}`, date: '2026-10-01' }));
  const historical = Array.from({ length: 10 }, (_, index) => ({ id: `old-${index}`, date: '2026-09-30' }));

  const selected = sheetSync.selectBackgroundSheetRecoveryCandidates({
    todayCandidates: today,
    historicalCandidates: historical,
    maxRows: 10,
  });

  assert.equal(selected.length, 10);
  assert.equal(selected.filter((order) => order.date === '2026-10-01').length, 5);
  assert.equal(selected.filter((order) => order.date === '2026-09-30').length, 5);
});

test('background recovery uses the full batch for today when no historical backlog exists', () => {
  const today = Array.from({ length: 10 }, (_, index) => ({ id: `today-${index}`, date: '2026-10-01' }));

  const selected = sheetSync.selectBackgroundSheetRecoveryCandidates({
    todayCandidates: today,
    historicalCandidates: [],
    maxRows: 10,
  });

  assert.deepEqual(selected.map((order) => order.id), today.map((order) => order.id));
});

test('background recovery gives each historical status a chance within one batch', () => {
  const selected = sheetSync.selectBackgroundSheetRecoveryCandidates({
    todayCandidates: [],
    historicalCandidates: [
      { id: 'failed-oldest', sheetSyncStatus: 'failed', updatedAtIso: '2026-09-01T00:00:00.000Z' },
      { id: 'failed-next', sheetSyncStatus: 'failed', updatedAtIso: '2026-09-02T00:00:00.000Z' },
      { id: 'pending-oldest', sheetSyncStatus: 'pending', updatedAtIso: '2026-09-01T00:00:00.000Z' },
      { id: 'pending-next', sheetSyncStatus: 'pending', updatedAtIso: '2026-09-02T00:00:00.000Z' },
      { id: 'writing-oldest', sheetSyncStatus: 'writing', updatedAtIso: '2026-09-01T00:00:00.000Z' },
    ],
    maxRows: 3,
  });

  assert.deepEqual(selected.map((order) => order.id), [
    'failed-oldest',
    'pending-oldest',
    'writing-oldest',
  ]);
});

test('background recovery prioritizes the oldest retryable order within each status', () => {
  const selected = sheetSync.sortBackgroundSheetRecoveryCandidates([
    { id: 'pending-new', sheetSyncStatus: 'pending', updatedAtIso: '2026-10-01T04:05:00.000Z' },
    { id: 'pending-old', sheetSyncStatus: 'pending', updatedAtIso: '2026-10-01T03:45:00.000Z' },
    { id: 'failed-new', sheetSyncStatus: 'failed', updatedAtIso: '2026-10-01T04:04:00.000Z' },
    { id: 'writing-old', sheetSyncStatus: 'writing', updatedAtIso: '2026-10-01T03:40:00.000Z' },
  ]);

  assert.deepEqual(selected.map((order) => order.id), [
    'failed-new', 'pending-old', 'pending-new', 'writing-old',
  ]);
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

test('manual candidate reads cover selected historical scan dates and defer verified rows', async () => {
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
  assert.deepEqual(result.candidates.map((order) => order.id), ['writing', 'legacy']);
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

test('manual recovery prioritizes the oldest failed rows before newer failures', async () => {
  const result = await sheetSync.collectManualSheetRecoveryCandidates({
    dates: ['2026-09-28'], role: 'admin', cap: 3000,
    readDate: async () => [
      {
        id: 'new-failed', code: 'THNEW', sheetSyncStatus: 'failed',
        updatedAtIso: '2026-09-28T09:05:47.426Z',
        admin: { scannedAt: '2026-09-28T16:05:47' },
      },
      {
        id: 'old-failed', code: 'THOLD', sheetSyncStatus: 'failed',
        updatedAtIso: '2026-09-28T07:16:55.906Z',
        admin: { scannedAt: '2026-09-28T09:23:34' },
      },
    ],
    readPacker: async () => [],
    readAdmin: async () => [],
  });

  assert.deepEqual(result.candidates.map((order) => order.id), ['old-failed', 'new-failed']);
});

test('manual recovery drains all 45 candidates in three-row batches exactly once', async () => {
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
  assert.deepEqual(written.map((batch) => batch.length), Array(15).fill(3));
  assert.equal(new Set(written.flat()).size, 45);
  assert.deepEqual(progress, Array.from({ length: 15 }, (_, index) => (index + 1) * 3));
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
    batchSize: 4,
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
    batchSize: 10,
    ...recoveryDependencies({
      write: async (orders) => {
        if (batch++ === 0) throw new Error('timeout');
        return orders.map((order) => ({ order, result: { confirmed: true } }));
      },
      markResult: async (order, update) => { marked.push([order.id, update.ok]); return true; },
    }),
  });
  assert.equal(outcome.failed, 10);
  assert.equal(outcome.synced, 11);
  assert.equal(marked.filter(([, ok]) => !ok).length, 10);
  assert.deepEqual(marked.at(-1), ['order-20', true]);
});

test('an unclassified batch write failure enters the targeted retry path', async () => {
  const updates = [];
  const results = [];
  const outcome = await sheetSync.runSheetRecovery({
    candidates: recoveryOrders(2),
    ...recoveryDependencies({
      write: async () => { throw new Error('temporary Sheet gateway failure'); },
      markResult: async (order, update) => {
        updates.push({ order: order.id, retryable: update.retryable, code: update.error?.code });
        return true;
      },
      onOrderResult: (order, result) => results.push({ order: order.id, error: result.error }),
    }),
  });

  assert.equal(outcome.failed, 2);
  assert.deepEqual(updates, [
    { order: 'order-0', retryable: true, code: 'SHEET_BATCH_INCOMPLETE' },
    { order: 'order-1', retryable: true, code: 'SHEET_BATCH_INCOMPLETE' },
  ]);
  assert.equal(results.every(({ error }) => error?.code === 'SHEET_BATCH_INCOMPLETE'), true);
});

test('recovery keeps transient Sheet contention pending instead of marking it failed', async () => {
  let markedUpdate = null;
  const outcome = await sheetSync.runSheetRecovery({
    candidates: recoveryOrders(1),
    ...recoveryDependencies({
      write: async () => {
        throw Object.assign(new Error('Google Sheet กำลังถูกใช้งานอยู่ กรุณาลองอีกครั้ง'), {
          code: 'SHEET_LOCK_BUSY',
        });
      },
      markResult: async (_order, update) => {
        markedUpdate = update;
        return true;
      },
    }),
  });
  assert.equal(isRetryableSheetSyncError(markedUpdate.error), true);
  assert.equal(markedUpdate.retryable, true);
  assert.equal(outcome.failed, 1);
});

test('reports each recovery outcome so failed orders can stay targeted', async () => {
  const outcomes = [];
  const outcome = await sheetSync.runSheetRecovery({
    candidates: recoveryOrders(2),
    ...recoveryDependencies({
      markWriting: async (order) => order.id !== 'order-1',
      onOrderResult: (order, result) => outcomes.push([order.id, result.ok, result.skipped === true]),
    }),
  });
  assert.deepEqual(outcomes, [
    ['order-1', false, true],
    ['order-0', true, false],
  ]);
  assert.equal(outcome.synced, 1);
  assert.equal(outcome.skipped, 1);
});

test('HTTP 500 and readback failures are retryable Sheet errors', () => {
  assert.equal(isRetryableSheetSyncError(Object.assign(new Error('server error'), { status: 500 })), true);
  assert.equal(isRetryableSheetSyncError(Object.assign(new Error('unconfirmed'), { code: 'SHEET_RECOVERY_UNCONFIRMED' })), true);
  assert.equal(isRetryableSheetSyncError(Object.assign(new Error('Google ปฏิเสธคำขอ (รหัส 403) กรุณาลองใหม่'), {
    status: 403,
    detail: '{"error":{"errors":[{"reason":"userRateLimitExceeded"}]}}',
  })), true);
  assert.equal(isRetryableSheetSyncError(Object.assign(new Error('batch may have written before verification failed'), {
    code: 'SHEET_BATCH_INCOMPLETE',
  })), true);
  assert.equal(isRetryableSheetSyncError(new Error('เชื่อมต่อนานเกินไป กรุณาลองใหม่')), true);
  assert.equal(isRetryableSheetSyncError(new Error('ช่วงวันที่ไม่ถูกต้อง')), false);
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
