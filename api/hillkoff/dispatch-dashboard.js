import { sendError } from '../_auth.js';
import { hillkoffRequest, requireHillkoffSession, sendHillkoffError, sendHillkoffResult } from './_client.js';
export default async function handler(req, res) {
  try {
    await requireHillkoffSession(req);
    if (req.method !== 'POST') return sendError(res, { status: 405, code: 'METHOD_NOT_ALLOWED', message: 'คำขอนี้ไม่รองรับวิธีที่เรียกมา' });
    const selectedDate = String(req.body?.selectedDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) return sendError(res, { status: 400, code: 'DATE_INVALID', message: 'วันที่ไม่ถูกต้อง' });
    return sendHillkoffResult(res, await hillkoffRequest({ path: '/api/v1/orders/dispatch-dashboard', method: 'POST', body: { selectedDate } }));
  } catch (error) { return sendHillkoffError(res, error); }
}
