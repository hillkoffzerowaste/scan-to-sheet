import { PACKING_VIDEO_STATUS } from '../../../services/packingVideoModel.js';

/**
 * Which upload action the dashboard offers for one row.
 *
 * Kept pure and out of the JSX because the interesting part is not the button, it is the rule
 * about *where* a clip can be uploaded from: the recording lives in the IndexedDB of the one
 * workstation that made it, so an action offered anywhere else has nothing to send.
 */
export const PACKING_VIDEO_ACTION = {
  /** Nothing to do: already uploaded, or the queue handles it without asking. */
  none: 'none',
  /** A normal re-queue of an upload that failed or has not run yet. */
  retry: 'retry',
  /**
   * Release a clip the recorder flagged as defective. Separate from `retry` because it needs
   * confirming: the Admin is deciding to archive footage that is known to be incomplete.
   */
  release: 'release',
};

const RETRY_STATUSES = [PACKING_VIDEO_STATUS.uploadFailed, PACKING_VIDEO_STATUS.pendingUpload];

/**
 * `hasLocalBlob` comes from listPendingVideos(), which is exactly "this device still holds the
 * file". A row without it is reported with `enabled: false` and a reason rather than hidden, so
 * an Admin looking at the wrong workstation is told which one to go to instead of seeing nothing.
 */
export function resolveUploadAction(row, { localVideoIds } = {}) {
  const status = row?.status ?? '';
  const action = RETRY_STATUSES.includes(status)
    ? PACKING_VIDEO_ACTION.retry
    : status === PACKING_VIDEO_STATUS.needsReview
      ? PACKING_VIDEO_ACTION.release
      : PACKING_VIDEO_ACTION.none;

  if (action === PACKING_VIDEO_ACTION.none) {
    return { action, enabled: false, reason: '' };
  }

  const hasLocalBlob = Boolean(localVideoIds?.has?.(row?.videoId));
  return {
    action,
    enabled: hasLocalBlob,
    reason: hasLocalBlob
      ? ''
      : `ต้องสั่งจากเครื่องที่บันทึกไว้ (${row?.deviceId || 'ไม่ทราบเครื่อง'})`,
  };
}

const ACTION_LABELS = {
  [PACKING_VIDEO_ACTION.retry]: 'อัปโหลดซ้ำ',
  [PACKING_VIDEO_ACTION.release]: 'อัปโหลดแม้คลิปไม่สมบูรณ์',
};

export function uploadActionLabel(action) {
  return ACTION_LABELS[action] ?? '';
}

/**
 * Why a clip is sitting in review, in the Admin's words.
 *
 * The recorder records the defect in `note` (and the reason code in `lastErrorCode`), so this
 * survives the upload — the status becomes `uploaded` like any other clip, and the note is what
 * still says the footage has a hole in it.
 */
export function reviewReasonText(row) {
  const note = String(row?.note ?? '').trim();
  if (note) return note;
  return row?.lastErrorCode ? `รหัสปัญหา ${row.lastErrorCode}` : 'ไม่ทราบสาเหตุ';
}
