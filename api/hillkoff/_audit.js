import crypto from 'node:crypto';

import { redisCommand } from '../_auth.js';

export async function recordSalesAudit({ session, action, targetId = '', outcome, requestId, redis = redisCommand }) {
  const email = String(session?.email || '').trim().toLowerCase();
  if (!email) return;
  const actorEmailHash = crypto.createHash('sha256').update(email).digest('hex');
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
  const key = `scan-to-sheet:sales-audit:${date}:${actorEmailHash}`;
  const entry = JSON.stringify({ actorEmailHash, action, targetId: String(targetId).slice(0, 120), outcome, requestId, at: new Date().toISOString() });
  await redis(['LPUSH', key, entry]);
  await redis(['LTRIM', key, '0', '999']);
  await redis(['EXPIRE', key, String(90 * 24 * 60 * 60)]);
}
