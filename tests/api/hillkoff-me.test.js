import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchHillkoffProfile } from '../../api/hillkoff-me.js';

test('forwards the server API key without exposing it in the result', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ ok: true, data: { clientId: 'client-1' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const result = await fetchHillkoffProfile('hk_live_test-secret', fetchImpl);

  assert.deepEqual(result, {
    status: 200,
    payload: { ok: true, data: { clientId: 'client-1' } },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://repo-rho-livid.vercel.app/api/v1/me');
  assert.equal(calls[0].init.headers['x-api-key'], 'hk_live_test-secret');
  assert.equal(calls[0].init.cache, 'no-store');
  assert.equal(JSON.stringify(result).includes('hk_live_test-secret'), false);
});

test('rejects a missing server API key before making a request', async () => {
  let called = false;

  await assert.rejects(
    fetchHillkoffProfile('', async () => {
      called = true;
    }),
    { code: 'HILLKOFF_NOT_CONFIGURED' },
  );
  assert.equal(called, false);
});

test('maps a non-JSON upstream response to a stable Thai error', async () => {
  const result = await fetchHillkoffProfile(
    'hk_live_test-secret',
    async () => new Response('gateway failure', { status: 502 }),
  );

  assert.deepEqual(result, {
    status: 502,
    payload: {
      ok: false,
      code: 'HILLKOFF_UPSTREAM_INVALID',
      error: 'ระบบ Hillkoff ตอบกลับไม่สมบูรณ์ กรุณาลองใหม่อีกครั้ง',
    },
  });
});
