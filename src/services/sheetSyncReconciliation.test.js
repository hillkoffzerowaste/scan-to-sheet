import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findScanReconciliation,
  findHistoricalIssueRow,
  getAdminScanTiming,
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

test('retry uses the original Admin scan date and time while targeting the original row date', () => {
  assert.deepEqual(
    getAdminScanTiming({
      date: '2026-07-21',
      admin: { scannedAt: '2026-07-22T08:15:30' },
      packerScan: { scannedAt: '2026-07-21T16:20:00' },
    }, { fallbackDate: '2026-07-22', fallbackTime: '09:00:00' }),
    {
      sheetDate: '2026-07-21',
      sheetTime: '16:20:00',
      adminDate: '2026-07-22',
      adminTime: '08:15:30',
    },
  );
});
