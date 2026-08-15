import test from 'node:test';
import assert from 'node:assert/strict';

import {
  acquireCamera,
  getCameraOwner,
  isCameraLocked,
  lockCamera,
  releaseCamera,
  resetCameraOwner,
  unlockCamera,
} from './cameraOwner.js';

test.beforeEach(() => resetCameraOwner());

test('the first claim takes the camera without evicting anyone', async () => {
  const result = await acquireCamera('qr');
  assert.equal(result.evicted, null);
  assert.equal(getCameraOwner(), 'qr');
});

test('a second claim evicts the previous owner exactly once', async () => {
  let evictions = 0;
  await acquireCamera('qr', { onEvict: () => { evictions += 1; } });
  const result = await acquireCamera('packing-video');

  assert.equal(result.evicted, 'qr');
  assert.equal(evictions, 1);
  assert.equal(getCameraOwner(), 'packing-video');
});

test('a locked recording cannot be evicted and the loser is told why', async () => {
  // Handing the camera to the barcode scanner mid-clip would truncate the recording.
  let evictions = 0;
  await acquireCamera('packing-video', { onEvict: () => { evictions += 1; }, lock: true });

  await assert.rejects(
    acquireCamera('qr'),
    (error) => error.code === 'PACKING_VIDEO_CAMERA_BUSY' && error.owner === 'packing-video',
  );
  assert.equal(evictions, 0, 'the recorder must not be asked to release');
  assert.equal(getCameraOwner(), 'packing-video');
});

test('unlocking lets the camera move on again', async () => {
  await acquireCamera('packing-video', { lock: true });
  assert.equal(isCameraLocked(), true);
  assert.equal(unlockCamera('packing-video'), true);

  const result = await acquireCamera('qr');
  assert.equal(result.evicted, 'packing-video');
});

test('lock and unlock only work for the current owner', async () => {
  await acquireCamera('qr');
  assert.equal(lockCamera('packing-video'), false);
  assert.equal(unlockCamera('packing-video'), false);
  assert.equal(isCameraLocked(), false);
});

test('re-claiming as the current owner does not re-trigger eviction', async () => {
  let evictions = 0;
  await acquireCamera('qr', { onEvict: () => { evictions += 1; } });
  const result = await acquireCamera('qr');
  assert.equal(result.evicted, null);
  assert.equal(evictions, 0);
});

test('releasing as a non-owner is a no-op', async () => {
  await acquireCamera('qr');
  assert.equal(releaseCamera('packing-video'), false);
  assert.equal(getCameraOwner(), 'qr');
  assert.equal(releaseCamera('qr'), true);
  assert.equal(getCameraOwner(), null);
});

test('an eviction handler that throws does not block the incoming owner', async () => {
  await acquireCamera('qr', { onEvict: () => { throw new Error('cleanup failed'); } });
  await assert.doesNotReject(acquireCamera('packing-video'));
  assert.equal(getCameraOwner(), 'packing-video');
});

test('an owner id is required', async () => {
  await assert.rejects(acquireCamera(''), TypeError);
});
