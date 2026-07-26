import { listDatesBetween } from './googleSheets.js';

export function getSheetRecoveryDates({ startDate = '', endDate = '' } = {}) {
  return listDatesBetween(startDate, endDate);
}
