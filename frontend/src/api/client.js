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

export const apiStatsRevenue = (days = 30) =>
  api.get('/stats/revenue', { params: { days } }).then((r) => r.data);

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

// ------------------------------------------------------------
// Phase 4 APIs: config files, VPN, scripts, updates, settings,
// admin users, router CRUD
// ------------------------------------------------------------

// ---------- Config files ----------
export const apiConfigs = () => api.get('/configs').then((r) => r.data.configs);
export const apiConfigUpload = (formData, onProgress) =>
  api.post('/configs', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: onProgress,
  }).then((r) => r.data);
export const apiConfigDelete = (id) => api.delete(`/configs/${id}`).then((r) => r.data);
export const apiConfigPush = (id, router_id, run_import = true) =>
  api.post(`/configs/${id}/push`, { router_id, run_import }).then((r) => r.data);
export const apiConfigPushes = (id) =>
  api.get(`/configs/${id}/pushes`).then((r) => r.data.pushes);
export const apiConfigDownloadUrl = (id) => `/api/configs/${id}/raw`;

// ---------- Generate MikroTik artefacts from DB (.rsc + login.html) ----------
export const apiGeneratePreview = (params = {}) =>
  api.get('/configs/generate/preview', { params }).then((r) => r.data);

export async function apiGenerateDownload(kind, params = {}) {
  // kind = 'setup.rsc' | 'login.html'
  const res = await api.get(`/configs/generate/${kind}`, {
    params,
    responseType: 'blob',
  });
  const blob = new Blob([res.data], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = kind === 'setup.rsc' ? 'skynity-setup.rsc' : 'login.html';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- VPN ----------
export const apiVpnTunnels = (params = {}) =>
  api.get('/vpn/tunnels', { params }).then((r) => r.data.tunnels);
export const apiVpnTunnel = (id) => api.get(`/vpn/tunnels/${id}`).then((r) => r.data);
export const apiVpnTunnelCreate = (data) =>
  api.post('/vpn/tunnels', data).then((r) => r.data);
export const apiVpnTunnelSync = (id) =>
  api.post(`/vpn/tunnels/${id}/sync`).then((r) => r.data);
export const apiVpnTunnelToggle = (id, enabled) =>
  api.post(`/vpn/tunnels/${id}/toggle`, { enabled }).then((r) => r.data);
export const apiVpnTunnelDelete = (id) =>
  api.delete(`/vpn/tunnels/${id}`).then((r) => r.data);
export const apiVpnPeers = (tunnelId) =>
  api.get(`/vpn/tunnels/${tunnelId}/peers`).then((r) => r.data.peers);
export const apiVpnPeerCreate = (tunnelId, data) =>
  api.post(`/vpn/tunnels/${tunnelId}/peers`, data).then((r) => r.data);
export const apiVpnPeerSync = (id) =>
  api.post(`/vpn/peers/${id}/sync`).then((r) => r.data);
export const apiVpnPeerDelete = (id) =>
  api.delete(`/vpn/peers/${id}`).then((r) => r.data);
export const apiVpnPeerConfigUrl = (id) => `/api/vpn/peers/${id}/config`;

// ---------- Scripts ----------
export const apiScripts = () => api.get('/scripts').then((r) => r.data.scripts);
export const apiScript = (id) => api.get(`/scripts/${id}`).then((r) => r.data);
export const apiScriptCreate = (data) => api.post('/scripts', data).then((r) => r.data);
export const apiScriptUpdate = (id, patch) => api.patch(`/scripts/${id}`, patch).then((r) => r.data);
export const apiScriptDelete = (id) => api.delete(`/scripts/${id}`).then((r) => r.data);
export const apiScriptExecute = (id, router_id) =>
  api.post(`/scripts/${id}/execute`, { router_id }).then((r) => r.data);
export const apiScriptInlineExecute = (router_id, source, name) =>
  api.post('/scripts/inline/execute', { router_id, source, name }).then((r) => r.data);
export const apiScriptExecutions = (params = {}) =>
  api.get('/scripts/executions/history', { params }).then((r) => r.data.executions);

// ---------- Updates ----------
export const apiUpdateCheck = (router_id, channel) =>
  api.post('/updates/check', { router_id, channel }).then((r) => r.data);
export const apiUpdateDownload = (router_id) =>
  api.post('/updates/download', { router_id }).then((r) => r.data);
export const apiUpdateInstall = (router_id) =>
  api.post('/updates/install', { router_id }).then((r) => r.data);
export const apiRouterReboot = (router_id) =>
  api.post('/updates/reboot', { router_id }).then((r) => r.data);
export const apiRouterPackages = (router_id) =>
  api.get('/updates/packages', { params: { router_id } }).then((r) => r.data.packages);
export const apiRouterPackageToggle = (router_id, package_id, enabled) =>
  api.post('/updates/packages/toggle', { router_id, package_id, enabled }).then((r) => r.data);
export const apiUpdateTasks = (router_id) =>
  api.get('/updates/tasks', { params: { router_id } }).then((r) => r.data.tasks);

// ---------- System Settings ----------
export const apiSettings = () => api.get('/settings').then((r) => r.data.settings);
export const apiSettingUpdate = (key, payload) =>
  api.put(`/settings/${encodeURIComponent(key)}`, payload).then((r) => r.data);
export const apiSettingsBulk = (settings) =>
  api.post('/settings/bulk', { settings }).then((r) => r.data);

// ---------- Admin users ----------
export const apiAdmins = () => api.get('/admins').then((r) => r.data.admins);
export const apiAdminCreate = (data) => api.post('/admins', data).then((r) => r.data);
export const apiAdminUpdate = (id, patch) => api.patch(`/admins/${id}`, patch).then((r) => r.data);
export const apiAdminDelete = (id) => api.delete(`/admins/${id}`).then((r) => r.data);

// ---------- Vouchers ----------
export const apiVoucherBatches = () =>
  api.get('/vouchers/batches').then((r) => r.data.batches);
export const apiVouchers = (params = {}) =>
  api.get('/vouchers', { params }).then((r) => r.data.vouchers);
export const apiVoucherBatchCreate = (data) =>
  api.post('/vouchers/batch', data).then((r) => r.data);
export const apiVoucherBatchDelete = (id) =>
  api.delete(`/vouchers/batches/${id}`).then((r) => r.data);
export const apiVoucherDelete = (id) =>
  api.delete(`/vouchers/${id}`).then((r) => r.data);
export const apiVoucherBatchPrintUrl = (id) => `/api/vouchers/batches/${id}/print`;

// ---------- Invoices ----------
export async function apiOpenOrderInvoice(codeOrId) {
  // fetch with auth, then open as blob URL (new-tab opens can't send Bearer
  // headers, so we can't just link to /api/orders/:id/invoice).
  const res = await api.get(`/orders/${codeOrId}/invoice`, { responseType: 'blob' });
  const blob = new Blob([res.data], { type: 'text/html; charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (!w) {
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function apiOpenVoucherBatchPrint(batchId) {
  const res = await api.get(`/vouchers/batches/${batchId}/print`, { responseType: 'blob' });
  const blob = new Blob([res.data], { type: 'text/html; charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (!w) {
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ---------- Customer accounts (admin moderation) ----------
export const apiCustomerAccounts = (status = 'pending') =>
  api.get('/customer-accounts', { params: { status } }).then((r) => r.data.accounts);
export const apiApproveAccount  = (id) => api.post(`/customer-accounts/${id}/approve`).then((r) => r.data);
export const apiRejectAccount   = (id, reason) => api.post(`/customer-accounts/${id}/reject`, { reason }).then((r) => r.data);
export const apiSuspendAccount  = (id) => api.post(`/customer-accounts/${id}/suspend`).then((r) => r.data);
export const apiResetAccountPw  = (id, password) =>
  api.post(`/customer-accounts/${id}/reset-password`, { password }).then((r) => r.data);

export const apiRunExpiryReminders = () =>
  api.post('/jobs/expiry-reminders/run').then((r) => r.data);

// ---------- Bandwidth ----------
export const apiSubscriptionBandwidth = (id, days = 14) =>
  api.get(`/subscriptions/${id}/bandwidth`, { params: { days } }).then((r) => r.data.days);

// ---------- Monitoring (per-router CPU/RAM/temp/SFP/ping/…) ----
export const apiMonitorRouters       = () => api.get('/monitoring/routers').then((r) => r.data.routers);
export const apiMonitorRouter        = (id) => api.get(`/monitoring/routers/${id}`).then((r) => r.data);
export const apiMonitorHistory       = (id, hours = 24) =>
  api.get(`/monitoring/routers/${id}/history`, { params: { hours } }).then((r) => r.data.rows);
export const apiMonitorPingHistory   = (id, hours = 24) =>
  api.get(`/monitoring/routers/${id}/ping-history`, { params: { hours } }).then((r) => r.data.rows);
export const apiMonitorAddPingTarget = (id, data) =>
  api.post(`/monitoring/routers/${id}/ping-targets`, data).then((r) => r.data);
export const apiMonitorDelPingTarget = (tid) =>
  api.delete(`/monitoring/ping-targets/${tid}`).then((r) => r.data);
export const apiMonitorPollNow       = () => api.post('/monitoring/poll-now').then((r) => r.data);
export const apiMonitorIfaceHistory  = (id, iface, hours = 24) =>
  api.get(`/monitoring/routers/${id}/interface-history`, { params: { iface, hours } }).then((r) => r.data);
export const apiMonitorQueueHistory  = (id, { queue, hours = 24 } = {}) =>
  api.get(`/monitoring/routers/${id}/queue-history`, { params: { queue, hours } }).then((r) => r.data);
export const apiMonitorTopUsers      = (id, { hours = 24, limit = 10 } = {}) =>
  api.get(`/monitoring/routers/${id}/top-users`, { params: { hours, limit } }).then((r) => r.data.rows);
export const apiMonitorSubUsage      = (subId, hours = 24) =>
  api.get(`/monitoring/subscriptions/${subId}/usage-history`, { params: { hours } }).then((r) => r.data);

// ---------- Suspensions & static IP ----------------------------
export const apiSuspensions              = () =>
  api.get('/suspensions').then((r) => r.data.suspensions);
export const apiSuspensionsByCustomer    = (customerId) =>
  api.get(`/suspensions/by-customer/${customerId}`).then((r) => r.data.suspensions);
export const apiSuspensionApply          = (data) =>
  api.post('/suspensions', data).then((r) => r.data);
export const apiSuspensionLift           = (id, data) =>
  api.post(`/suspensions/${id}/lift`, data || {}).then((r) => r.data);
export const apiSuspensionLiftAll        = (customerId, data) =>
  api.post(`/suspensions/by-customer/${customerId}/lift-all`, data || {}).then((r) => r.data);
export const apiStaticIpAssign           = (subscriptionId, ip) =>
  api.post(`/suspensions/subscriptions/${subscriptionId}/static-ip`, { ip }).then((r) => r.data);
export const apiStaticIpClear            = (subscriptionId) =>
  api.delete(`/suspensions/subscriptions/${subscriptionId}/static-ip`).then((r) => r.data);

// ---------- Bandwidth capacity / load balance ------------------
export const apiBandwidthOverview        = (routerId) =>
  api.get('/bandwidth/overview', { params: { router_id: routerId } }).then((r) => r.data);
export const apiBandwidthHistory         = (routerId, hours = 24) =>
  api.get('/bandwidth/history', { params: { router_id: routerId, hours } }).then((r) => r.data.rows);
export const apiBandwidthRouterIfaces    = (routerId) =>
  api.get(`/bandwidth/router/${routerId}/interfaces`).then((r) => r.data.interfaces);
export const apiBandwidthSaveUplink      = (routerId, payload) =>
  api.put(`/bandwidth/router/${routerId}/uplink`, payload).then((r) => r.data);

// ---------- Events / alerts ------------------------------------
export const apiEvents          = (status = 'open') =>
  api.get('/monitoring/events', { params: { status } }).then((r) => r.data.events);
export const apiEventsSummary   = () => api.get('/monitoring/events/summary').then((r) => r.data);
export const apiResolveEvent    = (id) => api.post(`/monitoring/events/${id}/resolve`).then((r) => r.data);
export const apiRunHealthChecks = () => api.post('/monitoring/events/run-checks').then((r) => r.data);

// ---------- Notifications ----------
export const apiNotifyChannels = () =>
  api.get('/notify/channels').then((r) => r.data.channels);
export const apiNotifyLog = (limit = 50, offset = 0) =>
  api.get('/notify/log', { params: { limit, offset } }).then((r) => r.data.log);
export const apiNotifyTest = (data) =>
  api.post('/notify/test', data).then((r) => r.data);
export const apiNotifySendCredentials = (data) =>
  api.post('/notify/send-credentials', data).then((r) => r.data);
export const apiNotifySendOrderCode = (data) =>
  api.post('/notify/send-order-code', data).then((r) => r.data);
export const apiNotifySend = (data) =>
  api.post('/notify/send', data).then((r) => r.data);

// ---------- Offers (admin CRUD + broadcast) ----------
export const apiOffers        = (all = false) =>
  api.get('/offers', { params: { all: all ? 1 : 0 } }).then((r) => r.data.offers);
export const apiOffer         = (id)   => api.get(`/offers/${id}`).then((r) => r.data);
export const apiOfferCreate   = (data) => api.post('/offers', data).then((r) => r.data);
export const apiOfferUpdate   = (id, patch) => api.patch(`/offers/${id}`, patch).then((r) => r.data);
export const apiOfferDelete   = (id)   => api.delete(`/offers/${id}`).then((r) => r.data);
export const apiOfferBroadcast = (id, data = {}) =>
  api.post(`/offers/${id}/broadcast`, data).then((r) => r.data);

// ---------- PCQ (shared bandwidth tree) ----------
export async function apiGeneratePcqDownload(params = {}) {
  const res = await api.get('/configs/generate/pcq.rsc', { params, responseType: 'blob' });
  const blob = new Blob([res.data], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'skynity-pcq.rsc';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const apiGeneratePcqPreview = (params = {}) =>
  api.get('/configs/generate/pcq-preview', { params }).then((r) => r.data);

// ---------- Router CRUD ----------
export const apiRouterCreate = (data) => api.post('/routers-admin', data).then((r) => r.data);
export const apiRouterUpdate = (id, patch) => api.patch(`/routers-admin/${id}`, patch).then((r) => r.data);
export const apiRouterDelete = (id) => api.delete(`/routers-admin/${id}`).then((r) => r.data);
export const apiRouterTest = (id) => api.post(`/routers-admin/${id}/test`).then((r) => r.data);
export const apiRouterTestConnection = (data) =>
  api.post('/routers-admin/test-connection', data).then((r) => r.data);
