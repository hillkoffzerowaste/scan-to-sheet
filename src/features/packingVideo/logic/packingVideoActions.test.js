import test from 'node:test';
import assert from 'node:assert/strict';

import { PACKING_VIDEO_STATUS } from '../../../services/packingVideoModel.js';
import {
  PACKING_VIDEO_ACTION,
  resolveUploadAction,
  reviewReasonText,
  uploadActionLabel,
} from './packingVideoActions.js';

const row = (overrides = {}) => ({
  videoId: 'pv_1',
  deviceId: 'PACK-A-1',
  status: PACKING_VIDEO_STATUS.pendingUpload,
  ...overrides,
});

const here = new Set(['pv_1']);
const elsewhere = new Set(['pv_other']);

test('a clip in review can still be uploaded from the device that recorded it', () => {
  // The bug this covers: an incomplete clip was moved to needs_review but the dashboard only
  // offered an action for pending_upload and upload_failed, so the footage sat in IndexedDB
  // with no way to release it and was eventually purged as stale metadata.
  const review = row({ status: PACKING_VIDEO_STATUS.needsReview });

  assert.deepEqual(resolveUploadAction(review, { localVideoIds: here }), {
    action: PACKING_VIDEO_ACTION.release,
    enabled: true,
    reason: '',
  });
});

test('the release action is offered but disabled away from the recording device', () => {
  // Offered, not hidden: an Admin on the wrong bench needs to be told which one to use.
  const result = resolveUploadAction(
    row({ status: PACKING_VIDEO_STATUS.needsReview }),
    { localVideoIds: elsewhere },
  );
  assert.equal(result.action, PACKING_VIDEO_ACTION.release);
  assert.equal(result.enabled, false);
  assert.match(result.reason, /PACK-A-1/);
});

test('a failed or queued upload gets a plain retry, not the release confirmation', () => {
  for (const status of [PACKING_VIDEO_STATUS.uploadFailed, PACKING_VIDEO_STATUS.pendingUpload]) {
    assert.equal(
      resolveUploadAction(row({ status }), { localVideoIds: here }).action,
      PACKING_VIDEO_ACTION.retry,
    );
  }
});

test('nothing is offered for a clip the queue already settled', () => {
  // `cancelled` is deliberately in this group: the queue treats it as runnable on its own, so
  // an Admin never has to push it.
  for (const status of [PACKING_VIDEO_STATUS.uploaded, PACKING_VIDEO_STATUS.cancelled]) {
    assert.deepEqual(resolveUploadAction(row({ status }), { localVideoIds: here }), {
      action: PACKING_VIDEO_ACTION.none,
      enabled: false,
      reason: '',
    });
  }
});

test('a missing local index never enables an action', () => {
  assert.equal(resolveUploadAction(row(), {}).enabled, false);
  assert.equal(resolveUploadAction(row(), { localVideoIds: null }).enabled, false);
  assert.equal(resolveUploadAction(undefined, { localVideoIds: here }).action, PACKING_VIDEO_ACTION.none);
});

test('the release action is labelled as the compromise it is', () => {
  assert.equal(uploadActionLabel(PACKING_VIDEO_ACTION.release), 'อัปโหลดแม้คลิปไม่สมบูรณ์');
  assert.equal(uploadActionLabel(PACKING_VIDEO_ACTION.retry), 'อัปโหลดซ้ำ');
  assert.equal(uploadActionLabel(PACKING_VIDEO_ACTION.none), '');
});

test('the review reason falls back through note, code, then unknown', () => {
  assert.equal(reviewReasonText({ note: 'วิดีโอไม่สมบูรณ์: เขียนลงเครื่องไม่ครบทุกช่วง' }),
    'วิดีโอไม่สมบูรณ์: เขียนลงเครื่องไม่ครบทุกช่วง');
  assert.equal(reviewReasonText({ note: '  ', lastErrorCode: 'PACKING_VIDEO_CHUNK_WRITE_FAILED' }),
    'รหัสปัญหา PACKING_VIDEO_CHUNK_WRITE_FAILED');
  assert.equal(reviewReasonText({}), 'ไม่ทราบสาเหตุ');
});
