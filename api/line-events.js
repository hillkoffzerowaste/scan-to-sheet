import crypto from 'node:crypto';

import { getFirestoreStore, redactLineEvent } from './firestoreStore.js';
import { sendError, sendJson } from './_auth.js';

function validSecret(request) {
  const expected = String(process.env.LINE_FORWARD_SECRET || '');
  const received = String(request.headers['x-line-forward-secret'] || '');
  if (!expected || !received) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function eventId(event) {
  const value = String(event?.webhookEventId || event?.message?.id || '');
  return /^[a-zA-Z0-9_-]{1,160}$/.test(value) ? value : null;
}

export default async function lineEvents(req, res) {
  if (req.method !== 'POST') {
    sendError(res, { status: 405, code: 'METHOD_NOT_ALLOWED', message: 'คำขอนี้รองรับเฉพาะ POST' });
    return;
  }
  if (!validSecret(req)) {
    sendError(res, { status: 401, code: 'INVALID_LINE_FORWARD_SECRET', message: 'ไม่ผ่านการยืนยันตัวตน' });
    return;
  }
  const events = Array.isArray(req.body?.events) ? req.body.events : null;
  if (!events || events.length > 100) {
    sendError(res, { status: 400, code: 'INVALID_LINE_EVENTS', message: 'ข้อมูล LINE ไม่ถูกต้อง' });
    return;
  }

  const store = getFirestoreStore();
  let accepted = 0;
  for (const event of events) {
    const id = eventId(event);
    if (!id) continue;
    if (await store.saveLineEvent(id, {
      source: String(req.body?.source || 'line'),
      event: redactLineEvent(event),
    })) accepted += 1;
  }
  sendJson(res, 200, { ok: true, accepted, received: events.length });
}
