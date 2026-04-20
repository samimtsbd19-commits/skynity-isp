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
import Offers from './pages/Offers';
import PublicPortal from './pages/PublicPortal';

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

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {/* Public self-service portal — no auth, no admin chrome */}
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
              <Route path="packages" element={<Packages />} />
              <Route path="vouchers" element={<Vouchers />} />
              <Route path="offers" element={<Offers />} />
              <Route path="routers" element={<Routers />} />
              <Route path="configs" element={<Configs />} />
              <Route path="vpn" element={<Vpn />} />
              <Route path="scripts" element={<Scripts />} />
              <Route path="updates" element={<Updates />} />
              <Route path="admins" element={<Admins />} />
              <Route path="system" element={<SystemSettings />} />
              <Route path="activity" element={<Activity />} />
              <Route path="settings" element={<Settings />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
