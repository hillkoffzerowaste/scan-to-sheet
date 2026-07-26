import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getMissingOrderQueryFilters,
  getMissingOrderQueryWindow,
  uniqueQueryDates,
} from './firestoreQueryPlanning.js';
import { shouldPollMissingOrders } from './missingCheckPolicy.js';

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
