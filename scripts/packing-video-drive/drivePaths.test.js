import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STORAGE_RETENTION_MS,
  buildDriveFolderPath,
  buildDriveNameForDoc,
  extensionFromMimeType,
  isStorageDeletable,
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
