import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getMissingOrderQueryFilters,
  getMissingOrderQueryWindow,
  uniqueQueryDates,
} from './firestoreQueryPlanning.js';
import { shouldPollMissingOrders } from './missingCheckPolicy.js';
import * as planning from './firestoreQueryPlanning.js';

test('elapsed scan time uses Bangkok even when the device timezone is different', () => {
  assert.equal(typeof planning.parseBangkokScanTimestamp, 'function');
  const previous = process.env.TZ;
  try {
    for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Bangkok']) {
      process.env.TZ = zone;
      assert.equal(planning.parseBangkokScanTimestamp('2026-09-09T13:53:35'), Date.parse('2026-09-09T06:53:35Z'));
      assert.equal(planning.parseBangkokScanTimestamp('2026-09-09T06:53:35Z'), Date.parse('2026-09-09T06:53:35Z'));
      assert.equal(planning.parseBangkokScanTimestamp('2026-09-09T08:53:35+02:00'), Date.parse('2026-09-09T06:53:35Z'));
    }
    for (const invalid of ['', '2026-02-30T10:00:00', '2026-02-30T10:00:00Z', '2026-09-09T25:00:00', 'garbage']) {
      assert.ok(Number.isNaN(planning.parseBangkokScanTimestamp(invalid)));
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test('reports include cross-day scan events once and exclude events outside the selection', async () => {
  assert.equal(typeof planning.collectScanReportOrders, 'function');
  const crossDay = { id: 'cross', date: '2026-09-08', packerScan: { scannedAt: '2026-09-09T10:00:00' } };
  const old = { id: 'old', date: '2026-09-09', packerScan: { scannedAt: '2026-09-10T10:00:00' } };
  const legacy = { id: 'legacy', date: '2026-09-09' };
  const reads = [];
  const result = await planning.collectScanReportOrders({
    dates: ['2026-09-09', '2026-09-09'], cap: 2,
    readDate: async (date) => { reads.push(date); return [old, legacy]; },
    readPacker: async (date) => { reads.push(date); return [crossDay]; },
    readAdmin: async (date) => { reads.push(date); return [crossDay]; },
  });
  assert.deepEqual(result.orders.map((order) => order.id), ['legacy', 'cross']);
  assert.equal(result.limited, true);
  assert.deepEqual(reads, ['2026-09-09', '2026-09-09', '2026-09-09']);
});

test('report read failures and oversized date windows cannot silently yield incomplete totals', async () => {
  assert.equal(typeof planning.collectScanReportOrders, 'function');
  const deps = { readDate: async () => [], readPacker: async () => [], readAdmin: async () => [], cap: 3000 };
  await assert.rejects(planning.collectScanReportOrders({ ...deps, dates: ['2026-09-09'], readPacker: async () => {
    throw Object.assign(new Error('offline'), { code: 'unavailable' });
  } }), { code: 'unavailable' });
  await assert.rejects(planning.collectScanReportOrders({ ...deps, dates: Array.from({ length: 32 }, (_, i) => `date-${i}`) }), { code: 'REPORT_DATE_RANGE' });
});

test('missing-order polling is enabled only for signed-in Drive sessions', () => {
  assert.equal(shouldPollMissingOrders({ isSignedIn: false, activeTab: 'drive' }), false);
  assert.equal(shouldPollMissingOrders({ isSignedIn: true, activeTab: 'packer' }), false);
  assert.equal(shouldPollMissingOrders({ isSignedIn: true, activeTab: 'drive' }), true);
});

test('missing-order query window uses Bangkok-local Firestore timestamps', () => {
  const window = getMissingOrderQueryWindow({
    now: new Date('2026-07-26T05:00:00.000Z'),
    hoursLookback: 48,
  });

  assert.deepEqual(window, {
    start: '2026-07-24T12:00:00',
    end: '2026-07-26T12:00:00',
  });
});

test('automatic missing-order checks use the pending status filter only', () => {
  assert.deepEqual(getMissingOrderQueryFilters({ summaryOnly: true }), {
    field: 'status',
    operator: '==',
    value: 'pending',
  });
  assert.equal(getMissingOrderQueryFilters({ summaryOnly: false }), null);
});

test('report date queries are unique and chronologically ordered', () => {
  assert.deepEqual(
    uniqueQueryDates(['2026-07-26', '2026-07-24', '2026-07-26', '', null, '2026-07-25']),
    ['2026-07-24', '2026-07-25', '2026-07-26'],
  );
});
