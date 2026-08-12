const ROLES = {
  store_update: 'store', store_booking_update: 'store', pack_update: 'pack', pack_archive: 'pack',
  queue: 'sales', reroute: 'sales', grab_pickup: 'sales', complaint_resolve: 'sales',
};
const FIELDS = ['orderId','action','note','reason','storeStatus','storePackerName','storeCheckerName','packStatus','packPackerName','packCheckerName','returnReason','missingItems','bookingNumber','bookingNumbers','entryStatus','target','storeWorkDetails','packWorkDetails'];
const WORK_FIELDS = ['detail','note','photoLocal','localPhotoCount','sharedToLine','checkResult','checklist'];

export function operationRole(action) { return ROLES[action] || ''; }
export function sanitizeWorkflowPayload(input = {}) {
  if (!operationRole(input.action)) throw new Error('Unsupported workflow action');
  const output = Object.fromEntries(FIELDS.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]));
  for (const key of ['storeWorkDetails', 'packWorkDetails']) if (output[key] && typeof output[key] === 'object') {
    output[key] = Object.fromEntries(WORK_FIELDS.filter((field) => output[key][field] !== undefined).map((field) => [field, field === 'checklist' ? { verified: output[key][field]?.verified === true } : output[key][field]]));
  }
  if (output.target && typeof output.target === 'object') output.target = Object.fromEntries(['deliveryMethod','workflowType','shippingCarrier'].filter((key) => output.target[key] !== undefined).map((key) => [key, output.target[key]]));
  return output;
}
