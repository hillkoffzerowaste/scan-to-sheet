import assert from 'node:assert/strict';
import test from 'node:test';
import { hillkoffRequest } from '../../lib/hillkoffGateway.js';

const fetchHillkoffProfile = (apiKey, fetchImpl) => hillkoffRequest({ path: '/api/v1/me', apiKey, fetchImpl });
test('forwards the server API key without exposing it in the result', async () => {
  const calls = []; const fetchImpl = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ ok: true, data: { clientId: 'client-1' } }), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  const result = await fetchHillkoffProfile('hk_live_test-secret', fetchImpl);
  assert.equal(result.status, 200); assert.deepEqual(result.payload, { ok: true, data: { clientId: 'client-1' } }); assert.equal(calls[0].url, 'https://repo-rho-livid.vercel.app/api/v1/me'); assert.equal(calls[0].init.headers['x-api-key'], 'hk_live_test-secret'); assert.equal(JSON.stringify(result).includes('hk_live_test-secret'), false);
});
test('rejects a missing server API key before making a request', async () => { let called = false; await assert.rejects(fetchHillkoffProfile('', async () => { called = true; }), { code: 'HILLKOFF_NOT_CONFIGURED' }); assert.equal(called, false); });
test('maps a non-JSON upstream response to a stable Thai error', async () => { const result = await fetchHillkoffProfile('hk_live_test-secret', async () => new Response('gateway failure', { status: 502 })); assert.equal(result.status, 502); assert.equal(result.payload.code, 'HILLKOFF_UPSTREAM_INVALID'); assert.equal(result.payload.error, 'ระบบ Hillkoff ตอบกลับไม่สมบูรณ์ กรุณาลองใหม่อีกครั้ง'); });
