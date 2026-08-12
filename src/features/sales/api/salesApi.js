async function request(path, options = {}) {
  const response = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const payload = await response.json().catch(() => ({ error: 'ระบบตอบกลับไม่สมบูรณ์', code: 'INVALID_RESPONSE' }));
  if (!response.ok) throw Object.assign(new Error(payload.error || 'ดำเนินการไม่สำเร็จ'), { code: payload.code, status: response.status });
  return payload.data ?? payload;
}
const query = (values) => new URLSearchParams(Object.entries(values).filter(([, value]) => value !== undefined && value !== '')).toString();
export const salesApi = {
  customers: (q) => request(`/api/hillkoff/customers?${query({ q })}`),
  saveCustomer: (customer) => request('/api/hillkoff/customers', { method: 'POST', body: JSON.stringify({ customer }) }),
  customerHistory: (customerId) => request(`/api/hillkoff/customer-history?${query({ customerId })}`),
  orders: (q, scope) => request(`/api/hillkoff/orders?${query({ q, scope })}`),
  order: (id) => request(`/api/hillkoff/orders?${query({ id })}`),
  createOrder: (order) => request('/api/hillkoff/orders', { method: 'POST', body: JSON.stringify({ order }) }),
  dashboard: (selectedDate) => request('/api/hillkoff/dispatch-dashboard', { method: 'POST', body: JSON.stringify({ selectedDate }) }),
  queue: (orderId) => request('/api/hillkoff/workflow', { method: 'PATCH', body: JSON.stringify({ orderId, action: 'queue' }) }),
  assignRound: (orderId, roundCode) => request('/api/hillkoff/chiangmai-rounds', { method: 'PATCH', body: JSON.stringify({ orderId, roundCode }) }),
};
