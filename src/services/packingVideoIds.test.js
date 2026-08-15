import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_FILE_NAME_LENGTH,
  buildDriveFileName,
  buildStoragePath,
  newSessionId,
  newVideoId,
  resolveDeviceId,
  sanitizeFileNameSegment,
} from './packingVideoIds.js';

/** Deterministic bytes so ids are assertable without stubbing global crypto. */
const fixedRandom = (bytes) => new Uint8Array(Array.from({ length: bytes }, (_, index) => index + 1));

test('newVideoId stamps the Bangkok date and the device prefix', () => {
  const id = newVideoId({
    deviceId: 'pv-dev-abcdef0123456789',
    startedAt: new Date('2026-08-15T07:30:25Z'),
    randomSource: fixedRandom,
  });
  assert.equal(id, 'pv_20260815_pvdevabc_010203040506');
});

test('newVideoId still produces an id when no device has been registered', () => {
  const id = newVideoId({ deviceId: '', startedAt: new Date('2026-08-15T07:30:25Z'), randomSource: fixedRandom });
  assert.match(id, /^pv_20260815_nodevice_[0-9a-f]{12}$/);
});

test('newSessionId is prefixed so it is recognisable in logs', () => {
  assert.equal(newSessionId({ randomSource: fixedRandom }), 'pv-ses-0102030405060708');
});

test('resolveDeviceId prefers a stored id and only mints when both stores are empty', () => {
  assert.deepEqual(resolveDeviceId({ fromLocalStorage: 'pv-dev-1', fromIndexedDb: 'pv-dev-2' }), {
    deviceId: 'pv-dev-1',
    minted: false,
  });
  // localStorage cleared but IndexedDB survived — the workstation keeps its identity.
  assert.deepEqual(resolveDeviceId({ fromLocalStorage: '', fromIndexedDb: 'pv-dev-2' }), {
    deviceId: 'pv-dev-2',
    minted: false,
  });
  const minted = resolveDeviceId({ randomSource: fixedRandom });
  assert.equal(minted.minted, true);
  assert.match(minted.deviceId, /^pv-dev-[0-9a-f]{16}$/);
});

test('buildStoragePath files a clip under the day it started', () => {
  const path = buildStoragePath({
    videoId: 'pv_20260815_abc_0001',
    // 23:59 Bangkok — finishedAt would fall on the next day and split the clip from its row.
    startedAt: new Date('2026-08-15T16:59:00Z'),
    extension: 'webm',
  });
  assert.equal(path, 'packing-videos/2026-08-15/pv_20260815_abc_0001_r0.webm');
});

test('buildStoragePath tags the retry so every upload is a fresh object', () => {
  const path = buildStoragePath({
    videoId: 'pv_1',
    startedAt: new Date('2026-08-15T07:30:25Z'),
    retryNo: 2,
    extension: 'MP4',
  });
  assert.equal(path, 'packing-videos/2026-08-15/pv_1_r2.mp4');
});

test('buildStoragePath refuses to build a path without an id', () => {
  assert.throws(
    () => buildStoragePath({ videoId: '', startedAt: new Date() }),
    (error) => error.code === 'PACKING_VIDEO_MISSING_ID',
  );
});

test('buildDriveFileName follows the agreed naming pattern', () => {
  assert.equal(
    buildDriveFileName({
      startedAt: new Date('2026-08-15T07:30:25Z'),
      platform: 'shopee',
      trackingNo: 'TH123456789',
      stationId: 'PACK-A',
      employeeId: 'EMP001',
      extension: 'webm',
    }),
    '20260815_143025_SHOPEE_TH123456789_PACK-A_EMP001.webm',
  );
});

test('buildDriveFileName falls back rather than emitting an empty segment for a Thai nickname', () => {
  // "มิ้ว" strips to nothing once non-ASCII is removed, which would collapse every Thai-named
  // packer to the same file name.
  assert.equal(sanitizeFileNameSegment('มิ้ว'), '');
  const name = buildDriveFileName({
    startedAt: new Date('2026-08-15T07:30:25Z'),
    platform: '',
    trackingNo: '',
    stationId: '',
    employeeId: '',
    packerFallback: 'มิ้ว',
    extension: 'webm',
  });
  assert.equal(name, '20260815_143025_UNKNOWN_NOTRACK_NOSTATION_NOPACKER.webm');
});

test('buildDriveFileName stays within the length ceiling', () => {
  const name = buildDriveFileName({
    startedAt: new Date('2026-08-15T07:30:25Z'),
    platform: 'shopee',
    trackingNo: 'T'.repeat(200),
    stationId: 'PACK-A',
    employeeId: 'EMP001',
    extension: 'webm',
  });
  assert.ok(name.length <= MAX_FILE_NAME_LENGTH, `got ${name.length}`);
  assert.ok(name.endsWith('.webm'));
});
