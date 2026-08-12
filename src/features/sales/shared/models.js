export function rowsOf(payload) { return Array.isArray(payload) ? payload : payload?.items || payload?.orders || payload?.customers || []; }
export function queueBlocker(order = {}) {
  if (order.reworkRequired) return 'มีงานแก้ไขค้างอยู่';
  if (!['direct_pack'].includes(order.workflowType) && !['checked', 'partial'].includes(order.storeStatus)) return 'สโตร์ยังไม่ยืนยัน';
  if (!['checked', 'partial'].includes(order.packStatus)) return 'ห้องแพ็คยังไม่พร้อม';
  if (['grab_pickup', 'customer_pickup', 'outstation'].includes(order.deliveryMethod)) return 'ประเภทขนส่งนี้ไม่เข้าคิวคนขับ';
  return '';
}
export function groupRounds(orders = []) {
  return orders.reduce((groups, order) => { const key = order.chiangmaiRoundCode || 'unassigned'; (groups[key] ||= []).push(order); return groups; }, {});
}
export const CHIANGMAI_ROUNDS = [
  ['tuesday', 'วันอังคาร'],
  ['wednesday', 'วันพุธ'],
  ['friday', 'วันศุกร์'],
];
export function canAssignChiangmaiRound(order = {}) {
  return order.deliveryMethod === 'company_driver'
    && !order.driverId
    && !['queued', 'completed', 'outstation_ready', 'grab_completed', 'grab_ready', 'grab_picked_up', 'pack_archived', 'driver_archived'].includes(String(order.queueStatus || ''));
}
