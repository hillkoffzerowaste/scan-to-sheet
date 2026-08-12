async function request(path, options = {}) {
  const response = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const payload = await response.json().catch(() => ({ error: 'ระบบตอบกลับไม่สมบูรณ์', code: 'INVALID_RESPONSE' }));
  if (!response.ok) throw Object.assign(new Error(payload.error || 'ดำเนินการไม่สำเร็จ'), { code: payload.code, status: response.status });
  return payload.data ?? payload;
}
const query = (values) => new URLSearchParams(Object.entries(values).filter(([, value]) => value !== undefined && value !== '')).toString();
export const salesApi = {
  customers: (q) => request(`/api/hillkoff?${query({ op: 'customers', q })}`),
  saveCustomer: (customer) => request('/api/hillkoff?op=customers', { method: 'POST', body: JSON.stringify({ customer }) }),
  deleteCustomer: (customerId) => request('/api/hillkoff?op=customer-delete', { method: 'POST', body: JSON.stringify({ customerId }) }),
  customerHistory: (customerId) => request(`/api/hillkoff?${query({ op: 'customer-history', customerId })}`),
  orders: (q, scope) => request(`/api/hillkoff?${query({ op: 'orders', q, scope })}`),
  order: (id) => request(`/api/hillkoff?${query({ op: 'orders', id })}`),
  createOrder: (order) => request('/api/hillkoff?op=orders', { method: 'POST', body: JSON.stringify({ order }) }),
  deleteOrder: (orderId) => request('/api/hillkoff?op=order-delete', { method: 'POST', body: JSON.stringify({ orderId }) }),
  workflow: (payload) => request('/api/hillkoff?op=workflow', { method: 'PATCH', body: JSON.stringify(payload) }),
  dashboard: (selectedDate) => request('/api/hillkoff?op=dashboard', { method: 'POST', body: JSON.stringify({ selectedDate }) }),
  queue: (orderId) => request('/api/hillkoff?op=queue', { method: 'PATCH', body: JSON.stringify({ orderId, action: 'queue' }) }),
  assignRound: (orderId, roundCode) => request('/api/hillkoff?op=chiangmai-round', { method: 'PATCH', body: JSON.stringify({ orderId, roundCode }) }),
};
