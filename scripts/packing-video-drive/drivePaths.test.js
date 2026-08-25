import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_DRIVE_ATTEMPTS,
  MOVING_LEASE_MS,
  STORAGE_RETENTION_MS,
  buildDriveFolderPath,
  buildDriveNameForDoc,
  extensionFromMimeType,
  isStorageDeletable,
  planDriveRetry,
  planStaleMoveReclaim,
  planStoragePurge,
  platformFolder,
  toDate,
} from './drivePaths.js';

const doc = (overrides = {}) => ({
  bangkokDate: '2026-08-15',
  startedAt: new Date('2026-08-15T07:30:25Z'),
  platform: 'shopee',
  trackingNo: 'TH123456789',
  stationId: 'PACK-A',
  packerEmployeeId: 'EMP001',
  mimeType: 'video/webm;codecs=vp8',
  ...overrides,
});

test('folders are nested by year, Bangkok date and platform', () => {
  assert.deepEqual(buildDriveFolderPath(doc()), ['Packing Videos', '2026', '2026-08-15', 'SHOPEE']);
});

test('an unknown platform still gets a home', () => {
  assert.equal(platformFolder('ebay'), 'OTHER');
  assert.equal(platformFolder(undefined), 'OTHER');
  assert.equal(platformFolder('TikTok'), 'TIKTOK');
});

test('the folder date follows the clip start, even across midnight', () => {
  // 23:59 Bangkok. Using finishedAt would file this under the following day, splitting it
  // from its storage path and its sheet row.
  const crossMidnight = doc({ bangkokDate: '', startedAt: new Date('2026-08-15T16:59:00Z') });
  assert.deepEqual(buildDriveFolderPath(crossMidnight), ['Packing Videos', '2026', '2026-08-15', 'SHOPEE']);
});

test('file names follow the agreed pattern', () => {
  assert.equal(buildDriveNameForDoc(doc()), '20260815_143025_SHOPEE_TH123456789_PACK-A_EMP001.webm');
});

test('the extension is the real container, never a rename', () => {
  assert.equal(extensionFromMimeType('video/mp4;codecs=avc1'), 'mp4');
  assert.equal(extensionFromMimeType('video/webm;codecs=vp8'), 'webm');
  assert.equal(extensionFromMimeType(undefined), 'webm');
  assert.ok(buildDriveNameForDoc(doc({ mimeType: 'video/mp4' })).endsWith('.mp4'));
});

test('Firestore admin timestamps are understood', () => {
  assert.equal(toDate({ _seconds: 1_755_243_025 }).getTime(), 1_755_243_025_000);
  assert.equal(toDate(null).getTime(), 0);
});

test('a Storage object is only deletable once it is safely in Drive and past retention', () => {
  const movedAt = new Date('2026-08-15T00:00:00Z');
  const moved = { driveStatus: 'moved', storagePath: 'p/1', movedToDriveAt: movedAt };

  assert.equal(isStorageDeletable(moved, movedAt.getTime() + STORAGE_RETENTION_MS - 1), false);
  assert.equal(isStorageDeletable(moved, movedAt.getTime() + STORAGE_RETENTION_MS), true);
  // Not yet moved, or moved but with no record of when: never delete on a guess.
  assert.equal(isStorageDeletable({ ...moved, driveStatus: 'pending' }, Date.now()), false);
  assert.equal(isStorageDeletable({ ...moved, movedToDriveAt: null }, Date.now()), false);
  assert.equal(isStorageDeletable({ ...moved, storagePath: '' }, Date.now()), false);
});

test('a purged document leaves the retention queue instead of blocking it', () => {
  const movedAt = new Date('2026-08-15T00:00:00Z');
  const due = movedAt.getTime() + STORAGE_RETENTION_MS;
  const moved = { driveStatus: 'moved', storagePath: 'p/1', movedToDriveAt: movedAt };

  assert.equal(planStoragePurge(moved, due), 'delete');
  assert.equal(planStoragePurge(moved, due - 1), 'wait');
  // The regression: clearing storagePath alone left the document as 'moved', and because the
  // sweep reads the OLDEST 'moved' documents first, the same purged batch filled every later
  // pass and no Storage object was ever deleted again.
  assert.equal(planStoragePurge({ ...moved, storagePath: '' }, due), 'retire');
  assert.equal(planStoragePurge({ ...moved, driveStatus: 'purged' }, due), 'skip');
});

test('a failed Drive move keeps its attempt count and stays retryable until the budget runs out', () => {
  // Both halves used to be broken: driveAttempts was never persisted, so this was always 1,
  // and 'failed' is absent from the pending query, so the clip was never picked up again.
  const first = planDriveRetry({ driveAttempts: undefined, status: 'uploaded' });
  assert.deepEqual(first, {
    driveAttempts: 1, driveStatus: 'pending', status: 'uploaded', exhausted: false,
  });

  const last = planDriveRetry({ driveAttempts: MAX_DRIVE_ATTEMPTS - 1, status: 'uploaded' });
  assert.deepEqual(last, {
    driveAttempts: MAX_DRIVE_ATTEMPTS, driveStatus: 'failed', status: 'needs_review', exhausted: true,
  });

  // Walking the whole budget must reach needs_review exactly once, at the declared limit.
  let attempts = 0;
  let passes = 0;
  while (passes < 20) {
    passes += 1;
    const plan = planDriveRetry({ driveAttempts: attempts, status: 'uploaded' });
    attempts = plan.driveAttempts;
    if (plan.exhausted) break;
  }
  assert.equal(passes, MAX_DRIVE_ATTEMPTS);
});

test('a move abandoned by a dead worker is reclaimed once its lease expires', () => {
  // moveOne flips the document to 'moving' before it streams, and movePending only matches
  // 'pending'. A worker killed during the transfer therefore left the clip stuck at 'moving'
  // with no pass on either side able to see it again.
  const at = new Date('2026-08-20T00:00:00Z');
  const moving = { driveStatus: 'moving', updatedAt: at };

  assert.equal(planStaleMoveReclaim(moving, at.getTime() + MOVING_LEASE_MS), 'reclaim');
  assert.equal(planStaleMoveReclaim(moving, at.getTime() + MOVING_LEASE_MS - 1), 'wait');
  // An upload that is genuinely still running must never be reclaimed underneath itself.
  assert.equal(planStaleMoveReclaim(moving, at.getTime() + 60_000), 'wait');
  assert.equal(planStaleMoveReclaim({ driveStatus: 'pending', updatedAt: at }, Date.now()), 'skip');
  assert.equal(planStaleMoveReclaim({ driveStatus: 'moved', updatedAt: at }, Date.now()), 'skip');
});

test('a moving document with no readable timestamp is left alone, not reclaimed', () => {
  // A serverTimestamp reads back null for a moment after it is written, and that moment is
  // exactly when the upload is most likely to be in flight.
  assert.equal(planStaleMoveReclaim({ driveStatus: 'moving', updatedAt: null }, Date.now()), 'wait');
  assert.equal(planStaleMoveReclaim({ driveStatus: 'moving' }, Date.now()), 'wait');
});

test('the reclaim lease is comfortably longer than the largest possible transfer', () => {
  // Reclaiming early risks a duplicate file in Drive, so the lease has to clear the worst case,
  // not the typical one: MAX_SIZE_BYTES is 500 MB, which is 4,000 Mbit — about 33 minutes on a
  // 2 Mbps line. The lease must sit above that with room to spare.
  const worstCaseMs = ((500 * 8) / 2) * 1000; // 500 MB at 2 Mbps, in ms
  assert.equal(Math.round(worstCaseMs / 60_000), 33);
  assert.ok(MOVING_LEASE_MS > worstCaseMs * 1.5, 'lease must clear the worst-case upload by 50%');
});

test('a reclaim spends the same attempt budget as a failed move', () => {
  // Otherwise a clip that stalls every pass would cycle for ever instead of reaching a human.
  const plan = planDriveRetry({ driveAttempts: MAX_DRIVE_ATTEMPTS - 1, status: 'uploaded' });
  assert.equal(plan.driveStatus, 'failed');
  assert.equal(plan.status, 'needs_review');
});
