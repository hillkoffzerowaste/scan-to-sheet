import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTO_STOP_LIMIT_MS,
  AUTO_STOP_WARN_MS,
  RECORDER_TIMESLICE_MS,
  VIDEO_BITS_PER_SECOND,
  buildRecorderOptions,
  buildVideoConstraints,
  pickMimeType,
  toCameraError,
} from './recorderCapabilities.js';

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
