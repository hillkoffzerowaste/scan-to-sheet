import { sendError } from '../_auth.js';
import { hillkoffRequest, requireHillkoffSession, sendHillkoffError, sendHillkoffResult } from './_client.js';
import { recordSalesAudit } from './_audit.js';

const FIELDS = ['id','customerId','deliveryMethod','workflowType','serviceDate','window','boxes','packageUnit','paymentType','cod','bookingNumber','bookingNumbers','salesNote','shippingCarrier','chiangmaiRoundCode'];
export function allowedOrder(input = {}) { return Object.fromEntries(FIELDS.filter((key) => input[key] !== undefined).map((key) => [key, input[key]])); }
export default async function handler(req, res) {
  try {
    const { session } = await requireHillkoffSession(req);
    if (req.method === 'GET') {
      const q = String(req.query?.q || '').trim(); const id = String(req.query?.id || '').trim();
      const scope = req.query?.scope === 'outstation' ? 'outstation' : undefined;
      if ((!q && !id) || (q && id) || (q && q.length < 2) || (id && !/^[A-Za-z0-9._-]{1,120}$/.test(id))) return sendError(res, { status: 400, code: 'ORDER_QUERY_INVALID', message: 'กรุณาระบุคำค้นหาหรือรหัสออเดอร์ให้ถูกต้อง' });
      return sendHillkoffResult(res, await hillkoffRequest({ path: '/api/v1/orders', query: q ? { q, scope } : { id } }));
    }
    if (req.method === 'POST') {
      const order = allowedOrder(req.body?.order);
      if (!/^[A-Za-z0-9._-]{1,120}$/.test(String(order.id || '')) || !/^[A-Za-z0-9._-]{1,120}$/.test(String(order.customerId || ''))) return sendError(res, { status: 400, code: 'ORDER_INVALID', message: 'ข้อมูลออเดอร์ไม่ครบถ้วน' });
      const result = await hillkoffRequest({ path: '/api/v1/orders', method: 'POST', body: { order } });
      await recordSalesAudit({ session, action: 'order_create', targetId: order.id, outcome: result.status < 300 ? 'success' : result.status === 409 ? 'conflict' : 'rejected', requestId: result.requestId }).catch(() => {});
      return sendHillkoffResult(res, result);
    }
    return sendError(res, { status: 405, code: 'METHOD_NOT_ALLOWED', message: 'คำขอนี้ไม่รองรับวิธีที่เรียกมา' });
  } catch (error) { return sendHillkoffError(res, error); }
}
