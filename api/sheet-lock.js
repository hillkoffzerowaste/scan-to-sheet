import crypto from 'node:crypto';

import { API_ERRORS, getSession, redisCommand, sendError, sendJson } from './_auth.js';

// One scan makes ~12 Google API round trips, each with a 25s timeout and up to ~30s of
// cumulative 429 backoff, so 120s could expire mid-scan and let a second device compute
// the same append row. Must stay above the worst-case duration of a single scan.
export const LOCK_TTL_SECONDS = 300;
export const SHEET_REQUEST_LIMIT_PER_MINUTE = 30;
export const SHEET_REQUEST_WINDOW_MS = 60_000;
const LOCK_PREFIX = 'scan-to-sheet:sheet-lock:';
const RATE_PREFIX = 'scan-to-sheet:sheet-rate:';
// Sheets quota is shared by this app's OAuth project, so the gate must cover all tabs
// and all browsers rather than allowing one 30-request bucket per spreadsheet.
const GLOBAL_RATE_RESOURCE = 'all-sheets';

const RATE_LIMIT_SCRIPT = [
  'local now = tonumber(ARGV[1])',
  'local window = tonumber(ARGV[2])',
  'local limit = tonumber(ARGV[3])',
  'redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", now - window)',
  'local count = redis.call("ZCARD", KEYS[1])',
  'if count >= limit then',
  '  local first = redis.call("ZRANGE", KEYS[1], 0, 0, "WITHSCORES")',
  '  local retry = window',
  '  if first[2] then retry = math.max(250, window - (now - tonumber(first[2]))) end',
  '  return {0, retry}',
  'end',
  'redis.call("ZADD", KEYS[1], now, ARGV[4])',
  'redis.call("EXPIRE", KEYS[1], math.ceil(window / 1000) + 5)',
  'return {1, 0}',
].join(' ');

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
      const now = Date.now();
      const result = await redisCommand([
        'EVAL', RATE_LIMIT_SCRIPT, '1', sheetRateKey(GLOBAL_RATE_RESOURCE),
        String(now), String(SHEET_REQUEST_WINDOW_MS), String(SHEET_REQUEST_LIMIT_PER_MINUTE),
        `${now}:${requestId}`,
      ]);
      const acquired = Array.isArray(result) && Number(result[0]) === 1;
      const retryAfterMs = Array.isArray(result) ? Math.max(250, Number(result[1]) || 250) : 1000;
      sendJson(res, 200, { acquired, retryAfterMs });
      return;
    }

    const key = sheetLockKey(resource);
    if (action === 'renew') {
      const renewed = await redisCommand(['EVAL', 'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("EXPIRE", KEYS[1], ARGV[2]) else return 0 end', '1', key, lockId, String(LOCK_TTL_SECONDS)]);
      sendJson(res, 200, { acquired: Number(renewed) === 1, renewed: Number(renewed) === 1 });
      return;
    }
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
