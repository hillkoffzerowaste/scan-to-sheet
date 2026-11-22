import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSheetRecoveryPayload } from './sheetRecoveryPayload.js';

test('duplicate recovery carries the absolute count revision and original first scan metadata into the Sheet writer', () => {
  const payload = buildSheetRecoveryPayload({
    id: 'one', code: 'TH1234567890', courier: 'Flash', date: '2026-11-21',
    admin: { scannedAt: '2026-11-21T08:00:00' },
    packerScan: { scannedAt: '2026-11-21T09:00:00', packer: 'First', scannedBy: { email: 'first@example.test' } },
    scanTotalAdmin: 2, scanTotalPacker: 2, scanCountRevision: 4, scanHistoryUnknown: true,
  }, { userEmail: 'current@example.test', marketplaceOrder: null });
  assert.equal(payload.scanCountRevision, 4);
  assert.equal(payload.scanTotalAdmin, 2);
  assert.equal(payload.scanTotalPacker, 2);
  assert.equal(payload.scanDuplicateAdmin, 1);
  assert.equal(payload.scanDuplicatePacker, 1);
  assert.equal(payload.scanHistoryUnknown, true);
  assert.equal(payload.packer, 'First');
  assert.equal(payload.email, 'first@example.test');
  assert.equal(payload.date, '2026-11-21');
  assert.equal(payload.time, '09:00:00');
});
