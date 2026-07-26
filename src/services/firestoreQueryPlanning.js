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
