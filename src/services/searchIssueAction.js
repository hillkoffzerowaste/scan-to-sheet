import { ISSUE_CUSTOMER_CANCELLED, ISSUE_DAMAGED } from '../constants.js';
import { withoutScanCountRemark } from './scanNotes.js';

export function getSearchIssueAction(row) {
  const note = withoutScanCountRemark(row.note);
  const damaged = note === ISSUE_DAMAGED || row.status === 'Damaged';
  const cancelled = note === ISSUE_CUSTOMER_CANCELLED || row.status === 'Cancelled';
  return { disabled: damaged || cancelled, label: damaged ? 'บันทึกแล้ว' : cancelled ? 'ยกเลิกแล้ว' : ISSUE_DAMAGED };
}
