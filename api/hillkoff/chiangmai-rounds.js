import { sendError } from '../_auth.js';
import { hillkoffRequest, requireHillkoffSession, sendHillkoffError, sendHillkoffResult } from './_client.js';
import { recordSalesAudit } from './_audit.js';
export default async function handler(req, res) {
  try {
    const { session } = await requireHillkoffSession(req);
    if (req.method !== 'PATCH') return sendError(res, { status: 405, code: 'METHOD_NOT_ALLOWED', message: 'คำขอนี้ไม่รองรับวิธีที่เรียกมา' });
    const orderId = String(req.body?.orderId || ''); const roundCode = String(req.body?.roundCode || '').slice(0, 40);
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(orderId) || !roundCode) return sendError(res, { status: 400, code: 'ROUND_INVALID', message: 'ข้อมูลรอบเชียงใหม่ไม่ถูกต้อง' });
    const result = await hillkoffRequest({ path: '/api/v1/orders/chiangmai-rounds', method: 'PATCH', body: { orderId, roundCode } });
    await recordSalesAudit({ session, action: 'chiangmai_round_assign', targetId: orderId, outcome: result.status < 300 ? 'success' : 'rejected', requestId: result.requestId }).catch(() => {});
    return sendHillkoffResult(res, result);
  } catch (error) { return sendHillkoffError(res, error); }
}
