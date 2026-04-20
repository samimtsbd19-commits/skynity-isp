import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard, Users, Inbox, Package, Radio,
  Activity, Router as RouterIcon, LogOut, Satellite,
  ScrollText, Settings, FileCode, Shield, Terminal,
  RefreshCw, UserCog, Cog,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { useSelectedRouter } from '../contexts/RouterContext';
import { apiStats } from '../api/client';
import clsx from 'clsx';

const nav = [
  { to: '/', label: 'Overview',    icon: LayoutDashboard, end: true },
  { to: '/orders', label: 'Inbox', icon: Inbox, badge: 'pending' },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/subscriptions', label: 'Subscriptions', icon: Activity },
  { to: '/monitoring', label: 'Live Sessions', icon: Radio },
  { to: '/packages', label: 'Packages', icon: Package },
  { to: '/routers', label: 'Routers', icon: RouterIcon },
  { to: '/configs', label: 'Configs', icon: FileCode },
  { to: '/vpn', label: 'VPN', icon: Shield },
  { to: '/scripts', label: 'Scripts', icon: Terminal },
  { to: '/updates', label: 'Updates', icon: RefreshCw },
  { to: '/admins', label: 'Admin users', icon: UserCog },
  { to: '/system', label: 'System', icon: Cog },
  { to: '/activity', label: 'Activity', icon: ScrollText },
  { to: '/settings', label: 'Profile', icon: Settings },
];

export default function Layout() {
  const { admin, logout } = useAuth();
  const { routerId, setRouterId, routers, routersLoading } = useSelectedRouter();
  const { data: stats } = useQuery({
    queryKey: ['stats', routerId],
    queryFn: () => apiStats(routerId),
    refetchInterval: 30_000,
  });

  const pendingCount = stats?.pendingOrders ?? 0;

  return (
    <div className="min-h-screen flex text-text">
      {/* ─────────── Sidebar ─────────── */}
      <aside className="w-60 shrink-0 bg-surface border-r border-border flex flex-col relative">
        <div className="absolute inset-0 grid-overlay" />

        {/* brand */}
        <div className="relative px-5 py-5 border-b border-border-dim">
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <Satellite size={18} className="text-amber" strokeWidth={1.5} />
              <span className="absolute -inset-1 bg-amber/20 blur-md -z-10 rounded-full" />
            </div>
            <div>
              <div className="text-display text-xl leading-none italic">Skynity</div>
              <div className="text-mono text-[10px] text-text-mute uppercase tracking-[0.2em] mt-0.5">
                Operations
              </div>
            </div>
          </div>
        </div>

        <div className="relative px-5 py-2.5 border-b border-border-dim">
          <label className="text-mono text-[10px] text-text-mute uppercase tracking-wider">MikroTik</label>
          <select
            className="input mt-1.5 text-xs py-1.5"
            value={routerId == null ? '' : String(routerId)}
            onChange={(e) => {
              const v = e.target.value;
              setRouterId(v === '' ? null : Number(v));
            }}
            disabled={routersLoading}
          >
            <option value="">Primary (env .env)</option>
            {routers.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}{r.is_default ? ' ★' : ''}
              </option>
            ))}
          </select>
        </div>

        {/* live indicator */}
        <div className="relative px-5 py-3 border-b border-border-dim">
          <div className="flex items-center justify-between text-[10px] text-text-mute uppercase tracking-wider font-mono">
            <span>Online now</span>
            <span className="text-text">
              {(stats?.onlinePppoe ?? 0) + (stats?.onlineHotspot ?? 0)}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="led led-on" />
            <span className="text-[11px] text-text-dim font-mono">
              {stats?.onlinePppoe ?? '—'} PPPoE · {stats?.onlineHotspot ?? '—'} Hotspot
            </span>
          </div>
        </div>

        {/* nav */}
        <nav className="relative flex-1 py-3 px-2 space-y-0.5">
          {nav.map((item) => {
            const showBadge = item.badge === 'pending' && pendingCount > 0;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  clsx(
                    'group flex items-center gap-3 px-3 py-2 text-sm transition-all rounded-sm relative',
                    'hover:bg-surface2',
                    isActive
                      ? 'bg-surface2 text-amber'
                      : 'text-text-dim hover:text-text'
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 bg-amber shadow-glow-amber" />
                    )}
                    <item.icon size={15} strokeWidth={1.5} />
                    <span className="flex-1">{item.label}</span>
                    {showBadge && (
                      <span className="text-mono text-[10px] bg-amber text-black px-1.5 py-px rounded-sm">
                        {pendingCount}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* user footer */}
        <div className="relative border-t border-border-dim p-3">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-7 h-7 rounded-sm bg-gradient-to-br from-amber to-amber-dim flex items-center justify-center text-black text-xs font-mono font-semibold">
              {(admin?.full_name || admin?.username || '?').charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate">{admin?.full_name || admin?.username}</div>
              <div className="text-[10px] text-text-mute uppercase tracking-wider font-mono">
                {admin?.role}
              </div>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-text-dim hover:text-red hover:bg-red/5 rounded-sm transition-colors"
          >
            <LogOut size={13} strokeWidth={1.5} />
            Sign out
          </button>
        </div>
      </aside>

      {/* ─────────── Main content ─────────── */}
      <main className="flex-1 min-w-0 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
