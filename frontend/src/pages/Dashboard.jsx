import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Users, Wallet, Activity, Inbox, Clock, Signal, Wifi, AlertTriangle,
} from 'lucide-react';
import {
  AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { apiStats, apiOrders, apiMikrotikInfo, apiMikrotikActive } from '../api/client';
import { useSelectedRouter } from '../contexts/RouterContext';
import { StatCard, StatusPill, EmptyState } from '../components/primitives';
import { PageHeader } from '../components/PageHeader';
import { formatDistanceToNow } from 'date-fns';

// fake revenue trend for now; will be real historical once Phase 4 analytics is in
function useSampleTrend() {
  return Array.from({ length: 14 }, (_, i) => ({
    d: i,
    v: Math.round(1000 + Math.random() * 3000 + i * 120),
  }));
}

export default function Dashboard() {
  const { routerId } = useSelectedRouter();
  const { data: stats, isLoading } = useQuery({
    queryKey: ['stats', routerId],
    queryFn: () => apiStats(routerId),
    refetchInterval: 30_000,
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
  const { data: mtActive } = useQuery({
    queryKey: ['mt-active', routerId],
    queryFn: () => apiMikrotikActive(routerId),
    retry: false, refetchInterval: 15_000,
  });

  const trend = useSampleTrend();
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
                  Revenue · 14 days
                </div>
                <div className="text-display text-3xl mt-1 italic">
                  {currencyFmt(stats?.totalRevenue)}
                </div>
                <div className="text-text-mute text-xs mt-1">All-time verified</div>
              </div>
              <div className="text-right">
                <div className="text-mono text-[10px] text-text-mute uppercase tracking-wider">Customers</div>
                <div className="text-display text-2xl">{stats?.customers ?? '—'}</div>
              </div>
            </div>
            <div className="h-52 -mx-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor="#f59e0b" stopOpacity={0.4}/>
                      <stop offset="100%" stopColor="#f59e0b" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="2 4" stroke="#26262b" vertical={false} />
                  <XAxis dataKey="d" hide />
                  <YAxis hide />
                  <Tooltip
                    cursor={{ stroke: '#f59e0b', strokeOpacity: 0.2 }}
                    contentStyle={{
                      background: '#131316', border: '1px solid #26262b',
                      borderRadius: 2, fontSize: 12, fontFamily: 'JetBrains Mono',
                    }}
                    labelStyle={{ color: '#8c8a85' }}
                    formatter={(v) => [currencyFmt(v), 'Revenue']}
                  />
                  <Area
                    type="monotone" dataKey="v"
                    stroke="#f59e0b" strokeWidth={1.5}
                    fill="url(#revGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="pt-4 mt-4 border-t border-border-dim flex items-center justify-between text-xs text-text-mute font-mono">
              <span>14d ago</span>
              <span className="italic">— sample trend; live data in Phase 4 —</span>
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

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <dt className="text-text-mute uppercase tracking-wider">{label}</dt>
      <dd className="text-text">{value ?? '—'}</dd>
    </div>
  );
}
