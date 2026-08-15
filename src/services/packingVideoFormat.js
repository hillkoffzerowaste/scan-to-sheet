import { getBangkokParts } from './googleSheets.js';

const THAI_BUDDHIST_OFFSET = 543;

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw Object.assign(new Error('รูปแบบวันเวลาไม่ถูกต้อง'), {
      code: 'PACKING_VIDEO_INVALID_DATE',
    });
  }
  return date;
}

/**
 * `HH:mm:ss` — the same shape the recording screen shows ("เวลาที่บันทึก: 00:02:18"), so the
 * sheet column and the on-screen timer never disagree about how long a clip ran.
 */
export function formatDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.floor(Number(durationMs) || 0) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/** `YYYY-MM-DD` in Asia/Bangkok. */
export function formatBangkokDate(value) {
  return getBangkokParts(toDate(value)).date;
}

/** `YYYY-MM-DD HH:mm:ss` in Asia/Bangkok — what goes into the sheet's Started/Finished columns. */
export function formatBangkokStamp(value) {
  const parts = getBangkokParts(toDate(value));
  return `${parts.date} ${parts.time}`;
}

/** `YYYYMMDD_HHmmss` in Asia/Bangkok — the leading segment of a Drive file name. */
export function formatBangkokFileStamp(value) {
  const parts = getBangkokParts(toDate(value));
  return `${parts.date.replace(/-/g, '')}_${parts.time.replace(/:/g, '')}`;
}

/** `15/08/2569 เวลา 14:30 น.` — the duplicate-tracking dialog reads dates back to the packer. */
export function formatBuddhistDateTime(value) {
  const parts = getBangkokParts(toDate(value));
  const [year, month, day] = parts.date.split('-');
  const [hour, minute] = parts.time.split(':');
  return `${day}/${month}/${Number(year) + THAI_BUDDHIST_OFFSET} เวลา ${hour}:${minute} น.`;
}
