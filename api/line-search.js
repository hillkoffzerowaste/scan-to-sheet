import crypto from 'node:crypto';

import { getFirestoreStore } from './firestoreStore.js';
import { sendError, sendJson } from './_auth.js';

function validSecret(request) {
  const expected = String(process.env.LINE_FORWARD_SECRET || '');
  const received = String(request.headers['x-line-forward-secret'] || '');
  if (!expected || !received) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export default async function lineSearch(req, res) {
  if (req.method !== 'POST') {
    sendError(res, { status: 405, code: 'METHOD_NOT_ALLOWED', message: 'คำขอนี้รองรับเฉพาะ POST' });
    return;
  }
  if (!validSecret(req)) {
    sendError(res, { status: 401, code: 'INVALID_LINE_FORWARD_SECRET', message: 'ไม่ผ่านการยืนยันตัวตน' });
    return;
  }
  const query = String(req.body?.query ?? '').trim().slice(0, 120);
  if (query.length < 2) {
    sendError(res, { status: 400, code: 'INVALID_TRACKING_QUERY', message: 'กรุณาระบุเลขพัสดุอย่างน้อย 2 ตัวอักษร' });
    return;
  }
  const results = await getFirestoreStore().searchLineTracking(query);
  sendJson(res, 200, { ok: true, query, results });
}
