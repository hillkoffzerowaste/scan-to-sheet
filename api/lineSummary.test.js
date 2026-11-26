import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeLineOrders } from './firestoreStore.js';

test('line summary follows the dashboard 14:00 cohort and includes cross-day output', () => {
  const result = summarizeLineOrders([
    { status: 'matched', courier: 'Shopee', admin: { scannedAt: '2026-11-26T13:40:00' }, packerScan: { scannedAt: '2026-11-26T15:00:00' } },
    { status: 'matched', courier: 'Flash', admin: { scannedAt: '2026-11-26T13:50:00' }, packerScan: { scannedAt: '2026-11-26T17:00:00' } },
    { status: 'pending', courier: 'J&T', admin: { scannedAt: '2026-11-26T13:55:00' } },
    { status: 'matched', courier: 'Shopee', admin: { scannedAt: '2026-11-25T13:00:00' }, packerScan: { scannedAt: '2026-11-26T10:00:00' } },
    { status: 'matched', courier: 'LEX', admin: { scannedAt: '2026-11-26T15:00:00' }, packerScan: { scannedAt: '2026-11-26T16:00:00' } },
  ], '2026-11-26');

  assert.equal(result.cutoffOrders, 3);
  assert.equal(result.cutoffShippedOrders, 2);
  assert.equal(result.shippedAllOrders, 4);
  assert.equal(result.outstandingOrders, 1);
  assert.equal(result.outputRate, 133.33);
  assert.deepEqual(result.couriers, { Shopee: 2, Flash: 1, LEX: 1 });
});
