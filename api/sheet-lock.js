import crypto from 'node:crypto';

import { API_ERRORS, getSession, redisCommand, sendError, sendJson } from './_auth.js';

// One scan makes ~12 Google API round trips, each with a 25s timeout and up to ~30s of
// cumulative 429 backoff, so 120s could expire mid-scan and let a second device compute
// the same append row. Must stay above the worst-case duration of a single scan.
export const LOCK_TTL_SECONDS = 300;
const LOCK_PREFIX = 'scan-to-sheet:sheet-lock:';

export function sheetLockKey(value) {
  return `${LOCK_PREFIX}${crypto.createHash('sha256').update(String(value)).digest('hex')}`;
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

    const { action = 'acquire', resource, lockId } = req.body ?? {};
    if (!resource || !lockId) {
      sendError(res, {
        status: 400,
        code: 'LOCK_REQUEST_INVALID',
        message: 'คำขอจองสิทธิ์เขียน Google Sheet ไม่ครบถ้วน',
      });
      return;
    }

    const key = sheetLockKey(resource);
    if (action === 'release') {
      const released = await redisCommand(['EVAL', 'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end', '1', key, lockId]);
      // Report whether this caller actually still held the lock. Previously this always
      // answered `true`, so a lock that expired mid-scan (and may have been taken by
      // another device) was indistinguishable from a clean release.
      sendJson(res, 200, { acquired: true, released: Number(released) === 1 });
      return;
    }

    const result = await redisCommand(['SET', key, lockId, 'NX', 'EX', LOCK_TTL_SECONDS]);
    sendJson(res, 200, { acquired: result === 'OK', retryAfterMs: 250 });
  } catch (error) {
    sendError(res, {
      status: 500,
      code: 'SHEET_LOCK_FAILED',
      message: 'จองสิทธิ์เขียน Google Sheet ไม่สำเร็จ กรุณาลองอีกครั้ง',
      error,
    });
  }
}
