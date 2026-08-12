import { sendError } from '../_auth.js';
import { hillkoffRequest, requireHillkoffSession, sendHillkoffError, sendHillkoffResult } from './_client.js';
import { recordSalesAudit } from './_audit.js';
const clean = (value, length) => String(value || '').trim().slice(0, length);
export function customerPayload(value = {}) {
  return { id: clean(value.id, 120), name: clean(value.name, 200), contact: clean(value.contact, 200), phone: clean(value.phone, 40), zone: clean(value.zone, 200), address: clean(value.address, 1500), mapUrl: clean(value.mapUrl, 1500), note: clean(value.note, 3000) };
}
export default async function handler(req, res) {
  try {
    const { session } = await requireHillkoffSession(req);
    if (req.method === 'GET') {
      const q = clean(req.query?.q, 200);
      if (q.length < 3) return sendError(res, { status: 400, code: 'CUSTOMER_QUERY_TOO_SHORT', message: 'กรุณากรอกคำค้นหาอย่างน้อย 3 ตัวอักษร' });
      return sendHillkoffResult(res, await hillkoffRequest({ path: '/api/v1/customers', query: { q } }));
    }
    if (req.method === 'POST') {
      const customer = customerPayload(req.body?.customer);
      if (!/^[A-Za-z0-9._-]{1,120}$/.test(customer.id) || !customer.name) return sendError(res, { status: 400, code: 'CUSTOMER_INVALID', message: 'ข้อมูลลูกค้าไม่ครบถ้วน' });
      if (customer.mapUrl && !/^https?:\/\//i.test(customer.mapUrl)) return sendError(res, { status: 400, code: 'CUSTOMER_MAP_INVALID', message: 'ลิงก์แผนที่ต้องขึ้นต้นด้วย http หรือ https' });
      const result = await hillkoffRequest({ path: '/api/v1/customers', method: 'POST', body: { customer } });
      await recordSalesAudit({ session, action: 'customer_save', targetId: customer.id, outcome: result.status < 300 ? 'success' : result.status === 409 ? 'conflict' : 'rejected', requestId: result.requestId }).catch(() => {});
      return sendHillkoffResult(res, result);
    }
    return sendError(res, { status: 405, code: 'METHOD_NOT_ALLOWED', message: 'คำขอนี้ไม่รองรับวิธีที่เรียกมา' });
  } catch (error) { return sendHillkoffError(res, error); }
}
