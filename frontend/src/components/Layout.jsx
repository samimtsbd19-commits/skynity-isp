import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, Inbox, Package, Radio,
  Activity, Router as RouterIcon, LogOut, Satellite,
  ScrollText, Settings, FileCode, Shield, Terminal,
  RefreshCw, UserCog, Cog, Ticket, ChevronDown, UserCheck,
  HeartPulse, Globe, Megaphone,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { useSelectedRouter } from '../contexts/RouterContext';
import { apiStats, apiSettings, apiEventsSummary } from '../api/client';
import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import { useLang, useT, LANG_LABELS } from '../i18n';

// ============================================================
// Sidebar groups — each group collapses independently. A group
// auto-opens when the current route belongs to one of its items,
// so the user always sees where they are. Everything else stays
// tucked away to keep the sidebar quiet.
// ============================================================
// Group structure is fully translated via i18n keys. We keep the
// icon/route here and look up the label at render time so language
// changes are instant without re-mounting the sidebar.
const GROUPS = [
  {
    key: 'customers',
    label: 'nav.customers',
    items: [
      { to: '/',                   label: 'nav.overview',       icon: LayoutDashboard, end: true },
      { to: '/orders',             label: 'nav.orders',         icon: Inbox, badge: 'pending' },
      { to: '/customers',          label: 'nav.customersPage',  icon: Users },
      { to: '/customer-accounts',  label: 'nav.portalAccounts', icon: UserCheck },
      { to: '/subscriptions',      label: 'nav.subscriptions',  icon: Activity },
      { to: '/vouchers',           label: 'nav.vouchers',       icon: Ticket },
      { to: '/offers',             label: 'nav.offers',         icon: Megaphone },
    ],
  },
  {
    key: 'network',
    label: 'nav.network',
    items: [
      { to: '/health',     label: 'nav.health',     icon: HeartPulse, badge: 'health' },
      { to: '/monitoring', label: 'Live Sessions',  icon: Radio },
      { to: '/packages',   label: 'nav.packages',   icon: Package },
      { to: '/routers',    label: 'nav.routers',    icon: RouterIcon },
      { to: '/configs',    label: 'nav.configs',    icon: FileCode },
      { to: '/vpn',        label: 'VPN',            icon: Shield },
      { to: '/scripts',    label: 'Scripts',        icon: Terminal },
      { to: '/updates',    label: 'Updates',        icon: RefreshCw },
    ],
  },
  {
    key: 'admin',
    label: 'nav.admin',
    items: [
      { to: '/admins',   label: 'nav.users',    icon: UserCog },
      { to: '/system',   label: 'nav.settings', icon: Cog },
      { to: '/activity', label: 'nav.audit',    icon: ScrollText },
      { to: '/settings', label: 'Profile',      icon: Settings },
    ],
  },
];

// Keys that already live under `nav.` in the catalogue get
// translated; anything else falls back to the raw label.
function tr(t, key) {
  return key.startsWith('nav.') || key.startsWith('common.') ? t(key) : key;
}

export default function Layout() {
  const { admin, logout } = useAuth();
  const { routerId, setRouterId, routers, routersLoading } = useSelectedRouter();
  const { data: stats } = useQuery({
    queryKey: ['stats', routerId],
    queryFn: () => apiStats(routerId),
    refetchInterval: 30_000,
  });
  const { data: eventsSum } = useQuery({
    queryKey: ['events-summary'],
    queryFn: apiEventsSummary,
    refetchInterval: 60_000,
  });
  const t = useT();
  const { lang, setLang, available } = useLang();

  const pendingCount = stats?.pendingOrders ?? 0;
  const healthCount  = (eventsSum?.critical ?? 0) + (eventsSum?.error ?? 0) + (eventsSum?.warning ?? 0);
  const { pathname } = useLocation();

  // Figure out which group the active route lives in — that one
  // is expanded by default; the rest start collapsed so the
  // sidebar isn't a wall of items on first load.
  const activeGroup = useMemo(() => {
    for (const g of GROUPS) {
      if (g.items.some((i) => i.end ? pathname === i.to : pathname.startsWith(i.to))) {
        return g.key;
      }
    }
    return 'customers';
  }, [pathname]);

  const [openGroups, setOpenGroups] = useState(() => ({ [activeGroup]: true }));
  useEffect(() => {
    setOpenGroups((prev) => ({ ...prev, [activeGroup]: true }));
  }, [activeGroup]);
  const toggleGroup = (key) =>
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));

  // ---- Branding (logo, primary colour, site name) --------------
  const { data: settingsRows } = useQuery({
    queryKey: ['settings-branding'],
    queryFn: apiSettings,
    staleTime: 5 * 60_000,
  });
  const branding = useMemo(() => {
    const map = {};
    (settingsRows || []).forEach((r) => { map[r.key] = r.value; });
    return {
      name:  map['site.name']              || 'Skynity',
      logo:  map['branding.logo_url']      || '',
      color: map['branding.primary_color'] || '',
    };
  }, [settingsRows]);

  useEffect(() => {
    if (branding.color) {
      document.documentElement.style.setProperty('--brand-accent', branding.color);
    }
  }, [branding.color]);

  // ---- Scroll scoping ------------------------------------------
  // We want ONLY the main content to scroll — not the whole page
  // (which would also drag the sidebar/footer with it). Lock body
  // scroll for the lifetime of the admin shell.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div className="h-screen flex text-text overflow-hidden">
      {/* ─────────── Sidebar ─────────── */}
      <aside className="w-60 shrink-0 bg-surface border-r border-border flex flex-col relative">
        <div className="absolute inset-0 grid-overlay pointer-events-none" />

        {/* brand */}
        <div className="relative px-5 py-5 border-b border-border-dim">
          <div className="flex items-center gap-2.5">
            <div className="relative shrink-0">
              {branding.logo ? (
                <img src={branding.logo} alt="" className="w-7 h-7 object-contain rounded-sm" />
              ) : (
                <>
                  <Satellite size={18} className="text-amber" strokeWidth={1.5} />
                  <span className="absolute -inset-1 bg-amber/20 blur-md -z-10 rounded-full" />
                </>
              )}
            </div>
            <div className="min-w-0">
              <div className="text-display text-xl leading-none italic truncate">{branding.name}</div>
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

        {/* collapsible nav groups */}
        <nav className="relative flex-1 py-2 px-2 space-y-1 overflow-y-auto">
          {GROUPS.map((g) => {
            const isOpen = !!openGroups[g.key];
            return (
              <div key={g.key}>
                <button
                  onClick={() => toggleGroup(g.key)}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-mono text-[10px] text-text-mute uppercase tracking-[0.2em] hover:text-text transition-colors"
                >
                  <span>{tr(t, g.label)}</span>
                  <ChevronDown
                    size={12}
                    className={clsx('transition-transform', isOpen ? 'rotate-0' : '-rotate-90')}
                  />
                </button>
                {isOpen && (
                  <div className="mt-1 space-y-0.5">
                    {g.items.map((item) => {
                      const badgeCount =
                        item.badge === 'pending' ? pendingCount :
                        item.badge === 'health'  ? healthCount  : 0;
                      const badgeColor =
                        item.badge === 'health' && (eventsSum?.critical || eventsSum?.error)
                          ? 'bg-red text-white'
                          : 'bg-amber text-black';
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
                              <span className="flex-1">{tr(t, item.label)}</span>
                              {badgeCount > 0 && (
                                <span className={clsx('text-mono text-[10px] px-1.5 py-px rounded-sm', badgeColor)}>
                                  {badgeCount}
                                </span>
                              )}
                            </>
                          )}
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div>
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
          <div className="mb-2 flex items-center gap-2 px-2 py-1 text-[11px] text-text-mute">
            <Globe size={12} />
            <span className="font-mono uppercase tracking-wider">{t('common.language')}</span>
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              className="ml-auto bg-transparent border border-border-dim rounded-sm text-xs px-1 py-0.5"
            >
              {available.map((code) => (
                <option key={code} value={code}>{LANG_LABELS[code] || code}</option>
              ))}
            </select>
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
