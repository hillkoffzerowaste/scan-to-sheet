import { sendError } from '../_auth.js';
import { hillkoffRequest, requireHillkoffSession, sendHillkoffError, sendHillkoffResult } from './_client.js';
export default async function handler(req, res) {
  try {
    await requireHillkoffSession(req);
    if (req.method !== 'GET') return sendError(res, { status: 405, code: 'METHOD_NOT_ALLOWED', message: 'คำขอนี้ไม่รองรับวิธีที่เรียกมา' });
    const customerId = String(req.query?.customerId || '').trim();
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(customerId)) return sendError(res, { status: 400, code: 'CUSTOMER_ID_INVALID', message: 'รหัสลูกค้าไม่ถูกต้อง' });
    return sendHillkoffResult(res, await hillkoffRequest({ path: '/api/v1/customers/history', query: { customerId } }));
  } catch (error) { return sendHillkoffError(res, error); }
}
