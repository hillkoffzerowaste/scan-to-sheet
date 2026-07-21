import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRecoveredOrderFields, mergeExistingOrderWithCandidate, mergeScanEventIntoOrder } from './orderRecovery.js';

test('merges admin and packer mirror events into one complete order candidate', () => {
  const admin = mergeScanEventIntoOrder(null, {
    id: 'admin-event',
    type: 'admin',
    code: 'abc123',
    courier: 'Shopee',
    date: '2026-07-21',
    time: '09:10:00',
    user: { uid: 'admin-1', email: 'admin@example.com', name: 'Admin' },
  });

  const candidate = mergeScanEventIntoOrder(admin, {
    id: 'packer-event',
    type: 'packer',
    code: 'ABC123',
    courier: 'Shopee',
    date: '2026-07-22',
    time: '10:20:30',
    packer: 'Mook',
    user: { uid: 'packer-1', email: 'packer@example.com', name: 'Packer' },
  });

  assert.equal(candidate.code, 'ABC123');
  assert.equal(candidate.normalizedCode, 'ABC123');
  assert.equal(candidate.date, '2026-07-21');
  assert.equal(candidate.courier, 'Shopee');
  assert.equal(candidate.status, 'matched');
  assert.equal(candidate.admin.scannedAt, '2026-07-21T09:10:00');
  assert.equal(candidate.packerScan.scannedAt, '2026-07-22T10:20:30');
  assert.equal(candidate.packerScan.packer, 'Mook');
});

test('recovery patch preserves mirror fields when the Firestore order document is absent', () => {
  const patch = buildRecoveredOrderFields({
    effectiveExisting: {
      code: 'ABC123',
      normalizedCode: 'ABC123',
      courier: 'Lazada',
      date: '2026-07-21',
      admin: { scannedAt: '2026-07-21T09:10:00', scannedBy: { email: 'admin@example.com' } },
    },
    date: '2026-07-22',
    time: '10:20:30',
    courier: 'Shopee',
    code: 'ABC123',
    packer: 'Mook',
    note: '',
    user: { uid: 'packer-1', email: 'packer@example.com', name: 'Packer' },
  });

  assert.equal(patch.code, 'ABC123');
  assert.equal(patch.normalizedCode, 'ABC123');
  assert.equal(patch.date, '2026-07-21');
  assert.equal(patch.courier, 'Lazada');
  assert.equal(patch.status, 'matched');
  assert.deepEqual(patch.admin, { scannedAt: '2026-07-21T09:10:00', scannedBy: { email: 'admin@example.com' } });
  assert.equal(patch.packerScan.scannedAt, '2026-07-22T10:20:30');
});

test('recovery fills missing fields in an incomplete Firestore order from the mirror candidate', () => {
  const merged = mergeExistingOrderWithCandidate(
    { id: 'order-1', date: '2026-07-21', courier: 'Shopee', status: 'packer_scanned' },
    {
      code: 'ABC123',
      normalizedCode: 'ABC123',
      date: '2026-07-21',
      courier: 'Shopee',
      admin: { scannedAt: '2026-07-21T09:10:00' },
    },
  );

  assert.equal(merged.code, 'ABC123');
  assert.equal(merged.normalizedCode, 'ABC123');
  assert.equal(merged.admin.scannedAt, '2026-07-21T09:10:00');
});
