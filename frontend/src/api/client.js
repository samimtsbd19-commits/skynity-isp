import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 20000,
});

// attach token on every request
api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem('skynity_token');
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

// kick to login on 401
api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && !window.location.pathname.endsWith('/login')) {
      localStorage.removeItem('skynity_token');
      localStorage.removeItem('skynity_admin');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;

function routerParams(routerId) {
  if (routerId == null) return {};
  return { routerId };
}

// ---------- typed endpoint helpers ----------
export const apiLogin = (username, password) =>
  api.post('/auth/login', { username, password }).then((r) => r.data);

export const apiMe = () => api.get('/auth/me').then((r) => r.data);

export const apiChangePassword = (current_password, new_password) =>
  api.post('/auth/change-password', { current_password, new_password }).then((r) => r.data);

export const apiActivityLog = (limit = 50, offset = 0) =>
  api.get('/activity-log', { params: { limit, offset } }).then((r) => r.data);

export const apiRouters = () => api.get('/routers').then((r) => r.data.routers);

export const apiStats = (routerId) =>
  api.get('/stats', { params: routerParams(routerId) }).then((r) => r.data);

export const apiCustomers = (q, limit = 50, offset = 0) =>
  api.get('/customers', { params: { q, limit, offset } }).then((r) => r.data.customers);

export const apiCustomer = (id) => api.get(`/customers/${id}`).then((r) => r.data);

export const apiOrders = (status) =>
  api.get('/orders', { params: { status } }).then((r) => r.data.orders);

export const apiApproveOrder = (id) => api.post(`/orders/${id}/approve`).then((r) => r.data);
export const apiRejectOrder = (id, reason) =>
  api.post(`/orders/${id}/reject`, { reason }).then((r) => r.data);

export const apiPackages = () => api.get('/packages').then((r) => r.data.packages);
export const apiCreatePackage = (pkg) => api.post('/packages', pkg).then((r) => r.data);
export const apiUpdatePackage = (id, patch) => api.patch(`/packages/${id}`, patch).then((r) => r.data);

export const apiSubscriptions = (status) =>
  api.get('/subscriptions', { params: { status } }).then((r) => r.data.subscriptions);

export const apiMikrotikInfo = (routerId) =>
  api.get('/mikrotik/info', { params: routerParams(routerId) }).then((r) => r.data);
export const apiMikrotikActive = (routerId) =>
  api.get('/mikrotik/active', { params: routerParams(routerId) }).then((r) => r.data);
export const apiMikrotikInterfaces = (routerId) =>
  api.get('/mikrotik/interfaces', { params: routerParams(routerId) }).then((r) => r.data);
export const apiMikrotikQueues = (routerId) =>
  api.get('/mikrotik/queues', { params: routerParams(routerId) }).then((r) => r.data);
export const apiMikrotikNeighbors = (routerId) =>
  api.get('/mikrotik/neighbors', { params: routerParams(routerId) }).then((r) => r.data);
