import assert from 'node:assert/strict';
import test from 'node:test';
import { allowedOrder, customerPayload, hillkoffRequest } from '../../lib/hillkoffGateway.js';

test('gateway rejects paths outside api v1', async () => {
  await assert.rejects(() => hillkoffRequest({ path: '/api/orders', apiKey: 'secret', fetchImpl: async () => null }), (error) => error.code === 'HILLKOFF_PATH_REJECTED');
});

test('gateway maps conflicts without exposing credentials', async () => {
  let options;
  const result = await hillkoffRequest({ path: '/api/v1/orders', apiKey: 'top-secret', fetchImpl: async (_url, init) => { options = init; return { ok: false, status: 409, json: async () => ({ error: 'Booking already used' }) }; } });
  assert.equal(result.payload.code, 'HILLKOFF_CONFLICT');
  assert.equal(result.payload.error, 'Booking already used');
  assert.equal(JSON.stringify(result.payload).includes('top-secret'), false);
  assert.equal(options.headers['x-api-key'], 'top-secret');
});

test('allowlists customer and order payloads', () => {
  assert.deepEqual(customerPayload({ id: ' C-1 ', name: ' A ', secret: 'x' }), { id: 'C-1', name: 'A', contact: '', phone: '', zone: '', address: '', mapUrl: '', note: '' });
  assert.deepEqual(allowedOrder({ id: 'O-1', customerId: 'C-1', secret: 'x' }), { id: 'O-1', customerId: 'C-1' });
});

test('forwards an explicitly selected operational role', async () => {
  let headers;
  await hillkoffRequest({ path: '/api/v1/orders/workflow', method: 'PATCH', role: 'store', body: { orderId: 'O-1', action: 'store_update' }, apiKey: 'secret', fetchImpl: async (_url, init) => { headers = init.headers; return { ok: true, status: 200, json: async () => ({ ok: true }) }; } });
  assert.equal(headers['x-api-role'], 'store');
});
