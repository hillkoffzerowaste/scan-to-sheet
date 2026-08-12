import assert from 'node:assert/strict';
import test from 'node:test';
import { canAssignChiangmaiRound, CHIANGMAI_ROUNDS, groupRounds, queueBlocker, rowsOf } from './models.js';

test('normalizes common Hillkoff list envelopes', () => {
  assert.deepEqual(rowsOf({ orders: [{ id: '1' }] }), [{ id: '1' }]);
  assert.deepEqual(rowsOf({ items: [{ id: '2' }] }), [{ id: '2' }]);
});

test('uses the exact upstream Chiang Mai codes and hides ineligible orders', () => {
  assert.deepEqual(CHIANGMAI_ROUNDS.map(([code]) => code), ['tuesday', 'wednesday', 'friday']);
  assert.equal(canAssignChiangmaiRound({ deliveryMethod: 'company_driver', queueStatus: 'preparing' }), true);
  assert.equal(canAssignChiangmaiRound({ deliveryMethod: 'outstation', queueStatus: 'preparing' }), false);
  assert.equal(canAssignChiangmaiRound({ deliveryMethod: 'company_driver', queueStatus: 'queued' }), false);
});

test('explains every queue readiness blocker', () => {
  assert.equal(queueBlocker({ workflowType: 'store_first', storeStatus: 'pending', packStatus: 'checked' }), 'สโตร์ยังไม่ยืนยัน');
  assert.equal(queueBlocker({ workflowType: 'direct_pack', packStatus: 'pending' }), 'ห้องแพ็คยังไม่พร้อม');
  assert.equal(queueBlocker({ workflowType: 'direct_pack', packStatus: 'checked', reworkRequired: true }), 'มีงานแก้ไขค้างอยู่');
  assert.equal(queueBlocker({ workflowType: 'direct_pack', packStatus: 'checked', deliveryMethod: 'company_driver' }), '');
});

test('groups Chiang Mai orders and retains unassigned work', () => {
  const grouped = groupRounds([{ id: '1', chiangmaiRoundCode: 'tue' }, { id: '2' }]);
  assert.equal(grouped.tue[0].id, '1'); assert.equal(grouped.unassigned[0].id, '2');
});
