export function rowsOf(payload) { return Array.isArray(payload) ? payload : payload?.items || payload?.orders || payload?.customers || []; }
export { queueBlocker };
export function groupRounds(orders = []) {
  return orders.reduce((groups, order) => { const key = order.chiangmaiRoundCode || 'unassigned'; (groups[key] ||= []).push(order); return groups; }, {});
}
export { CHIANGMAI_ROUNDS };
export function canAssignChiangmaiRound(order = {}) {
  return order.deliveryMethod === 'company_driver'
    && !order.driverId
    && !['queued', 'completed', 'outstation_ready', 'grab_completed', 'grab_ready', 'grab_picked_up', 'pack_archived', 'driver_archived'].includes(String(order.queueStatus || ''));
}
import { CHIANGMAI_ROUNDS, queueBlocker } from '@hillkoffzerowaste/sales-workspace';
