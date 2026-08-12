import crypto from 'node:crypto';
import { API_ERRORS, getSession, sendError, sendJson } from '../_auth.js';

const ORIGIN = 'https://repo-rho-livid.vercel.app';

export async function requireHillkoffSession(req) {
  const current = await getSession(req);
  if (!current.session?.email) throw Object.assign(new Error(API_ERRORS.noSession.message), API_ERRORS.noSession);
  return current;
}

export async function hillkoffRequest({ path, method = 'GET', query, body, fetchImpl = fetch, apiKey = process.env.HILLKOFF_API_KEY, timeoutMs = 15_000 }) {
  if (!/^\/api\/v1(?:\/|$)/.test(String(path || ''))) throw Object.assign(new Error('Rejected Hillkoff path'), { code: 'HILLKOFF_PATH_REJECTED', status: 500 });
  if (!String(apiKey || '').trim()) throw Object.assign(new Error('Missing HILLKOFF_API_KEY'), { code: 'HILLKOFF_NOT_CONFIGURED', status: 500 });
  const url = new URL(path, ORIGIN);
  Object.entries(query || {}).forEach(([key, value]) => { if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value)); });
  const requestId = crypto.randomUUID();
  let response;
  try {
    response = await fetchImpl(url.toString(), {
      method,
      headers: { 'x-api-key': apiKey, 'x-request-id': requestId, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw Object.assign(new Error('Hillkoff request unavailable'), { code: error?.name === 'TimeoutError' ? 'HILLKOFF_TIMEOUT' : 'HILLKOFF_UNAVAILABLE', status: 503, requestId });
  }
  const payload = await response.json().catch(() => null);
  if (!payload) return { status: 502, requestId, payload: { ok: false, code: 'HILLKOFF_UPSTREAM_INVALID', error: 'ระบบ Hillkoff ตอบกลับไม่สมบูรณ์ กรุณาลองใหม่อีกครั้ง', requestId } };
  if (!response.ok) {
    const code = response.status === 409 ? 'HILLKOFF_CONFLICT' : response.status === 429 ? 'HILLKOFF_RATE_LIMITED' : response.status === 403 ? 'HILLKOFF_FORBIDDEN' : response.status === 401 ? 'HILLKOFF_CREDENTIAL_REJECTED' : 'HILLKOFF_REQUEST_FAILED';
    return { status: response.status, requestId, payload: { ok: false, code, error: response.status === 409 ? String(payload.error || 'ข้อมูลถูกแก้ไขพร้อมกัน กรุณาโหลดใหม่') : 'เชื่อมต่อระบบ Hillkoff ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', ...(payload.data ? { data: payload.data } : {}), requestId } };
  }
  return { status: response.status, requestId, payload };
}

export function sendHillkoffResult(res, result) { sendJson(res, result.status, result.payload); }
export function sendHillkoffError(res, error) {
  sendError(res, { status: error?.status || 500, code: error?.code || 'HILLKOFF_CONNECTION_FAILED', message: error?.message === API_ERRORS.noSession.message ? API_ERRORS.noSession.message : 'เชื่อมต่อระบบ Hillkoff ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', error });
}
