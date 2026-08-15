import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DASHBOARD_PAGE_SIZE,
  MAX_DATE_RANGE_DAYS,
  applyResidualFilters,
  buildRecordingQuery,
  normalizePackingFilters,
} from './packingVideoFilters.js';

const TODAY = '2026-08-15';

test('an empty form falls back to today instead of sweeping the collection', () => {
  const filters = normalizePackingFilters({}, { today: TODAY });
  assert.equal(filters.startDate, TODAY);
  assert.equal(filters.endDate, TODAY);
});

test('a tracking number is narrow enough to skip the date window', () => {
  const filters = normalizePackingFilters({ trackingNo: 'th-123 456' }, { today: TODAY });
  assert.equal(filters.trackingNo, 'TH123456');
  assert.equal(filters.startDate, '');
  assert.equal(filters.endDate, '');
});

test('a single date fills in the other end of the range', () => {
  assert.equal(normalizePackingFilters({ startDate: '2026-08-01' }, { today: TODAY }).endDate, '2026-08-01');
  assert.equal(normalizePackingFilters({ endDate: '2026-08-01' }, { today: TODAY }).startDate, '2026-08-01');
});

test('a reversed range is swapped rather than rejected', () => {
  const filters = normalizePackingFilters({ startDate: '2026-08-10', endDate: '2026-08-01' }, { today: TODAY });
  assert.equal(filters.startDate, '2026-08-01');
  assert.equal(filters.endDate, '2026-08-10');
});

test('a range longer than the cap fails with a stable code', () => {
  assert.throws(
    () => normalizePackingFilters({ startDate: '2026-01-01', endDate: '2026-12-31' }, { today: TODAY }),
    (error) => error.code === 'PACKING_VIDEO_FILTER_TOO_BROAD',
  );
  // Exactly at the cap is still allowed.
  assert.doesNotThrow(() =>
    normalizePackingFilters({ startDate: '2026-08-01', endDate: '2026-08-31' }, { today: TODAY }));
  assert.equal(MAX_DATE_RANGE_DAYS, 31);
});

test('unknown platforms, stations and statuses are dropped rather than queried', () => {
  const filters = normalizePackingFilters(
    { platform: 'ebay', stationId: 'PACK-Z', status: 'made_up' },
    { today: TODAY },
  );
  assert.equal(filters.platform, '');
  assert.equal(filters.stationId, '');
  assert.equal(filters.status, '');
});

test('every query is bounded', () => {
  const query = buildRecordingQuery(normalizePackingFilters({}, { today: TODAY }));
  assert.equal(query.limit, DASHBOARD_PAGE_SIZE);
  assert.ok(query.orderBy.length > 0);
  // An oversized page request cannot raise the ceiling.
  assert.equal(buildRecordingQuery({}, { pageSize: 5000 }).limit, DASHBOARD_PAGE_SIZE);
});

test('a tracking search queries the normalized field directly', () => {
  const filters = normalizePackingFilters({ trackingNo: 'TH123' }, { today: TODAY });
  const query = buildRecordingQuery(filters);
  assert.deepEqual(query.where, [{ field: 'normalizedTrackingNo', op: '==', value: 'TH123' }]);
});

test('a date search pairs at most one equality field with the range', () => {
  const filters = normalizePackingFilters(
    { startDate: '2026-08-01', endDate: '2026-08-05', status: 'uploaded', packer: 'มิ้ว' },
    { today: TODAY },
  );
  const query = buildRecordingQuery(filters);
  const equalityFields = query.where.filter((clause) => clause.op === '==');
  assert.equal(equalityFields.length, 1, 'a second equality field would need another composite index');
  assert.equal(equalityFields[0].field, 'status');
});

test('filters the query left out are applied over the bounded page', () => {
  const rows = [
    { platform: 'shopee', packer: 'มิ้ว', stationId: 'PACK-A', status: 'uploaded' },
    { platform: 'lazada', packer: 'มิ้ว', stationId: 'PACK-A', status: 'uploaded' },
    { platform: 'shopee', packer: 'มุก', stationId: 'PACK-A', status: 'uploaded' },
  ];
  const filtered = applyResidualFilters(rows, { platform: 'shopee', packer: 'มิ้ว' });
  assert.equal(filtered.length, 1);
  assert.deepEqual(applyResidualFilters(undefined, {}), []);
});

test('a missing today is a programming error, not a silent full scan', () => {
  assert.throws(
    () => normalizePackingFilters({}),
    (error) => error.code === 'PACKING_VIDEO_MISSING_TODAY',
  );
});
