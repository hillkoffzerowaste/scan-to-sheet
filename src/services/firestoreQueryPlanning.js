import { getScanEventDate } from './scanRow.js';

const BANGKOK_TIME_ZONE = 'Asia/Bangkok';

const bangkokDateTimeFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: BANGKOK_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export function getMissingOrderQueryFilters({ summaryOnly = false } = {}) {
  return summaryOnly
    ? { field: 'status', operator: '==', value: 'pending' }
    : null;
}

function toBangkokLocalIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError('Invalid date');
  }

  return bangkokDateTimeFormatter.format(date).replace(' ', 'T');
}

export function getMissingOrderQueryWindow({ now = new Date(), hoursLookback = 48 } = {}) {
  if (!Number.isFinite(hoursLookback) || hoursLookback <= 0) {
    throw new RangeError('hoursLookback must be a positive number');
  }

  const endDate = now instanceof Date ? new Date(now) : new Date(now);
  if (!Number.isFinite(endDate.getTime())) {
    throw new TypeError('Invalid date');
  }

  return {
    start: toBangkokLocalIso(new Date(endDate.getTime() - hoursLookback * 60 * 60 * 1000)),
    end: toBangkokLocalIso(endDate),
  };
}

export function uniqueQueryDates(dates = []) {
  return [...new Set(dates.map((date) => String(date ?? '').trim()).filter(Boolean))].sort();
}

export function parseBangkokScanTimestamp(scannedAt) {
  const value = String(scannedAt ?? '').trim();
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:?\d{2})?$/i);
  if (!match) return NaN;
  // Date.parse normalizes February 30; reject rollover before applying any offset.
  const local = `${match[1]}T${match[2]}${match[3] || ''}`;
  const calendar = new Date(`${local}Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 19) !== local.slice(0, 19)) return NaN;
  return Date.parse(`${local}${match[4] || '+07:00'}`);
}

export async function collectScanReportOrders({ dates = [], readDate, readPacker, readAdmin, cap }) {
  const selected = new Set(uniqueQueryDates(dates));
  if (selected.size > 31) {
    throw Object.assign(new RangeError('เลือกช่วงรายงานได้ไม่เกิน 31 วัน'), { code: 'REPORT_DATE_RANGE' });
  }
  const byId = new Map();
  let limited = false;
  for (const date of selected) {
    for (const read of [readDate, readPacker, readAdmin]) {
      const orders = await read(date);
      limited ||= orders.length >= cap;
      for (const order of orders) byId.set(order.id, order);
    }
  }
  return { orders: [...byId.values()].filter((order) => selected.has(getScanEventDate(order))), limited };
}
