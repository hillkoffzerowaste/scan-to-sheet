import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PACKING_VIDEO_FIELDS,
  PACKING_VIDEO_SHEET_HEADERS,
  PACKING_VIDEO_STATUS,
  buildPackingVideoDoc,
  buildPackingVideoSheetRow,
  canTransition,
  nextAttemptNo,
  normalizePackingTracking,
  packingVideoStatusLabel,
} from './packingVideoModel.js';

const sample = () => ({
  videoId: 'pv_20260815_abc12345_0123456789ab',
  trackingNo: 'th-123 456 789',
  attemptNo: 2,
  orderId: '250815XXXX',
  platform: 'shopee',
  marketplaceOrderDocId: 'shopee__250815XXXX',
  packer: 'มิ้ว',
  packerStaffId: 'staff-1',
  stationId: 'PACK-A',
  deviceId: 'pv-dev-0011223344556677',
  sessionId: 'pv-ses-aabbccdd',
  startedAt: new Date('2026-08-15T07:30:25Z'),
  finishedAt: new Date('2026-08-15T07:32:43Z'),
  durationMs: 138_000,
  mimeType: 'video/webm;codecs=vp8',
  sizeBytes: 11_000_000,
  createdByUid: 'uid-1',
  createdByEmail: 'packer@hillkoff.co.th',
});

test('buildPackingVideoDoc emits exactly the fields firestore.rules whitelists', () => {
  // This is the direct guard against a hasOnly() rejection: the rules pin the same list, so a
  // drifted payload fails here instead of in production.
  const doc = buildPackingVideoDoc(sample());
  assert.deepEqual(Object.keys(doc).sort(), [...PACKING_VIDEO_FIELDS].sort());
});

test('buildPackingVideoDoc derives bangkokDate from startedAt, not finishedAt', () => {
  const doc = buildPackingVideoDoc({
    ...sample(),
    startedAt: new Date('2026-08-15T16:59:00Z'), // 23:59 Bangkok
    finishedAt: new Date('2026-08-15T17:02:00Z'), // 00:02 Bangkok, next day
  });
  assert.equal(doc.bangkokDate, '2026-08-15');
});

test('buildPackingVideoDoc normalizes tracking and defaults the pipeline statuses', () => {
  const doc = buildPackingVideoDoc(sample());
  assert.equal(doc.normalizedTrackingNo, 'TH123456789');
  assert.equal(doc.status, PACKING_VIDEO_STATUS.pendingUpload);
  assert.equal(doc.sheetStatus, 'pending');
  assert.equal(doc.driveStatus, 'pending');
});

test('buildPackingVideoSheetRow matches the header order and leaves no undefined cells', () => {
  const row = buildPackingVideoSheetRow(buildPackingVideoDoc(sample()));
  assert.equal(row.length, PACKING_VIDEO_SHEET_HEADERS.length);
  assert.ok(row.every((cell) => typeof cell === 'string'));
  assert.deepEqual(row, [
    'pv_20260815_abc12345_0123456789ab',
    'th-123 456 789',
    '250815XXXX',
    'SHOPEE',
    'มิ้ว',
    'PACK-A',
    'pv-dev-0011223344556677',
    '2026-08-15 14:30:25',
    '2026-08-15 14:32:43',
    '00:02:18',
    '2',
    'รออัปโหลด',
    '',
    '',
  ]);
});

test('sheet row shows the Thai label while the document keeps the code', () => {
  const doc = buildPackingVideoDoc({ ...sample(), status: PACKING_VIDEO_STATUS.uploadFailed });
  assert.equal(doc.status, 'upload_failed');
  assert.equal(buildPackingVideoSheetRow(doc)[11], 'อัปโหลดไม่สำเร็จ');
  assert.equal(packingVideoStatusLabel('needs_review'), 'ต้องตรวจสอบ');
});

test('nextAttemptNo counts up and stops at the ceiling', () => {
  assert.equal(nextAttemptNo(undefined), 1);
  assert.equal(nextAttemptNo(0), 1);
  assert.equal(nextAttemptNo(3), 4);
  assert.throws(() => nextAttemptNo(100), (error) => error.code === 'PACKING_VIDEO_ATTEMPT_LIMIT');
});

test('canTransition allows a retry back into the queue but not a finished clip back to pending', () => {
  assert.equal(canTransition('upload_failed', 'pending_upload'), true);
  assert.equal(canTransition('pending_upload', 'uploaded'), true);
  assert.equal(canTransition('uploaded', 'needs_review'), true);
  assert.equal(canTransition('uploaded', 'pending_upload'), false);
  assert.equal(canTransition('uploaded', 'uploaded'), true);
});

test('a cancelled pack may still finish its upload', () => {
  // This assertion used to read `canTransition('cancelled', 'uploaded') === false`, which
  // contradicted the queue: isRunnable has always treated `cancelled` as runnable, because
  // "cancelled" describes the pack, not the evidence, and the clip is kept either way. The
  // table was enforced nowhere, so nothing caught the disagreement — the test was locking in
  // a rule the code never followed.
  assert.equal(canTransition('cancelled', 'uploaded'), true);
  assert.equal(canTransition('cancelled', 'upload_failed'), true);
  assert.equal(canTransition('cancelled', 'needs_review'), true);
  // A cancelled clip is still not something an Admin re-queues from scratch.
  assert.equal(canTransition('cancelled', 'pending_upload'), false);
});

test('normalizePackingTracking matches how marketplace orders are indexed', () => {
  assert.equal(normalizePackingTracking(' th-123/456 '), 'TH123456');
  assert.equal(normalizePackingTracking(null), '');
});
