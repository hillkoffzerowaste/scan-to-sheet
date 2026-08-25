import { buildDriveFileName } from '../../src/services/packingVideoIds.js';
import { formatBangkokDate } from '../../src/services/packingVideoFormat.js';

/**
 * Pure path helpers, shared with the tests. No Drive or Firestore calls belong here.
 */

export const DRIVE_ROOT_FOLDER = 'Packing Videos';
export const PLATFORM_FOLDERS = { shopee: 'SHOPEE', lazada: 'LAZADA', tiktok: 'TIKTOK' };

export function platformFolder(platform) {
  return PLATFORM_FOLDERS[String(platform ?? '').toLowerCase()] ?? 'OTHER';
}

/**
 * `Packing Videos / 2026 / 2026-08-15 / SHOPEE`
 *
 * The date is the clip's Bangkok start date, matching its storage path and its sheet row, so
 * a parcel packed across midnight does not end up filed under two different days.
 */
export function buildDriveFolderPath(doc) {
  const date = doc.bangkokDate || formatBangkokDate(toDate(doc.startedAt));
  return [DRIVE_ROOT_FOLDER, date.slice(0, 4), date, platformFolder(doc.platform)];
}

export function buildDriveNameForDoc(doc) {
  return buildDriveFileName({
    startedAt: toDate(doc.startedAt),
    platform: doc.platform,
    trackingNo: doc.trackingNo,
    stationId: doc.stationId,
    employeeId: doc.packerEmployeeId,
    packerFallback: doc.packerStaffId,
    extension: extensionFromMimeType(doc.mimeType),
  });
}

/**
 * The container the recorder actually produced.
 *
 * Renaming a webm to .mp4 does not transcode it; players that trust the extension simply fail
 * to open the file, which is the worst possible outcome for a dispute recording.
 */
export function extensionFromMimeType(mimeType) {
  const value = String(mimeType ?? '').toLowerCase();
  if (value.includes('mp4')) return 'mp4';
  if (value.includes('webm')) return 'webm';
  return 'webm';
}

export function toDate(value) {
  if (!value) return new Date(0);
  if (value instanceof Date) return value;
  if (typeof value?.toDate === 'function') return value.toDate();
  if (typeof value?._seconds === 'number') return new Date(value._seconds * 1000);
  return new Date(value);
}

/** Milliseconds after a successful move before the Storage object may be deleted. */
export const STORAGE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function isStorageDeletable(doc, now = Date.now()) {
  if (doc?.driveStatus !== 'moved' || !doc?.storagePath) return false;
  const movedAt = toDate(doc.movedToDriveAt).getTime();
  if (!movedAt) return false;
  return now - movedAt >= STORAGE_RETENTION_MS;
}

/** Retries a Drive move up to this many times before handing the clip to a human. */
export const MAX_DRIVE_ATTEMPTS = 5;

/**
 * What a failed Drive move should leave behind.
 *
 * Kept pure and separate because the two halves used to disagree: the attempt count was never
 * written back, and 'failed' is not in the pending query, so a clip got exactly one try and
 * then sat still while the code claimed a budget of five.
 */
export function planDriveRetry({ driveAttempts, status }, maxAttempts = MAX_DRIVE_ATTEMPTS) {
  const attempts = Math.max(0, Math.floor(Number(driveAttempts) || 0)) + 1;
  const exhausted = attempts >= maxAttempts;
  return {
    driveAttempts: attempts,
    driveStatus: exhausted ? 'failed' : 'pending',
    status: exhausted ? 'needs_review' : status,
    exhausted,
  };
}

/**
 * How long a document may sit at `driveStatus: 'moving'` before it is assumed abandoned.
 *
 * An hour is deliberately far above any real transfer. The largest clip the recorder will
 * produce is capped at 500 MB (MAX_SIZE_BYTES), which is 4,000 Mbit — about 33 minutes on a
 * 2 Mbps line. The cost of being wrong is asymmetric: reclaiming too early while an upload is
 * genuinely still running can leave a duplicate file in Drive, whereas reclaiming late only
 * delays an archive.
 */
export const MOVING_LEASE_MS = 60 * 60 * 1000;

/**
 * Whether a `moving` document has been abandoned by a worker that died mid-upload.
 *
 * `moveOne` flips a document to 'moving' before it streams, and the pending query only matches
 * 'pending' — so a worker killed during the transfer left the document stuck at 'moving' with
 * nothing on either side able to pick it up again.
 *
 * A document whose `updatedAt` cannot be read yet is left alone rather than reclaimed: a
 * serverTimestamp reads back null for a moment after it is written, and that moment is exactly
 * when an upload is most likely to be genuinely in flight.
 */
export function planStaleMoveReclaim(doc, now = Date.now(), leaseMs = MOVING_LEASE_MS) {
  if (doc?.driveStatus !== 'moving') return 'skip';
  const updatedAt = toDate(doc.updatedAt).getTime();
  if (!updatedAt) return 'wait';
  return now - updatedAt >= leaseMs ? 'reclaim' : 'wait';
}

/**
 * What the retention sweep should do with one `moved` document.
 *
 * `retire` is the case that matters: a document whose Storage object is already gone must stop
 * matching the sweep's query, or — because the sweep reads the oldest `moved` documents first —
 * it occupies a batch slot for ever and newer clips are never reached.
 */
export function planStoragePurge(doc, now = Date.now()) {
  if (doc?.driveStatus !== 'moved') return 'skip';
  if (!doc?.storagePath) return 'retire';
  return isStorageDeletable(doc, now) ? 'delete' : 'wait';
}
