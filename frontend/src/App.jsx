import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './hooks/useAuth';
import Layout from './components/Layout';
import { RouterProvider } from './contexts/RouterContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Orders from './pages/Orders';
import Customers from './pages/Customers';
import CustomerDetail from './pages/CustomerDetail';
import Subscriptions from './pages/Subscriptions';
import Monitoring from './pages/Monitoring';
import RouterMonitor from './pages/RouterMonitor';
import Packages from './pages/Packages';
import Routers from './pages/Routers';
import Activity from './pages/Activity';
import Settings from './pages/Settings';
import Configs from './pages/Configs';
import Vpn from './pages/Vpn';
import Scripts from './pages/Scripts';
import Updates from './pages/Updates';
import SystemSettings from './pages/SystemSettings';
import Admins from './pages/Admins';
import Vouchers from './pages/Vouchers';
import CustomerAccounts from './pages/CustomerAccounts';
import Health from './pages/Health';
import Security from './pages/Security';
import Offers from './pages/Offers';
import Suspensions from './pages/Suspensions';
import Bandwidth from './pages/Bandwidth';
import PublicPortal from './pages/PublicPortal';
import Hotspot from './pages/Hotspot';
import HotspotTemplate from './pages/HotspotTemplate';
import ProjectGuide from './pages/ProjectGuide';
import Diagnostics from './pages/Diagnostics';
import LiveMonitor from './pages/LiveMonitor';
import Memory from './pages/Memory';

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
});

function Protected({ children }) {
  const { admin } = useAuth();
  if (!admin) return <Navigate to="/login" replace />;
  return children;
}

// ─── Hostname-based routing ─────────────────────────────────
// wifi.skynity.org   → public customer portal at /
// admin.skynity.org  → admin panel at /
// localhost / any other → admin panel (dev convenience)
function isPublicHost() {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  // Treat anything that starts with 'admin.' as admin, everything else that
  // starts with 'wifi.' (or a bare 'skynity.org') as public.
  if (h.startsWith('admin.')) return false;
  if (h.startsWith('wifi.')) return true;
  if (h === 'skynity.org' || h === 'www.skynity.org') return true;
  return false; // localhost + unknown → admin (dev/legacy)
}

export default function App() {
  const publicHost = isPublicHost();
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {publicHost ? (
              // ── wifi.skynity.org — public customer portal ──
              // PublicPortal internally uses /portal/* absolute paths for navigation,
              // so we mount it under /portal/* and redirect / → /portal/ to keep links working.
              <>
                <Route path="/" element={<Navigate to="/portal" replace />} />
                <Route path="/portal/*" element={<PublicPortal />} />
                <Route path="*" element={<Navigate to="/portal" replace />} />
              </>
            ) : (
              // ── admin.skynity.org — operations panel ──
              <>
                {/* Old /portal path still works when accessed from admin host */}
                <Route path="/portal/*" element={<PublicPortal />} />
                <Route path="/login" element={<Login />} />
                <Route
                  path="/"
                  element={
                    <Protected>
                      <RouterProvider>
                        <Layout />
                      </RouterProvider>
                    </Protected>
                  }
                >
              <Route index element={<Dashboard />} />
              <Route path="orders" element={<Orders />} />
              <Route path="customers" element={<Customers />} />
              <Route path="customers/:id" element={<CustomerDetail />} />
              <Route path="customer-accounts" element={<CustomerAccounts />} />
              <Route path="subscriptions" element={<Subscriptions />} />
              <Route path="monitoring" element={<Monitoring />} />
              <Route path="router-monitor" element={<RouterMonitor />} />
              <Route path="health" element={<Health />} />
              <Route path="security" element={<Security />} />
              <Route path="packages" element={<Packages />} />
              <Route path="vouchers" element={<Vouchers />} />
              <Route path="offers" element={<Offers />} />
              <Route path="suspensions" element={<Suspensions />} />
              <Route path="bandwidth" element={<Bandwidth />} />
              <Route path="routers" element={<Routers />} />
              <Route path="configs" element={<Configs />} />
              <Route path="hotspot" element={<Hotspot />} />
              <Route path="hotspot-template" element={<HotspotTemplate />} />
              <Route path="vpn" element={<Vpn />} />
              <Route path="scripts" element={<Scripts />} />
              <Route path="updates" element={<Updates />} />
              <Route path="admins" element={<Admins />} />
              <Route path="system" element={<SystemSettings />} />
              <Route path="activity" element={<Activity />} />
              <Route path="settings" element={<Settings />} />
              <Route path="guide" element={<ProjectGuide />} />
              <Route path="diagnostics" element={<Diagnostics />} />
              <Route path="live-monitor" element={<LiveMonitor />} />
              <Route path="memory" element={<Memory />} />
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </>
            )}
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
