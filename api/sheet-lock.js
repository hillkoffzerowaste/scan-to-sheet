import crypto from 'node:crypto';

import { getSession, redisCommand, sendJson } from './_auth.js';

const LOCK_TTL_SECONDS = 20;
const LOCK_PREFIX = 'scan-to-sheet:sheet-lock:';

function lockKey(value) {
  return `${LOCK_PREFIX}${crypto.createHash('sha256').update(String(value)).digest('hex')}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const { session } = await getSession(req);
    if (!session?.email) {
      sendJson(res, 401, { error: 'No active Google session' });
      return;
    }

    const { action = 'acquire', resource, lockId } = req.body ?? {};
    if (!resource || !lockId) {
      sendJson(res, 400, { error: 'Missing lock resource or lock id' });
      return;
    }

    const key = lockKey(`${session.email}:${resource}`);
    if (action === 'release') {
      await redisCommand(['EVAL', 'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end', '1', key, lockId]);
      sendJson(res, 200, { acquired: true });
      return;
    }

    const result = await redisCommand(['SET', key, lockId, 'NX', 'EX', LOCK_TTL_SECONDS]);
    sendJson(res, 200, { acquired: result === 'OK', retryAfterMs: 250 });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}
