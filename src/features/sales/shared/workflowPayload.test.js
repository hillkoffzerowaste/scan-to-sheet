import assert from 'node:assert/strict';
import test from 'node:test';
import { operationRole, sanitizeWorkflowPayload } from './workflowPayload.js';

test('maps every operational action to the same upstream role branch', () => {
  assert.equal(operationRole('store_update'), 'store');
  assert.equal(operationRole('store_booking_update'), 'store');
  assert.equal(operationRole('pack_update'), 'pack');
  assert.equal(operationRole('pack_archive'), 'pack');
  assert.equal(operationRole('queue'), 'sales');
  assert.equal(operationRole('reroute'), 'sales');
});

test('allowlists workflow payload including bounded nested work details', () => {
  const result = sanitizeWorkflowPayload({ orderId: 'O-1', action: 'store_update', storeStatus: 'checked', storeCheckerName: 'A', missingItems: ['x'], storeWorkDetails: { note: 'ok', checklist: { verified: true }, secret: 'no' }, secret: 'no' });
  assert.equal(result.secret, undefined);
  assert.equal(result.storeWorkDetails.secret, undefined);
  assert.deepEqual(result.storeWorkDetails.checklist, { verified: true });
});

test('rejects unknown workflow actions', () => {
  assert.throws(() => sanitizeWorkflowPayload({ orderId: 'O-1', action: 'driver_complete' }), /Unsupported/);
});
