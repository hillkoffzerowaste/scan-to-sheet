import { formatBangkokDate, formatBangkokStamp, formatDuration } from './packingVideoFormat.js';

/**
 * The single source of truth for which keys a packingVideos document may carry.
 *
 * `firestore.rules` pins the same list with `hasOnly()`, and the Drive worker runs on
 * firebase-admin, which bypasses rules entirely. If the worker ever writes a key that is not
 * here, every later client update fails the `hasOnly` check and the whole batch dies — the
 * failure mode AGENTS.md §7 records for the marketplace sync. Both sides import this constant
 * so there is nothing to keep in sync by hand.
 */
export const PACKING_VIDEO_FIELDS = [
  'videoId',
  'trackingNo',
  'normalizedTrackingNo',
  'attemptNo',
  'orderId',
  'platform',
  'marketplaceOrderDocId',
  'packer',
  'packerStaffId',
  'stationId',
  'deviceId',
  'sessionId',
  'startedAt',
  'finishedAt',
  'durationMs',
  'bangkokDate',
  'status',
  'mimeType',
  'sizeBytes',
  'storagePath',
  'storageUrl',
  'uploadedAt',
  'uploadAttempts',
  'lastErrorCode',
  'sheetStatus',
  'sheetRowNumber',
  'driveStatus',
  'driveAttempts',
  'driveFileId',
  'driveUrl',
  'movedToDriveAt',
  'note',
  'createdByUid',
  'createdByEmail',
  'updatedAt',
];

/**
 * Stored as English codes, displayed in Thai.
 *
 * AGENTS.md §7 records that the Thai status strings in the scan sheet are wired into COUNTIF
 * formulas and conditional formatting, so they can never be respelled without migrating data.
 * Keeping the stored value a code means the Thai wording stays a presentation concern.
 */
export const PACKING_VIDEO_STATUS = {
  pendingUpload: 'pending_upload',
  uploaded: 'uploaded',
  uploadFailed: 'upload_failed',
  cancelled: 'cancelled',
  needsReview: 'needs_review',
};

export const PACKING_VIDEO_STATUS_VALUES = Object.values(PACKING_VIDEO_STATUS);

const STATUS_LABELS_TH = {
  [PACKING_VIDEO_STATUS.pendingUpload]: 'รออัปโหลด',
  [PACKING_VIDEO_STATUS.uploaded]: 'อัปโหลดสำเร็จ',
  [PACKING_VIDEO_STATUS.uploadFailed]: 'อัปโหลดไม่สำเร็จ',
  [PACKING_VIDEO_STATUS.cancelled]: 'ยกเลิก',
  [PACKING_VIDEO_STATUS.needsReview]: 'ต้องตรวจสอบ',
};

export const SHEET_STATUS = { pending: 'pending', written: 'written', failed: 'failed' };
/**
 * `purged` is terminal and exists so the retention sweep can leave the queue.
 *
 * The sweep reads the oldest `moved` documents; without a status change a document whose
 * Storage object was already deleted stayed `moved` for ever and kept occupying the batch,
 * so after the first sweep nothing was ever deleted again.
 */
export const DRIVE_STATUS = {
  pending: 'pending',
  moving: 'moving',
  moved: 'moved',
  purged: 'purged',
  failed: 'failed',
};

export const PACKING_VIDEO_SHEET_NAME = 'PackingVideos';

export const PACKING_VIDEO_SHEET_HEADERS = [
  'Video ID',
  'Tracking',
  'Order ID',
  'Platform',
  'Packer',
  'Packing Station',
  'Device ID',
  'Started At',
  'Finished At',
  'Duration',
  'Attempt No.',
  'Status',
  'Drive URL',
  'Note',
];

export const MAX_ATTEMPT_NO = 100;
export const MAX_NOTE_LENGTH = 500;
/** 2 hours. Well past the 15-minute auto-stop, so only corrupt data trips it. */
export const MAX_DURATION_MS = 7_200_000;
/** 500 MB. A 15-minute clip at 1.5 Mbps is ~169 MB, so this only rejects the absurd. */
export const MAX_SIZE_BYTES = 524_288_000;

export function packingVideoStatusLabel(status) {
  return STATUS_LABELS_TH[status] ?? String(status ?? '');
}

/**
 * Tracking numbers are matched the same way `findMarketplaceOrderByTracking` matches them
 * (firebaseScans.js:513). Diverging here would mean a video and its order disagree about
 * which tracking number they belong to.
 */
export function normalizePackingTracking(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function nextAttemptNo(lastAttemptNo) {
  const current = Number(lastAttemptNo);
  const next = Number.isFinite(current) && current > 0 ? Math.floor(current) + 1 : 1;
  if (next > MAX_ATTEMPT_NO) {
    throw Object.assign(new Error('เลขพัสดุนี้ถูกบันทึกวิดีโอครบจำนวนสูงสุดแล้ว'), {
      code: 'PACKING_VIDEO_ATTEMPT_LIMIT',
    });
  }
  return next;
}

const ALLOWED_TRANSITIONS = {
  [PACKING_VIDEO_STATUS.pendingUpload]: [
    PACKING_VIDEO_STATUS.uploaded,
    PACKING_VIDEO_STATUS.uploadFailed,
    PACKING_VIDEO_STATUS.cancelled,
    PACKING_VIDEO_STATUS.needsReview,
  ],
  // Retrying a failed upload puts it back in the queue; that is the only way back.
  [PACKING_VIDEO_STATUS.uploadFailed]: [
    PACKING_VIDEO_STATUS.pendingUpload,
    PACKING_VIDEO_STATUS.needsReview,
  ],
  [PACKING_VIDEO_STATUS.uploaded]: [PACKING_VIDEO_STATUS.needsReview],
  [PACKING_VIDEO_STATUS.cancelled]: [PACKING_VIDEO_STATUS.needsReview],
  // A reviewed clip can be re-queued once an Admin decides it is worth another try.
  [PACKING_VIDEO_STATUS.needsReview]: [PACKING_VIDEO_STATUS.pendingUpload],
};

export function canTransition(from, to) {
  if (from === to) return true;
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

const text = (value) => String(value ?? '').trim();
const int = (value) => {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

/**
 * Builds the Firestore payload. Returns exactly the keys in PACKING_VIDEO_FIELDS — never more,
 * never fewer — because `hasOnly()` in the rules rejects both.
 */
export function buildPackingVideoDoc(input) {
  const startedAt = input.startedAt ?? new Date();
  const doc = {
    videoId: text(input.videoId),
    trackingNo: text(input.trackingNo),
    normalizedTrackingNo: normalizePackingTracking(input.trackingNo),
    attemptNo: int(input.attemptNo),
    orderId: text(input.orderId),
    platform: text(input.platform),
    marketplaceOrderDocId: text(input.marketplaceOrderDocId),
    packer: text(input.packer),
    packerStaffId: text(input.packerStaffId),
    stationId: text(input.stationId),
    deviceId: text(input.deviceId),
    sessionId: text(input.sessionId),
    startedAt,
    finishedAt: input.finishedAt ?? null,
    durationMs: int(input.durationMs),
    // The day the clip STARTED, so a packing run that crosses midnight keeps its storage path,
    // its Drive folder and its sheet row on the same date.
    bangkokDate: formatBangkokDate(startedAt),
    status: input.status ?? PACKING_VIDEO_STATUS.pendingUpload,
    mimeType: text(input.mimeType),
    sizeBytes: int(input.sizeBytes),
    storagePath: text(input.storagePath),
    storageUrl: text(input.storageUrl),
    uploadedAt: input.uploadedAt ?? null,
    uploadAttempts: int(input.uploadAttempts),
    lastErrorCode: text(input.lastErrorCode),
    sheetStatus: input.sheetStatus ?? SHEET_STATUS.pending,
    sheetRowNumber: int(input.sheetRowNumber),
    driveStatus: input.driveStatus ?? DRIVE_STATUS.pending,
    driveAttempts: int(input.driveAttempts),
    driveFileId: text(input.driveFileId),
    driveUrl: text(input.driveUrl),
    movedToDriveAt: input.movedToDriveAt ?? null,
    note: text(input.note).slice(0, MAX_NOTE_LENGTH),
    createdByUid: text(input.createdByUid),
    createdByEmail: text(input.createdByEmail),
    updatedAt: input.updatedAt ?? null,
  };

  const keys = Object.keys(doc);
  const missing = PACKING_VIDEO_FIELDS.filter((field) => !keys.includes(field));
  const extra = keys.filter((key) => !PACKING_VIDEO_FIELDS.includes(key));
  if (missing.length || extra.length) {
    throw Object.assign(new Error('โครงสร้างข้อมูลวิดีโอไม่ถูกต้อง'), {
      code: 'PACKING_VIDEO_FIELD_MISMATCH',
      detail: { missing, extra },
    });
  }
  return doc;
}

/** The 14 sheet cells, in header order. Empty cells are '' so the row never has holes. */
export function buildPackingVideoSheetRow(doc) {
  return [
    text(doc.videoId),
    text(doc.trackingNo),
    text(doc.orderId),
    doc.platform ? String(doc.platform).toUpperCase() : '',
    text(doc.packer),
    text(doc.stationId),
    text(doc.deviceId),
    doc.startedAt ? formatBangkokStamp(doc.startedAt) : '',
    doc.finishedAt ? formatBangkokStamp(doc.finishedAt) : '',
    formatDuration(doc.durationMs),
    doc.attemptNo ? String(doc.attemptNo) : '',
    packingVideoStatusLabel(doc.status),
    text(doc.driveUrl),
    text(doc.note),
  ];
}
