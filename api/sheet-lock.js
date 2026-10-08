import crypto from 'node:crypto';

import { API_ERRORS, getSession, sendError, sendJson } from './_auth.js';
import { getFirestoreStore, SHEET_RATE_LIMIT, SHEET_RATE_WINDOW_MS } from './firestoreStore.js';

// One scan makes ~12 Google API round trips, each with a 25s timeout and up to ~30s of
// cumulative 429 backoff, so 120s could expire mid-scan and let a second device compute
// the same append row. Must stay above the worst-case duration of a single scan.
export const LOCK_TTL_SECONDS = 300;
export const SHEET_REQUEST_LIMIT_PER_MINUTE = SHEET_RATE_LIMIT;
export const SHEET_REQUEST_WINDOW_MS = SHEET_RATE_WINDOW_MS;
const LOCK_PREFIX = 'scan-to-sheet:sheet-lock:';
const RATE_PREFIX = 'scan-to-sheet:sheet-rate:';

export function sheetLockKey(value) {
  return `${LOCK_PREFIX}${crypto.createHash('sha256').update(String(value)).digest('hex')}`;
}

export function sheetRateKey(value) {
  return `${RATE_PREFIX}${crypto.createHash('sha256').update(String(value)).digest('hex')}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    sendError(res, API_ERRORS.methodNotAllowed);
    return;
  }

  try {
    const { session } = await getSession(req);
    if (!session?.email) {
      sendError(res, API_ERRORS.noSession);
      return;
    }

    const { action = 'acquire', resource, lockId, requestId } = req.body ?? {};
    if (!resource || (action === 'throttle' ? !requestId : !lockId)) {
      sendError(res, {
        status: 400,
        code: 'LOCK_REQUEST_INVALID',
        message: 'คำขอจองสิทธิ์เขียน Google Sheet ไม่ครบถ้วน',
      });
      return;
    }

    if (action === 'throttle') {
      sendJson(res, 200, await getFirestoreStore().throttle(requestId, {
        limit: SHEET_REQUEST_LIMIT_PER_MINUTE,
        windowMs: SHEET_REQUEST_WINDOW_MS,
      }));
      return;
    }

    const store = getFirestoreStore();
    if (action === 'renew') {
      const renewed = await store.renewLock(resource, lockId);
      sendJson(res, 200, { acquired: renewed, renewed });
      return;
    }
    if (action === 'release') {
      const released = await store.releaseLock(resource, lockId);
      // Report whether this caller actually still held the lock. Previously this always
      // answered `true`, so a lock that expired mid-scan (and may have been taken by
      // another device) was indistinguishable from a clean release.
      sendJson(res, 200, { acquired: true, released });
      return;
    }

    sendJson(res, 200, await store.acquireLock(resource, lockId));
  } catch (error) {
    sendError(res, {
      status: 500,
      code: 'SHEET_LOCK_FAILED',
      message: 'จองสิทธิ์เขียน Google Sheet ไม่สำเร็จ กรุณาลองอีกครั้ง',
      error,
    });
  }
}
