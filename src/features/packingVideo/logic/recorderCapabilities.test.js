import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTO_STOP_LIMIT_MS,
  AUTO_STOP_WARN_MS,
  RECORDER_TIMESLICE_MS,
  VIDEO_BITS_PER_SECOND,
  buildRecorderOptions,
  buildVideoConstraints,
  chooseRecordedParts,
  isStaleCameraIdError,
  pickMimeType,
  toCameraError,
} from './recorderCapabilities.js';

const chunk = (seq) => ({ seq, blob: `blob${seq}` });

const supports = (...allowed) => (mimeType) => allowed.includes(mimeType);

test('pickMimeType prefers VP8 when everything is available', () => {
  // VP8 first is deliberate: cheap Android tablets fall back to software VP9 encoding.
  const picked = pickMimeType(() => true);
  assert.deepEqual(picked, { mimeType: 'video/webm;codecs=vp8', extension: 'webm' });
});

test('pickMimeType walks the fallback order', () => {
  assert.equal(pickMimeType(supports('video/webm;codecs=vp9', 'video/webm')).mimeType, 'video/webm;codecs=vp9');
  assert.equal(pickMimeType(supports('video/webm')).mimeType, 'video/webm');
  assert.deepEqual(pickMimeType(supports('video/mp4;codecs=avc1.42E01E')), {
    mimeType: 'video/mp4;codecs=avc1.42E01E',
    extension: 'mp4',
  });
});

test('pickMimeType returns null when nothing is supported so recording never starts', () => {
  assert.equal(pickMimeType(() => false), null);
  assert.equal(pickMimeType(undefined), null);
  assert.equal(pickMimeType(() => { throw new Error('boom'); }), null);
});

test('constraints use ideal, never exact, for resolution', () => {
  const constraints = buildVideoConstraints();
  assert.equal(constraints.audio, false);
  assert.deepEqual(constraints.video.width, { ideal: 1280 });
  assert.deepEqual(constraints.video.height, { ideal: 720 });
  assert.equal(constraints.video.deviceId, undefined);
  // An exact width would turn a webcam that tops out just under 720p into an outright failure.
  assert.equal(JSON.stringify(constraints).includes('"exact"'), false);
});

test('a chosen camera is pinned exactly so the bench keeps using the same lens', () => {
  const constraints = buildVideoConstraints({ cameraDeviceId: 'cam-1' });
  assert.deepEqual(constraints.video.deviceId, { exact: 'cam-1' });
});

test('recorder options carry the agreed bitrate', () => {
  assert.deepEqual(buildRecorderOptions('video/webm;codecs=vp8'), {
    mimeType: 'video/webm;codecs=vp8',
    videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
  });
  assert.equal(VIDEO_BITS_PER_SECOND, 1_500_000);
  assert.equal(RECORDER_TIMESLICE_MS, 5_000);
  assert.ok(AUTO_STOP_WARN_MS < AUTO_STOP_LIMIT_MS);
});

test('camera failures map onto stable codes with Thai text', () => {
  const denied = toCameraError({ name: 'NotAllowedError' });
  assert.equal(denied.code, 'PACKING_VIDEO_PERMISSION_DENIED');
  assert.ok(denied.message.length > 0);
  assert.equal(toCameraError({ name: 'NotReadableError' }).code, 'PACKING_VIDEO_CAMERA_BUSY');
  assert.equal(toCameraError({ name: 'OverconstrainedError' }).code, 'PACKING_VIDEO_CAMERA_UNSUPPORTED');
  assert.equal(toCameraError({ name: 'SomethingNew' }).code, 'PACKING_VIDEO_CAMERA_UNAVAILABLE');
});

test('a complete disk read is assembled in sequence order', () => {
  // getAll() does not promise order, and out-of-order parts make an unplayable file.
  const result = chooseRecordedParts({
    storedChunks: [chunk(2), chunk(0), chunk(1)],
    bufferedChunks: [],
    expectedCount: 3,
  });
  assert.deepEqual(result.parts, ['blob0', 'blob1', 'blob2']);
  assert.equal(result.source, 'indexeddb');
  assert.equal(result.complete, true);
});

test('a short disk read is reported rather than passed off as a whole clip', () => {
  // The bug this guards: the last chunks are the moment the box is closed, and losing them
  // silently produced a clip that looked fine and proved nothing.
  const result = chooseRecordedParts({
    storedChunks: [chunk(0), chunk(1)],
    bufferedChunks: ['a', 'b', 'c', 'd'],
    expectedCount: 4,
  });
  assert.equal(result.complete, false);
  assert.equal(result.source, 'memory', 'memory held more of the clip than disk did');
  assert.deepEqual(result.parts, ['a', 'b', 'c', 'd']);
});

test('disk wins when it holds at least as much as memory', () => {
  // Memory only keeps the most recent chunks, so a longer disk read is the better copy even
  // when it is not the whole clip.
  const result = chooseRecordedParts({
    storedChunks: [chunk(0), chunk(1), chunk(2)],
    bufferedChunks: ['c'],
    expectedCount: 5,
  });
  assert.equal(result.source, 'indexeddb');
  assert.equal(result.complete, false);
  assert.equal(result.parts.length, 3);
});

test('nothing recorded anywhere yields no parts, never a silent empty file', () => {
  const result = chooseRecordedParts({ storedChunks: [], bufferedChunks: [], expectedCount: 2 });
  assert.deepEqual(result.parts, []);
  assert.equal(result.complete, false);
});

test('a remembered camera id that no longer exists is worth one retry', () => {
  // Phone deviceIds change when camera permission is re-granted or site data is cleared.
  assert.equal(isStaleCameraIdError({ name: 'OverconstrainedError' }, 'cam-1'), true);
  assert.equal(isStaleCameraIdError({ name: 'NotFoundError' }, 'cam-1'), true);
});

test('failures that would repeat are not retried', () => {
  // Retrying a refused permission or a camera another app holds just fails twice as slowly.
  assert.equal(isStaleCameraIdError({ name: 'NotAllowedError' }, 'cam-1'), false);
  assert.equal(isStaleCameraIdError({ name: 'NotReadableError' }, 'cam-1'), false);
  // Nothing was pinned, so there is no narrower constraint left to drop.
  assert.equal(isStaleCameraIdError({ name: 'OverconstrainedError' }, ''), false);
});
