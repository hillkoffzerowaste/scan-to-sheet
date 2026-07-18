export function nextCalendarDate(date) {
  const [year, month, day] = String(date).split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
}
