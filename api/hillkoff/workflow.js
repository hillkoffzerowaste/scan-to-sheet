import { sendError } from '../_auth.js';
import { hillkoffRequest, requireHillkoffSession, sendHillkoffError, sendHillkoffResult } from './_client.js';
import { recordSalesAudit } from './_audit.js';
export default async function handler(req, res) {
  try {
    const { session } = await requireHillkoffSession(req);
    if (req.method !== 'PATCH') return sendError(res, { status: 405, code: 'METHOD_NOT_ALLOWED', message: 'คำขอนี้ไม่รองรับวิธีที่เรียกมา' });
    const orderId = String(req.body?.orderId || '');
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(orderId) || req.body?.action !== 'queue') return sendError(res, { status: 400, code: 'WORKFLOW_INVALID', message: 'คำสั่งจัดคิวไม่ถูกต้อง' });
    const result = await hillkoffRequest({ path: '/api/v1/orders/workflow', method: 'PATCH', body: { orderId, action: 'queue' } });
    await recordSalesAudit({ session, action: 'order_queue', targetId: orderId, outcome: result.status < 300 ? 'success' : 'rejected', requestId: result.requestId }).catch(() => {});
    return sendHillkoffResult(res, result);
  } catch (error) { return sendHillkoffError(res, error); }
}
