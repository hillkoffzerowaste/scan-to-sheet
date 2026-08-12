import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSalesAdapter } from '@hillkoffzerowaste/sales-workspace';
import { createSalesApi } from './salesApi.js';

function response(data = {}) {
  return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

test('implements every command required by the shared workspace', () => {
  const adapter = createSalesApi(async () => response());
  assert.equal(assertSalesAdapter(adapter), adapter);
});

test('maps completion and reroute commands through the single Hillkoff gateway function', async () => {
  const calls = [];
  const adapter = createSalesApi(async (path, init) => { calls.push({ path, init }); return response(); });

  await adapter.completeChiangmaiOrders(['O-1', 'O-2']);
  await adapter.rerouteOrder('O-1', { deliveryMethod: 'outstation', workflowType: 'direct_pack', shippingCarrier: 'Kerry' }, 'ย้ายขนส่ง');

  assert.equal(calls[0].path, '/api/hillkoff?op=chiangmai-complete');
  assert.deepEqual(JSON.parse(calls[0].init.body), { selectedIds: ['O-1', 'O-2'] });
  assert.equal(calls[1].path, '/api/hillkoff?op=workflow');
  assert.deepEqual(JSON.parse(calls[1].init.body), { orderId: 'O-1', action: 'reroute', target: { deliveryMethod: 'outstation', workflowType: 'direct_pack', shippingCarrier: 'Kerry' }, reason: 'ย้ายขนส่ง' });
});
