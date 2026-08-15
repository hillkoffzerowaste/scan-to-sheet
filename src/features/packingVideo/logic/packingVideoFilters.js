import { PACKING_VIDEO_STATUS_VALUES, normalizePackingTracking } from '../../../services/packingVideoModel.js';
import { isKnownStation } from '../packingVideoStations.js';

export const DASHBOARD_PAGE_SIZE = 25;
/** Hard ceiling per search session. Every document read is billed, so the list cannot run away. */
export const DASHBOARD_MAX_ITEMS = 200;
export const MAX_DATE_RANGE_DAYS = 31;

const PLATFORMS = ['shopee', 'lazada', 'tiktok'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Counts calendar days between two `YYYY-MM-DD` strings.
 *
 * `Date.UTC` is safe here precisely because both sides are already calendar dates in Bangkok
 * terms — nothing is being converted from an instant, so there is no offset to lose. Do not
 * copy this pattern anywhere that starts from a timestamp.
 */
function calendarDaySpan(startDate, endDate) {
  const toUtc = (value) => {
    const [year, month, day] = value.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((toUtc(endDate) - toUtc(startDate)) / 86_400_000) + 1;
}

/**
 * Turns raw form input into a bounded query description.
 *
 * An empty form falls back to "today" rather than querying the whole collection: opening the
 * dashboard must never bill a read per video ever recorded.
 */
export function normalizePackingFilters(raw = {}, { today } = {}) {
  if (!DATE_PATTERN.test(String(today ?? ''))) {
    throw Object.assign(new Error('ไม่ทราบวันที่ปัจจุบัน'), { code: 'PACKING_VIDEO_MISSING_TODAY' });
  }

  const trackingNo = normalizePackingTracking(raw.trackingNo);
  const orderId = String(raw.orderId ?? '').trim();
  const platform = PLATFORMS.includes(String(raw.platform ?? '').toLowerCase())
    ? String(raw.platform).toLowerCase()
    : '';
  const packer = String(raw.packer ?? '').trim();
  const stationRaw = String(raw.stationId ?? '').trim().toUpperCase();
  const stationId = isKnownStation(stationRaw) ? stationRaw : '';
  const status = PACKING_VIDEO_STATUS_VALUES.includes(raw.status) ? raw.status : '';

  let startDate = DATE_PATTERN.test(String(raw.startDate ?? '')) ? raw.startDate : '';
  let endDate = DATE_PATTERN.test(String(raw.endDate ?? '')) ? raw.endDate : '';

  // A tracking number or order id is narrow on its own; anything else needs a date window.
  const hasNarrowFilter = Boolean(trackingNo || orderId);
  if (!startDate && !endDate && !hasNarrowFilter) {
    startDate = today;
    endDate = today;
  }
  if (startDate && !endDate) endDate = startDate;
  if (endDate && !startDate) startDate = endDate;

  if (startDate && endDate) {
    if (startDate > endDate) [startDate, endDate] = [endDate, startDate];
    if (calendarDaySpan(startDate, endDate) > MAX_DATE_RANGE_DAYS) {
      throw Object.assign(new Error(`เลือกช่วงวันที่ได้ไม่เกิน ${MAX_DATE_RANGE_DAYS} วัน`), {
        code: 'PACKING_VIDEO_FILTER_TOO_BROAD',
      });
    }
  }

  return { trackingNo, orderId, platform, packer, stationId, status, startDate, endDate };
}

/**
 * Describes the Firestore query without building it, so the shape can be asserted in tests.
 *
 * Only one equality field is paired with the date range at a time — Firestore needs a
 * composite index per combination, and the remaining filters are cheaper to apply in memory
 * over an already-bounded page than to index exhaustively.
 */
export function buildRecordingQuery(filters, { pageSize = DASHBOARD_PAGE_SIZE, cursor = null } = {}) {
  const where = [];

  if (filters.trackingNo) {
    where.push({ field: 'normalizedTrackingNo', op: '==', value: filters.trackingNo });
  } else if (filters.orderId) {
    where.push({ field: 'orderId', op: '==', value: filters.orderId });
  } else {
    if (filters.status) where.push({ field: 'status', op: '==', value: filters.status });
    else if (filters.packer) where.push({ field: 'packer', op: '==', value: filters.packer });
    else if (filters.stationId) where.push({ field: 'stationId', op: '==', value: filters.stationId });

    if (filters.startDate) where.push({ field: 'bangkokDate', op: '>=', value: filters.startDate });
    if (filters.endDate) where.push({ field: 'bangkokDate', op: '<=', value: filters.endDate });
  }

  const size = Math.min(Math.max(1, Math.floor(Number(pageSize) || DASHBOARD_PAGE_SIZE)), DASHBOARD_PAGE_SIZE);

  return {
    where,
    orderBy: [{ field: 'bangkokDate', direction: 'desc' }, { field: 'startedAt', direction: 'desc' }],
    limit: size,
    cursor,
  };
}

/** Applies the filters the query left out, over a page that is already bounded. */
export function applyResidualFilters(rows, filters) {
  return (rows ?? []).filter((row) => {
    if (filters.platform && row.platform !== filters.platform) return false;
    if (filters.packer && row.packer !== filters.packer) return false;
    if (filters.stationId && row.stationId !== filters.stationId) return false;
    if (filters.status && row.status !== filters.status) return false;
    return true;
  });
}
