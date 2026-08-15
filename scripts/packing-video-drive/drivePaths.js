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
