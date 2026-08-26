import { formatBangkokDate, formatBangkokFileStamp } from './packingVideoFormat.js';

export const DEVICE_ID_KEY = 'scan-to-sheet-packing-device-id-v1';
export const STORAGE_ROOT = 'packing-videos';
/** Drive rejects very long names and Windows still chokes past ~255; 120 leaves room to spare. */
export const MAX_FILE_NAME_LENGTH = 120;

function randomHex(bytes, randomSource) {
  const values = randomSource(bytes);
  return Array.from(values, (value) => value.toString(16).padStart(2, '0')).join('');
}

function defaultRandomSource(bytes) {
  const buffer = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buffer);
  return buffer;
}

/**
 * `pv_<YYYYMMDD>_<device prefix>_<12 hex>`.
 *
 * This is the one idempotency key for the whole pipeline: IndexedDB key, Storage file name,
 * Firestore doc id and sheet column A all use it, so a retry at any stage lands on the same
 * row instead of creating a second one. Note it does NOT contain the attempt number — two
 * stations recording the same tracking number would collide on that.
 */
export function newVideoId({ deviceId, startedAt = new Date(), randomSource = defaultRandomSource } = {}) {
  const date = formatBangkokDate(startedAt).replace(/-/g, '');
  const devicePart = String(deviceId ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toLowerCase() || 'nodevice';
  return `pv_${date}_${devicePart}_${randomHex(6, randomSource)}`;
}

export function newSessionId({ randomSource = defaultRandomSource } = {}) {
  return `pv-ses-${randomHex(8, randomSource)}`;
}

export function newDeviceId({ randomSource = defaultRandomSource } = {}) {
  return `pv-dev-${randomHex(8, randomSource)}`;
}

/**
 * Reads the persisted device id, minting one when both stores are empty.
 *
 * It is kept in localStorage AND IndexedDB because a packer clearing site data — or Chrome
 * evicting best-effort storage — would otherwise silently make one workstation look like a
 * new device every time. Losing it is recoverable (Firestore still has every past row), so
 * this is a best-effort reconcile, not a fingerprint.
 */
export function resolveDeviceId({ fromLocalStorage, fromIndexedDb, randomSource } = {}) {
  const stored = String(fromLocalStorage ?? '').trim() || String(fromIndexedDb ?? '').trim();
  if (stored) return { deviceId: stored, minted: false };
  return { deviceId: newDeviceId({ randomSource }), minted: true };
}

/**
 * `packing-videos/<YYYY-MM-DD>/<videoId>_r<retryNo>.<ext>`
 *
 * The date comes from `startedAt`, matching the doc's `bangkokDate`. Using `finishedAt` would
 * file a clip that crossed midnight under a different day than its sheet row.
 * `retryNo` makes every object write a create, which is what lets storage.rules deny updates.
 */
export function buildStoragePath({ videoId, startedAt, retryNo = 0, extension = 'webm' }) {
  const id = String(videoId ?? '').trim();
  if (!id) {
    throw Object.assign(new Error('ไม่พบรหัสวิดีโอ'), { code: 'PACKING_VIDEO_MISSING_ID' });
  }
  const safeRetry = Math.max(0, Math.floor(Number(retryNo) || 0));
  const ext = String(extension ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'webm';
  return `${STORAGE_ROOT}/${formatBangkokDate(startedAt)}/${id}_r${safeRetry}.${ext}`;
}

/**
 * The Drive worker runs with bucket-wide credentials, so it must never treat a Firestore
 * string as an arbitrary object name. This accepts only the object name the client builder
 * can produce for this exact video and Bangkok start date.
 */
export function isCanonicalStoragePath({ storagePath, videoId, bangkokDate }) {
  const id = String(videoId ?? '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const date = String(bangkokDate ?? '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return Boolean(id && date && new RegExp(`^${STORAGE_ROOT}/${date}/${id}_r\\d+\\.(webm|mp4)$`, 'i').test(String(storagePath ?? '')));
}

export function sanitizeFileNameSegment(value, fallback = '') {
  const cleaned = String(value ?? '')
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '')
    .replace(/_{2,}/g, '_');
  return cleaned || fallback;
}

/**
 * `20260815_143025_SHOPEE_TH123456789_PACK-A_EMP001.webm`
 *
 * The packer segment uses `employeeId` rather than the Thai nickname: nicknames strip to an
 * empty string once non-ASCII characters are removed, which would make every file name
 * identical for Thai-named staff.
 *
 * The extension must be the real container. Renaming a webm to .mp4 does not transcode it —
 * the file simply fails to open in players that trust the extension.
 */
export function buildDriveFileName({
  startedAt,
  platform,
  trackingNo,
  stationId,
  employeeId,
  packerFallback,
  extension = 'webm',
}) {
  const ext = String(extension ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'webm';
  const segments = [
    formatBangkokFileStamp(startedAt),
    sanitizeFileNameSegment(String(platform ?? '').toUpperCase(), 'UNKNOWN'),
    sanitizeFileNameSegment(trackingNo, 'NOTRACK'),
    sanitizeFileNameSegment(stationId, 'NOSTATION'),
    sanitizeFileNameSegment(employeeId, sanitizeFileNameSegment(packerFallback, 'NOPACKER')),
  ];
  const base = segments.join('_');
  const maxBase = MAX_FILE_NAME_LENGTH - (ext.length + 1);
  return `${base.slice(0, maxBase)}.${ext}`;
}
