import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findScanReconciliation,
  findHistoricalIssueRow,
  getAdminScanTiming,
  isSheetSyncResultConfirmed,
  getPackerDuplicateMessage,
  getScanIssueMeta,
  shouldBlockPackerScan,
} from './sheetSyncReconciliation.js';

test('classifies returned scans as historical Sheet updates', () => {
  assert.deepEqual(getScanIssueMeta('สินค้าตีกลับ'), {
    isIssue: true,
    sheetStatus: 'Returned',
    resultStatus: 'returned',
    firestoreStatus: 'returned',
  });
});

test('finds the existing historical row by Packer or Admin code', () => {
  const row = { courier: 'Kerry', code: '', adminCode: 'TH123' };
  assert.equal(findHistoricalIssueRow([row], { courier: 'Kerry', code: 'th123' }), row);
});

test('does not block a Packer scan when only the Admin code exists', () => {
  assert.equal(
    shouldBlockPackerScan([{ courier: 'Kerry', code: '', adminCode: 'TH123' }], ' th123 '),
    false,
  );
});

test('blocks a Packer scan only when the Packer code already exists', () => {
  assert.equal(
    shouldBlockPackerScan([{ courier: 'Kerry', code: 'TH123', adminCode: '' }], 'th123'),
    true,
  );
});

test('blocks a Packer scan when the same tracking exists under another courier', () => {
  assert.equal(
    shouldBlockPackerScan([{ courier: 'J&T', code: 'TH123', adminCode: '' }], 'TH123', 'Shopee'),
    true,
  );
});

test('Packer duplicate status does not depend on Drive-only state', () => {
  assert.equal(
    getPackerDuplicateMessage('th123'),
    'TH123 Packer สแกนแล้ว กรุณาตรวจสอบ',
  );
});

test('skips an Admin retry when the Sheet already has Admin data', () => {
  const row = { courier: 'Kerry', code: '', adminCode: 'TH123' };
  assert.deepEqual(findScanReconciliation([row], { courier: 'Kerry', code: 'TH123', isPacker: false }), {
    action: 'skip',
    row,
  });
});

test('repairs a Packer row when the tracking exists but the Packer field is empty', () => {
  const row = { courier: 'Kerry', code: 'TH123', packer: '', adminCode: '' };
  assert.deepEqual(findScanReconciliation([row], {
    courier: 'Kerry', code: 'TH123', isPacker: true, packerName: 'กิต',
  }), {
    action: 'merge-packer',
    row,
  });
});

test('treats a rescan as duplicate when no Packer name is selected', () => {
  // The packer picker defaults to unassigned, so packerName is ''. Repairing here would
  // overwrite the original scan time and report a fresh success instead of a duplicate.
  const row = { courier: 'Kerry', code: 'TH123', packer: '', adminCode: '' };
  assert.deepEqual(findScanReconciliation([row], {
    courier: 'Kerry', code: 'TH123', isPacker: true, packerName: '',
  }), {
    action: 'skip',
    row,
  });
  // ...and that duplicate must confirm, or the order is retried forever.
  assert.equal(isSheetSyncResultConfirmed({
    status: 'duplicate', code: 'TH123', isPacker: true, row,
  }), true);
});

test('merges Admin data into an existing Packer row', () => {
  const row = { courier: 'Kerry', code: 'TH123', adminCode: '' };
  assert.deepEqual(findScanReconciliation([row], { courier: 'Kerry', code: 'TH123', isPacker: false }), {
    action: 'merge-admin',
    row,
  });
});

test('creates a row only when neither Admin nor Packer data exists', () => {
  assert.deepEqual(findScanReconciliation([], { courier: 'Kerry', code: 'TH123', isPacker: false }), {
    action: 'create',
    row: null,
  });
});

test('reuses the same tracking row even when a different courier is selected', () => {
  const row = { courier: 'J&T', code: '', adminCode: 'TH123' };
  assert.deepEqual(findScanReconciliation([row], { courier: 'Shopee', code: 'TH123', isPacker: false }), {
    action: 'skip',
    row,
  });
  assert.deepEqual(findScanReconciliation([row], { courier: 'Shopee', code: 'TH123', isPacker: true }), {
    action: 'merge-packer',
    row,
  });
});

test('retry targets the Packer scan date when Packer scanned after the original order date', () => {
  assert.deepEqual(
    getAdminScanTiming({
      date: '2026-07-21',
      admin: { scannedAt: '2026-07-22T08:15:30' },
      packerScan: { scannedAt: '2026-07-22T16:20:00' },
    }, { fallbackDate: '2026-07-22', fallbackTime: '09:00:00' }),
    {
      sheetDate: '2026-07-22',
      sheetTime: '16:20:00',
      adminDate: '2026-07-22',
      adminTime: '08:15:30',
    },
  );
});

test('does not confirm a Packer duplicate without the Packer row', () => {
  assert.equal(isSheetSyncResultConfirmed({ status: 'duplicate', code: 'TH123', isPacker: true }), false);
  assert.equal(isSheetSyncResultConfirmed({
    status: 'duplicate',
    code: 'TH123',
    isPacker: true,
    row: { code: 'TH123', packer: 'กิต' },
  }), true);
  assert.equal(isSheetSyncResultConfirmed({
    status: 'duplicate',
    code: 'TH123',
    isPacker: false,
    row: { code: '', adminCode: 'TH123' },
  }), true);
});
