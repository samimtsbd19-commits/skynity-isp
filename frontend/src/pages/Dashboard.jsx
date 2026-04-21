import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Wallet, Activity, Inbox, Clock, Signal, Wifi, AlertTriangle,
  AlertOctagon, CheckCircle2, HeartPulse, ChevronRight,
  Cpu, MemoryStick, Download, Upload, Thermometer, Gauge,
} from 'lucide-react';
import {
  AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import {
  apiStats, apiStatsRevenue, apiOrders, apiMikrotikInfo, apiMikrotikActive,
  apiEventsSummary, apiEvents, apiLiveDashboard,
} from '../api/client';
import { useSelectedRouter } from '../contexts/RouterContext';
import { StatCard, StatusPill, EmptyState } from '../components/primitives';
import { PageHeader } from '../components/PageHeader';
import { formatDistanceToNow } from 'date-fns';

const RANGE_OPTIONS = [
  { days: 7,  label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
];

export default function Dashboard() {
  const { routerId } = useSelectedRouter();
  const [days, setDays] = useState(30);

  const { data: stats, isLoading } = useQuery({
    queryKey: ['stats', routerId],
    queryFn: () => apiStats(routerId),
    refetchInterval: 30_000,
  });
  const { data: revenue, isLoading: revLoading } = useQuery({
    queryKey: ['stats-revenue', days],
    queryFn: () => apiStatsRevenue(days),
    refetchInterval: 60_000,
  });
  const { data: pending } = useQuery({
    queryKey: ['orders', 'payment_submitted'],
    queryFn: () => apiOrders('payment_submitted'),
    refetchInterval: 30_000,
  });
  const { data: mtInfo } = useQuery({
    queryKey: ['mt-info', routerId],
    queryFn: () => apiMikrotikInfo(routerId),
    retry: false, refetchInterval: 60_000,
  });
  // Live MikroTik metrics (CPU/RAM/bandwidth) — refreshes every 5s for dashboard glance
  const { data: live } = useQuery({
    queryKey: ['dashboard-live', routerId],
    queryFn: () => apiLiveDashboard(routerId),
    refetchInterval: 5_000,
    retry: false,
  });
  const { data: mtActive } = useQuery({
    queryKey: ['mt-active', routerId],
    queryFn: () => apiMikrotikActive(routerId),
    retry: false, refetchInterval: 15_000,
  });

  const trend = revenue?.series || [];
  const now = new Date();

  const currencyFmt = (n) =>
    new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT', maximumFractionDigits: 0 }).format(n || 0);

  return (
    <div className="min-h-full">
      <PageHeader
        kicker={`Mission Control · ${now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}`}
        title="Overview"
        subtitle="Live snapshot of your ISP — revenue, customers, and router health in one glance."
        meta={
          <>
            <span>LAST SYNC · {now.toLocaleTimeString()}</span>
            <span>·</span>
            <span className="inline-flex items-center gap-1.5">
              <span className={`led ${mtInfo ? 'led-on' : 'led-off'}`} />
              {mtInfo ? 'Router linked' : 'Router offline'}
            </span>
          </>
        }
      />

      <div className="p-8 space-y-8">
        <HealthBanner />

        {/* LIVE ROUTER STRIP — at-a-glance real-time router health */}
        <LiveRouterStrip data={live} />

        {/* STAT GRID */}
        <section>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <StatCard
              label="Today's Revenue"
              value={currencyFmt(stats?.todayRevenue)}
              hint="verified payments"
              icon={Wallet}
              loading={isLoading}
            />
            <StatCard
              label="Pending Inbox"
              value={stats?.pendingOrders ?? '—'}
              hint="awaiting review"
              icon={Inbox}
              loading={isLoading}
              accent={stats?.pendingOrders > 0 ? 'text-amber' : ''}
            />
            <StatCard
              label="Active Subs"
              value={stats?.activeSubscriptions ?? '—'}
              hint="currently valid"
              icon={Activity}
              loading={isLoading}
            />
            <StatCard
              label="Online · PPPoE"
              value={stats?.onlinePppoe ?? '—'}
              hint="live sessions"
              icon={Signal}
              loading={isLoading}
            />
            <StatCard
              label="Online · Hotspot"
              value={stats?.onlineHotspot ?? '—'}
              hint="live sessions"
              icon={Wifi}
              loading={isLoading}
            />
            <StatCard
              label="Expiring Soon"
              value={stats?.expiringSoon ?? '—'}
              hint="within 3 days"
              icon={Clock}
              loading={isLoading}
              accent={stats?.expiringSoon > 0 ? 'text-amber' : ''}
            />
          </div>
        </section>

        {/* MAIN TWO-COLUMN */}
        <section className="grid lg:grid-cols-3 gap-6">
          {/* Revenue chart */}
          <div className="lg:col-span-2 panel p-6 overflow-hidden relative">
            <div className="flex items-baseline justify-between mb-5">
              <div>
                <div className="text-mono text-[10px] text-amber uppercase tracking-[0.2em]">
                  Revenue · {days} days
                </div>
                <div className="text-display text-3xl mt-1 italic">
                  {currencyFmt(revenue?.totals?.revenue)}
                </div>
                <div className="text-text-mute text-xs mt-1">
                  {revenue?.totals?.orders ?? 0} verified payments · {revenue?.totals?.customers_new ?? 0} new customers
                </div>
              </div>
              <div className="flex items-center gap-1">
                {RANGE_OPTIONS.map((r) => (
                  <button
                    key={r.days}
                    onClick={() => setDays(r.days)}
                    className={`px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider rounded-sm ${
                      days === r.days
                        ? 'bg-amber text-black'
                        : 'text-text-dim hover:text-text hover:bg-surface2'
                    }`}
                  >{r.label}</button>
                ))}
              </div>
            </div>
            <div className="h-52 -mx-2">
              {revLoading ? (
                <div className="h-full flex items-center justify-center text-text-mute text-xs font-mono">
                  Loading…
                </div>
              ) : !trend.length || revenue?.totals?.revenue === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-text-mute text-xs">
                  <div className="font-mono uppercase tracking-wider">no verified payments yet</div>
                  <div className="mt-1 opacity-70">approve an order to see the curve fill in</div>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trend} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor="#f59e0b" stopOpacity={0.4}/>
                        <stop offset="100%" stopColor="#f59e0b" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="2 4" stroke="#26262b" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                      minTickGap={24}
                      tick={{ fill: '#78787e', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                    />
                    <YAxis hide />
                    <Tooltip
                      cursor={{ stroke: '#f59e0b', strokeOpacity: 0.2 }}
                      contentStyle={{
                        background: '#131316', border: '1px solid #26262b',
                        borderRadius: 2, fontSize: 12, fontFamily: 'JetBrains Mono',
                      }}
                      labelStyle={{ color: '#8c8a85' }}
                      formatter={(v, _n, item) => [currencyFmt(v), `Revenue · ${item?.payload?.orders ?? 0} orders`]}
                      labelFormatter={(l) => l}
                    />
                    <Area
                      type="monotone" dataKey="revenue"
                      stroke="#f59e0b" strokeWidth={1.5}
                      fill="url(#revGrad)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="pt-4 mt-4 border-t border-border-dim flex items-center justify-between text-xs text-text-mute font-mono">
              <span>{days}d ago</span>
              <span>All-time: {currencyFmt(stats?.totalRevenue)}</span>
              <span>today</span>
            </div>
          </div>

          {/* Router status */}
          <div className="panel p-6">
            <div className="section-rule mb-5">
              <span className="text-mono text-[10px] text-amber uppercase tracking-[0.2em]">
                Router
              </span>
            </div>
            {!mtInfo ? (
              <div className="py-8">
                <div className="flex items-center gap-2 text-red text-sm">
                  <AlertTriangle size={14} /> Unreachable
                </div>
                <p className="text-text-mute text-xs mt-2">
                  Check WireGuard tunnel or MikroTik REST API service.
                </p>
              </div>
            ) : (
              <dl className="space-y-3 text-sm font-mono">
                <Row label="Model" value={mtInfo.boardName} />
                <Row label="ROS ver" value={mtInfo.version} />
                <Row label="Uptime" value={mtInfo.uptime} />
                <Row label="PPPoE act." value={`${mtActive?.pppoe?.length ?? 0}`} />
                <Row label="Hotspot act." value={`${mtActive?.hotspot?.length ?? 0}`} />
              </dl>
            )}
            <div className="mt-6 pt-4 border-t border-border-dim">
              <Link to="/monitoring" className="text-xs text-amber hover:text-amber-dim transition-colors font-mono uppercase tracking-wider">
                Live sessions →
              </Link>
            </div>
          </div>
        </section>

        {/* BREAKDOWNS */}
        {(revenue?.by_package?.length || revenue?.by_method?.length) ? (
          <section className="grid md:grid-cols-2 gap-6">
            <BreakdownCard
              title="Revenue by package"
              rows={revenue?.by_package || []}
              nameKey="name"
              total={revenue?.totals?.revenue}
              currencyFmt={currencyFmt}
            />
            <BreakdownCard
              title="Revenue by method"
              rows={revenue?.by_method || []}
              nameKey="method"
              total={revenue?.totals?.revenue}
              currencyFmt={currencyFmt}
            />
          </section>
        ) : null}

        {/* PENDING QUEUE */}
        <section>
          <div className="section-rule mb-4">
            <h2 className="text-display text-2xl italic">Pending approvals</h2>
          </div>
          {!pending?.length ? (
            <div className="panel">
              <EmptyState
                title="Inbox clear"
                hint="Orders awaiting your approval will appear here."
                icon={Inbox}
              />
            </div>
          ) : (
            <div className="panel divide-y divide-border-dim">
              {pending.slice(0, 6).map((o) => (
                <Link
                  key={o.id} to="/orders"
                  className="flex items-center gap-4 px-5 py-4 hover:bg-surface2/60 transition-colors"
                >
                  <div className="w-1 h-10 bg-amber rounded-full" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-3">
                      <span className="text-mono text-xs text-text-dim">{o.order_code}</span>
                      <StatusPill status={o.status} />
                    </div>
                    <div className="mt-0.5 text-sm truncate">
                      <span className="text-text">{o.full_name}</span>
                      <span className="text-text-mute mx-2">·</span>
                      <span className="text-text-dim">{o.package_name}</span>
                    </div>
                  </div>
                  <div className="text-right font-mono">
                    <div className="text-amber">{currencyFmt(o.amount)}</div>
                    <div className="text-[10px] text-text-mute mt-1">
                      {formatDistanceToNow(new Date(o.created_at), { addSuffix: true })}
                    </div>
                  </div>
                </Link>
              ))}
              {pending.length > 6 && (
                <Link to="/orders" className="block px-5 py-3 text-center text-xs text-amber hover:text-amber-dim font-mono uppercase tracking-wider">
                  View all {pending.length} pending →
                </Link>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function BreakdownCard({ title, rows, nameKey, total, currencyFmt }) {
  const safeTotal = Math.max(1, Number(total) || 0);
  return (
    <div className="panel p-6">
      <div className="section-rule mb-5">
        <span className="text-mono text-[10px] text-amber uppercase tracking-[0.2em]">
          {title}
        </span>
      </div>
      {!rows.length ? (
        <div className="text-text-mute text-xs font-mono py-6 text-center">
          No data in this window
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.slice(0, 6).map((r, i) => {
            const pct = Math.round(((Number(r.revenue) || 0) / safeTotal) * 100);
            const name = String(r[nameKey] || '—').toUpperCase();
            return (
              <li key={`${name}-${i}`}>
                <div className="flex items-baseline justify-between text-xs font-mono mb-1">
                  <span className="text-text">{name}</span>
                  <span className="text-amber">{currencyFmt(r.revenue)}</span>
                </div>
                <div className="h-1 bg-surface2 rounded-sm overflow-hidden">
                  <div
                    className="h-full bg-amber"
                    style={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
                  />
                </div>
                <div className="text-[10px] text-text-mute font-mono mt-1">
                  {r.orders ?? 0} orders · {pct}%
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <dt className="text-text-mute uppercase tracking-wider">{label}</dt>
      <dd className="text-text">{value ?? '—'}</dd>
    </div>
  );
}

// ============================================================
// Live router strip — real-time CPU/RAM/bandwidth on the dashboard
// so the operator sees the health of their network without
// clicking into Live Monitor. Refreshes every 5 seconds.
// ============================================================
function LiveRouterStrip({ data }) {
  const fmtBps = (bps) => {
    const n = Number(bps || 0);
    if (n < 1000) return `${n} bps`;
    if (n < 1_000_000) return `${(n / 1000).toFixed(1)} Kbps`;
    if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)} Mbps`;
    return `${(n / 1_000_000_000).toFixed(1)} Gbps`;
  };
  const fmtMem = (b) => `${Math.round((b || 0) / 1024 / 1024)}`;

  if (!data?.ts) {
    return (
      <div className="panel p-4 flex items-center justify-center text-text-mute text-xs font-mono">
        <Activity size={14} className="animate-pulse mr-2" /> Connecting to router…
      </div>
    );
  }
  const r = data.resource || {};
  const t = data.totals || {};
  const memPct = r.memory_total ? Math.round(((r.memory_total - r.memory_free) / r.memory_total) * 100) : 0;
  const tiles = [
    { icon: Cpu,         label: 'CPU',        value: `${r.cpu_load ?? 0}%`, pct: r.cpu_load || 0,  accent: r.cpu_load > 80 ? 'red' : r.cpu_load > 50 ? 'amber' : 'green' },
    { icon: MemoryStick, label: 'Memory',     value: `${memPct}%`, sub: `${fmtMem(r.memory_total - r.memory_free)}/${fmtMem(r.memory_total)} MB`, pct: memPct, accent: memPct > 80 ? 'red' : 'amber' },
    { icon: Download,    label: 'Download',   value: fmtBps(t.total_rx_bps), accent: 'amber' },
    { icon: Upload,      label: 'Upload',     value: fmtBps(t.total_tx_bps), accent: 'amber' },
    { icon: Activity,    label: 'PPPoE On',   value: t.pppoe_online ?? 0,   sub: `${t.total_pppoe_users ?? 0} total`, accent: 'green' },
    { icon: Wifi,        label: 'Hotspot On', value: t.hotspot_online ?? 0, sub: `${t.total_hotspot_users ?? 0} total`, accent: 'green' },
    { icon: Thermometer, label: 'Temp',       value: r.temperature ? `${r.temperature}°C` : '—', accent: r.temperature > 70 ? 'red' : 'green' },
    { icon: Clock,       label: 'Uptime',     value: r.uptime || '—', accent: 'text' },
  ];

  return (
    <Link to="/live-monitor" className="block group">
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-block w-2 h-2 rounded-full bg-green animate-pulse" />
        <span className="text-mono text-[10px] uppercase tracking-[0.2em] text-text-mute">
          Live Router · {r.board_name || ''} · {r.version || ''}
        </span>
        <span className="text-[10px] text-text-mute font-mono">· auto-refresh 5s</span>
        <ChevronRight size={11} className="text-text-mute group-hover:text-amber ml-auto" />
      </div>
      <div className="grid grid-cols-4 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {tiles.map((tl) => (
          <LiveTile key={tl.label} {...tl} />
        ))}
      </div>
    </Link>
  );
}

function LiveTile({ icon: Icon, label, value, sub, pct, accent = 'amber' }) {
  const accentClass = accent === 'red' ? 'text-red' : accent === 'green' ? 'text-green' : accent === 'text' ? 'text-text' : 'text-amber';
  return (
    <div className="panel p-3 relative overflow-hidden">
      <div className="flex items-center justify-between mb-1">
        <div className="text-mono text-[9px] text-text-mute uppercase tracking-widest">{label}</div>
        <Icon size={11} className={accentClass} />
      </div>
      <div className={`font-display text-xl leading-none ${accentClass}`}>{value}</div>
      {sub && <div className="text-[10px] text-text-mute font-mono mt-1 truncate">{sub}</div>}
      {pct !== undefined && (
        <div className="mt-1.5 h-0.5 bg-surface2 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${
              accent === 'red' ? 'bg-red' : accent === 'green' ? 'bg-green' : 'bg-amber'
            }`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ============================================================
// System-wide health banner at the top of the dashboard.
// Shows a green "all clear" bar when nothing's wrong, or a
// compact list of the top 3 critical/error issues otherwise.
// ============================================================
function HealthBanner() {
  const { data: summary } = useQuery({
    queryKey: ['events-summary'],
    queryFn: apiEventsSummary,
    refetchInterval: 30_000,
  });
  const topBad = (summary?.critical ?? 0) + (summary?.error ?? 0);
  const { data: events } = useQuery({
    queryKey: ['events', 'open', 'dash'],
    queryFn: () => apiEvents('open'),
    refetchInterval: 30_000,
    enabled: topBad > 0,
  });

  if (!summary) return null;

  if (summary.total === 0) {
    return (
      <div className="panel p-4 border-green/40 bg-green/5 flex items-center gap-3">
        <CheckCircle2 size={18} className="text-green" />
        <div className="flex-1">
          <div className="text-sm">All systems healthy.</div>
          <div className="text-[11px] text-text-mute">
            No open issues on VPS, routers, or network.
          </div>
        </div>
      </div>
    );
  }

  const top = (events || []).slice(0, 3);
  return (
    <div className={`panel p-4 ${topBad ? 'border-red/40 bg-red/5' : 'border-amber/40 bg-amber/5'}`}>
      <div className="flex items-center gap-3 mb-3">
        {topBad > 0
          ? <AlertOctagon size={18} className="text-red" />
          : <AlertTriangle size={18} className="text-amber" />}
        <div className="flex-1">
          <div className="text-sm">
            {summary.critical ? `${summary.critical} critical · ` : ''}
            {summary.error    ? `${summary.error} errors · `      : ''}
            {summary.warning  ? `${summary.warning} warnings`     : ''}
          </div>
          <div className="text-[11px] text-text-mute">Tap an issue to see the suggested fix.</div>
        </div>
        <Link to="/health" className="btn btn-ghost text-xs">
          <HeartPulse size={12} /> View all <ChevronRight size={12} />
        </Link>
      </div>
      {top.length > 0 && (
        <ul className="space-y-1">
          {top.map((e) => (
            <li key={e.id}>
              <Link
                to="/health"
                className="flex items-center gap-2 text-xs hover:bg-surface2/50 rounded-sm px-2 py-1"
              >
                <span className={
                  e.severity === 'critical' || e.severity === 'error'
                    ? 'led led-off'
                    : 'led led-warn'
                } />
                <span className="flex-1 truncate">{e.title}</span>
                <span className="tag tag-dim text-[10px]">{e.source}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
