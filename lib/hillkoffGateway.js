import crypto from 'node:crypto';
import { API_ERRORS, getSession, redisCommand, sendError, sendJson } from '../api/_auth.js';

const ORIGIN = 'https://repo-rho-livid.vercel.app';
const CUSTOMER_FIELDS = ['id','name','contact','phone','zone','address','mapUrl','note'];
const ORDER_FIELDS = ['id','customerId','deliveryMethod','workflowType','serviceDate','window','boxes','packageUnit','paymentType','cod','bookingNumber','bookingNumbers','salesNote','shippingCarrier','chiangmaiRoundCode'];
const clean = (value, length) => String(value || '').trim().slice(0, length);
export function customerPayload(value = {}) { return Object.fromEntries(CUSTOMER_FIELDS.map((key) => [key, clean(value[key], key === 'address' ? 1500 : key === 'note' ? 3000 : key === 'mapUrl' ? 1500 : key === 'phone' ? 40 : key === 'id' ? 120 : 200)])); }
export function allowedOrder(input = {}) { return Object.fromEntries(ORDER_FIELDS.filter((key) => input[key] !== undefined).map((key) => [key, input[key]])); }

export async function requireHillkoffSession(req) {
  const current = await getSession(req);
  if (!current.session?.email) throw Object.assign(new Error(API_ERRORS.noSession.message), API_ERRORS.noSession);
  return current;
}
export async function hillkoffRequest({ path, method = 'GET', query, body, fetchImpl = fetch, apiKey = process.env.HILLKOFF_API_KEY, timeoutMs = 15_000 }) {
  if (!/^\/api\/v1(?:\/|$)/.test(String(path || ''))) throw Object.assign(new Error('Rejected Hillkoff path'), { code: 'HILLKOFF_PATH_REJECTED', status: 500 });
  if (!String(apiKey || '').trim()) throw Object.assign(new Error('Missing HILLKOFF_API_KEY'), { code: 'HILLKOFF_NOT_CONFIGURED', status: 500 });
  const url = new URL(path, ORIGIN); Object.entries(query || {}).forEach(([key, value]) => { if (value !== undefined && value !== '') url.searchParams.set(key, String(value)); });
  const requestId = crypto.randomUUID(); let response;
  try { response = await fetchImpl(url.toString(), { method, headers: { 'x-api-key': apiKey, 'x-request-id': requestId, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) }); }
  catch (error) { throw Object.assign(new Error('Hillkoff request unavailable'), { code: error?.name === 'TimeoutError' ? 'HILLKOFF_TIMEOUT' : 'HILLKOFF_UNAVAILABLE', status: 503, requestId }); }
  const payload = await response.json().catch(() => null);
  if (!payload) return { status: 502, requestId, payload: { ok: false, code: 'HILLKOFF_UPSTREAM_INVALID', error: 'ระบบ Hillkoff ตอบกลับไม่สมบูรณ์ กรุณาลองใหม่อีกครั้ง', requestId } };
  if (!response.ok) { const code = response.status === 409 ? 'HILLKOFF_CONFLICT' : response.status === 429 ? 'HILLKOFF_RATE_LIMITED' : response.status === 403 ? 'HILLKOFF_FORBIDDEN' : response.status === 401 ? 'HILLKOFF_CREDENTIAL_REJECTED' : 'HILLKOFF_REQUEST_FAILED'; return { status: response.status, requestId, payload: { ok: false, code, error: response.status === 409 ? String(payload.error || 'ข้อมูลถูกแก้ไขพร้อมกัน กรุณาโหลดใหม่') : 'เชื่อมต่อระบบ Hillkoff ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', requestId } }; }
  return { status: response.status, requestId, payload };
}
export async function recordSalesAudit({ session, action, targetId = '', outcome, requestId, redis = redisCommand }) {
  const email = String(session?.email || '').trim().toLowerCase(); if (!email) return;
  const actorEmailHash = crypto.createHash('sha256').update(email).digest('hex'); const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date()); const key = `scan-to-sheet:sales-audit:${date}:${actorEmailHash}`;
  const entry = JSON.stringify({ actorEmailHash, action, targetId: String(targetId).slice(0, 120), outcome, requestId, at: new Date().toISOString() });
  await redis(['LPUSH', key, entry]); await redis(['LTRIM', key, '0', '999']); await redis(['EXPIRE', key, String(90 * 24 * 60 * 60)]);
}
export function sendResult(res, result) { sendJson(res, result.status, result.payload); }
export function sendGatewayError(res, error) { sendError(res, { status: error?.status || 500, code: error?.code || 'HILLKOFF_CONNECTION_FAILED', message: error?.message === API_ERRORS.noSession.message ? API_ERRORS.noSession.message : 'เชื่อมต่อระบบ Hillkoff ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', error }); }
