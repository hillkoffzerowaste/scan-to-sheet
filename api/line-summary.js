import crypto from 'node:crypto';

import { getFirestoreStore } from './firestoreStore.js';
import { sendError, sendJson } from './_auth.js';

function validSecret(request) {
  const expected = String(process.env.LINE_FORWARD_SECRET || '');
  const received = String(request.headers['x-line-forward-secret'] || '');
  if (!expected || !received) return false;
  const left = Buffer.from(expected); const right = Buffer.from(received);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export default async function lineSummary(req, res) {
  if (req.method !== 'POST') return sendError(res, { status: 405, code: 'METHOD_NOT_ALLOWED', message: 'รองรับเฉพาะ POST' });
  if (!validSecret(req)) return sendError(res, { status: 401, code: 'INVALID_LINE_FORWARD_SECRET', message: 'ไม่ผ่านการยืนยันตัวตน' });
  const date = String(req.body?.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return sendError(res, { status: 400, code: 'INVALID_DATE', message: 'รูปแบบวันที่ไม่ถูกต้อง' });
  const result = await getFirestoreStore().summarizeLineToday(date);
  sendJson(res, 200, { ok: true, date, ...result });
}
