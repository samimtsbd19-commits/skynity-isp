// ============================================================
// Bandwidth / Load-balance dashboard
// ------------------------------------------------------------
// The "am I oversold?" page. Shows, for the selected router:
//
//   * Uplink capacity             (admin-configured)
//   * Committed bandwidth          (sum of active package speeds)
//   * Oversubscription ratio       (committed ÷ capacity)
//   * Live uplink utilisation      (latest rx/tx vs capacity)
//   * Users online right now
//   * Fair-share per user          (idle-share math)
//   * 24h uplink traffic chart
//
// Uplink interface + capacity are configured per-router via the
// "Configure" panel at the top.
// ============================================================
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ResponsiveContainer, AreaChart, Area, Tooltip, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import {
  Gauge, Users, Zap, TrendingUp, Wifi, Settings as SettingsIcon,
  AlertTriangle, CheckCircle2, RefreshCw, X, Network,
} from 'lucide-react';
import {
  apiRouters, apiBandwidthOverview, apiBandwidthHistory,
  apiBandwidthRouterIfaces, apiBandwidthSaveUplink,
} from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { Skeleton, EmptyState } from '../components/primitives';
import { useT } from '../i18n';

const POLL_MS = 15_000;

export default function Bandwidth() {
  const t = useT();
  const [routerId, setRouterId] = useState(null);
  const [hours, setHours] = useState(24);
  const [showConfig, setShowConfig] = useState(false);

  const routers = useQuery({ queryKey: ['routers'], queryFn: apiRouters });
  useEffect(() => {
    if (!routerId && routers.data?.length) {
      setRouterId(routers.data.find((r) => r.is_default)?.id || routers.data[0].id);
    }
  }, [routers.data, routerId]);

  const overview = useQuery({
    queryKey: ['bw-overview', routerId],
    queryFn: () => apiBandwidthOverview(routerId),
    enabled: !!routerId,
    refetchInterval: POLL_MS,
  });
  const history = useQuery({
    queryKey: ['bw-history', routerId, hours],
    queryFn: () => apiBandwidthHistory(routerId, hours),
    enabled: !!routerId,
    refetchInterval: POLL_MS,
  });

  const router = routers.data?.find((r) => r.id === routerId);
  const ov = overview.data;
  const notConfigured =
    ov?.ok && (!ov.capacity?.interface || !ov.capacity?.down_mbps);

  return (
    <div>
      <PageHeader
        kicker="Network"
        title={<><Gauge size={18} className="inline mr-2 text-amber" /> {t('nav.bandwidth') || 'Bandwidth'}</>}
        subtitle="Capacity vs sold vs actual load. Answers “am I oversold right now?”"
        actions={
          <>
            <select
              value={routerId || ''}
              onChange={(e) => setRouterId(Number(e.target.value))}
              className="input input-sm"
            >
              {(routers.data || []).map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <button className="btn btn-ghost" onClick={() => setShowConfig(true)}>
              <SettingsIcon size={14} /> Configure uplink
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => { overview.refetch(); history.refetch(); }}
              title="Refresh now"
            >
              <RefreshCw size={14} />
            </button>
          </>
        }
      />
      <div className="p-8 space-y-6">
        {overview.isLoading ? (
          <Skeleton className="h-64" />
        ) : !ov?.ok ? (
          <div className="panel p-12">
            <EmptyState icon={AlertTriangle} title="No router available" hint={ov?.error} />
          </div>
        ) : (
          <>
            {notConfigured && (
              <div className="panel p-4 flex items-start gap-3"
                   style={{ background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.4)' }}>
                <AlertTriangle size={20} className="text-amber mt-0.5" />
                <div className="flex-1">
                  <div className="text-sm">Uplink not configured for this router.</div>
                  <div className="text-[11px] text-text-mute font-mono mt-1">
                    Click “Configure uplink” to pick your WAN interface and tell Skynity how many Mbps Starlink/fiber actually delivers.
                  </div>
                </div>
                <button className="btn btn-primary btn-sm" onClick={() => setShowConfig(true)}>
                  Configure
                </button>
              </div>
            )}

            <HeadlineCards ov={ov} />
            <LoadGauges ov={ov} />
            <UtilisationChart rows={history.data || []} capacityMbps={ov.capacity?.down_mbps} />
          </>
        )}
      </div>

      {showConfig && router && (
        <UplinkConfigModal
          router={router}
          onClose={() => { setShowConfig(false); overview.refetch(); }}
        />
      )}
    </div>
  );
}

// ============================================================
// Top strip — six big numbers.
// ============================================================
function HeadlineCards({ ov }) {
  const capDown = ov.capacity?.down_mbps || 0;
  const subsCount = ov.committed?.subs || 0;
  const commitDown = ov.committed?.down_mbps || 0;
  const activeNow = ov.active_now || 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      <Metric
        icon={Wifi}
        label="Uplink capacity"
        value={capDown ? `${capDown}` : '—'}
        unit="Mbps"
        hint={ov.capacity?.interface ? `iface ${ov.capacity.interface}` : 'not configured'}
      />
      <Metric
        icon={TrendingUp}
        label="Committed (sold)"
        value={commitDown ? `${commitDown}` : '—'}
        unit="Mbps"
        hint={`${subsCount} active subs`}
      />
      <Metric
        icon={Gauge}
        label="Oversub ratio"
        value={`${ov.oversubscription?.down_ratio ?? 0}x`}
        hint={
          ov.oversubscription?.badge === 'critical' ? 'CRITICAL' :
          ov.oversubscription?.badge === 'warning'  ? 'warning' : 'healthy'
        }
        hintClass={
          ov.oversubscription?.badge === 'critical' ? 'text-red' :
          ov.oversubscription?.badge === 'warning'  ? 'text-amber' : 'text-green'
        }
      />
      <Metric
        icon={Zap}
        label="Live traffic"
        value={`${ov.live?.down_mbps ?? 0}`}
        unit="Mbps ↓"
        hint={`${ov.live?.up_mbps ?? 0} Mbps ↑`}
      />
      <Metric
        icon={Users}
        label="Online now"
        value={`${activeNow}`}
        unit="users"
        hint={`${subsCount ? Math.round((activeNow / subsCount) * 100) : 0}% of paying subs`}
      />
      <Metric
        icon={CheckCircle2}
        label="Fair share / user"
        value={`${ov.fair_share?.per_user_down_mbps ?? 0}`}
        unit="Mbps"
        hint={activeNow ? `C ÷ online users` : 'no one online'}
      />
    </div>
  );
}

function Metric({ icon: Icon, label, value, unit, hint, hintClass }) {
  return (
    <div className="panel p-4">
      <div className="flex items-center gap-1.5 text-mono text-[10px] text-text-mute uppercase tracking-wider">
        <Icon size={11} /> {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <div className="text-display text-3xl">{value}</div>
        {unit && <div className="text-xs font-mono text-text-mute">{unit}</div>}
      </div>
      {hint && <div className={`text-[10px] mt-0.5 font-mono ${hintClass || 'text-text-dim'}`}>{hint}</div>}
    </div>
  );
}

// ============================================================
// Two horizontal bars — utilisation and oversubscription.
// ============================================================
function LoadGauges({ ov }) {
  const utilDown = Math.min(100, Math.max(0, ov.utilisation?.down_pct || 0));
  const overRatio = ov.oversubscription?.down_ratio || 0;
  const warnRatio = ov.oversubscription?.warn_ratio || 2.5;
  const critRatio = ov.oversubscription?.crit_ratio || 4.0;
  const overPct = Math.min(100, (overRatio / (critRatio || 1)) * 100);

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="panel p-5">
        <div className="flex items-center justify-between">
          <div className="text-mono text-[10px] text-text-mute uppercase tracking-wider">Live uplink utilisation (download)</div>
          <div className="text-sm font-mono">
            <b>{ov.live?.down_mbps ?? 0}</b> / {ov.capacity?.down_mbps || '—'} Mbps
          </div>
        </div>
        <div className="mt-3 h-4 rounded-full bg-surface2 overflow-hidden relative">
          <div
            className="absolute inset-y-0 left-0"
            style={{
              width: `${utilDown}%`,
              background: utilDown > 90 ? '#ef4444' : utilDown > 70 ? '#f59e0b' : '#10b981',
              transition: 'width 400ms ease',
            }}
          />
        </div>
        <div className="mt-2 text-[11px] text-text-dim font-mono">
          {utilDown.toFixed(1)}% of your uplink is in use right now.
        </div>
      </div>

      <div className="panel p-5">
        <div className="flex items-center justify-between">
          <div className="text-mono text-[10px] text-text-mute uppercase tracking-wider">Oversubscription ratio</div>
          <div className="text-sm font-mono">
            <b>{overRatio}x</b>
          </div>
        </div>
        <div className="mt-3 h-4 rounded-full bg-surface2 overflow-hidden relative">
          <div
            className="absolute inset-y-0 left-0"
            style={{
              width: `${overPct}%`,
              background:
                overRatio >= critRatio ? '#ef4444' :
                overRatio >= warnRatio ? '#f59e0b' : '#10b981',
              transition: 'width 400ms ease',
            }}
          />
          <div className="absolute inset-y-0" style={{ left: `${Math.min(100, (warnRatio / (critRatio || 1)) * 100)}%`, borderLeft: '1px dashed #f59e0b' }} title={`warn ${warnRatio}x`} />
          <div className="absolute inset-y-0" style={{ left: '100%', borderLeft: '1px dashed #ef4444' }} title={`crit ${critRatio}x`} />
        </div>
        <div className="mt-2 text-[11px] text-text-dim font-mono">
          1x = exactly sold what you have. {warnRatio}x = warning. {critRatio}x = overload risk.
          Most ISPs safely run 3–5x because users don’t all peak at once.
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 24h / 1h / 6h / 7d uplink traffic chart — live rx/tx.
// ============================================================
function UtilisationChart({ rows, capacityMbps }) {
  const data = rows.map((r) => ({
    t: new Date(r.taken_at).getTime(),
    label: new Date(r.taken_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    down: (Number(r.rx_bps) || 0) / 1_000_000,
    up:   (Number(r.tx_bps) || 0) / 1_000_000,
  }));

  return (
    <div className="panel p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-display text-lg italic">Uplink traffic — last 24h</div>
        <div className="text-[11px] text-text-mute font-mono">
          capacity {capacityMbps || '—'} Mbps (top line)
        </div>
      </div>
      {!data.length ? (
        <div className="h-48 flex items-center justify-center text-text-mute italic text-sm">
          Waiting for the first sample — make sure monitoring is enabled and the uplink interface is set.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={data}>
            <CartesianGrid stroke="var(--border-dim)" strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-mute)' }} />
            <YAxis
              tick={{ fontSize: 10, fill: 'var(--text-mute)' }}
              domain={capacityMbps ? [0, Math.max(capacityMbps, 1)] : ['auto', 'auto']}
              label={{ value: 'Mbps', angle: -90, position: 'insideLeft', fontSize: 10, fill: 'var(--text-mute)' }}
            />
            <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border-dim)', fontSize: 11 }} />
            <Area type="monotone" dataKey="down" name="Download (Mbps)" stroke="#60a5fa" fill="rgba(96,165,250,0.25)" />
            <Area type="monotone" dataKey="up"   name="Upload (Mbps)"   stroke="#10b981" fill="rgba(16,185,129,0.15)" />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ============================================================
// Modal — pick uplink interface + enter capacity in Mbps.
// ============================================================
function UplinkConfigModal({ router, onClose }) {
  const qc = useQueryClient();
  const ifaces = useQuery({
    queryKey: ['bw-ifaces', router.id],
    queryFn: () => apiBandwidthRouterIfaces(router.id),
  });
  const [iface, setIface] = useState(router.uplink_interface || '');
  const [down, setDown] = useState(router.uplink_down_mbps || 400);
  const [up, setUp] = useState(router.uplink_up_mbps || 400);

  const save = useMutation({
    mutationFn: () => apiBandwidthSaveUplink(router.id, {
      uplink_interface: iface || null,
      uplink_down_mbps: Number(down) || 0,
      uplink_up_mbps:   Number(up)   || 0,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['routers'] });
      qc.invalidateQueries({ queryKey: ['bw-overview'] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: 'rgba(0,0,0,0.7)' }}
         onClick={onClose}>
      <div className="panel p-6 max-w-md w-full space-y-4"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-display text-xl italic">Uplink capacity — {router.name}</h3>
          <button onClick={onClose} className="text-text-mute hover:text-amber"><X size={16} /></button>
        </div>

        <div>
          <label className="block text-[10px] text-text-mute font-mono uppercase mb-2">WAN / uplink interface</label>
          {ifaces.isLoading ? (
            <Skeleton className="h-9 w-full" />
          ) : ifaces.error ? (
            <div className="text-xs text-red font-mono">
              Could not list interfaces — router unreachable. Enter manually:
              <input
                className="input input-sm w-full mt-1 font-mono"
                value={iface}
                onChange={(e) => setIface(e.target.value)}
                placeholder="e.g. ether1"
              />
            </div>
          ) : (
            <select
              className="input input-sm w-full font-mono"
              value={iface}
              onChange={(e) => setIface(e.target.value)}
            >
              <option value="">— pick one —</option>
              {(ifaces.data || []).map((i) => (
                <option key={i.name} value={i.name}>
                  {i.name} ({i.type}{i.running ? ', up' : ', down'})
                </option>
              ))}
            </select>
          )}
          <div className="text-[10px] text-text-mute font-mono mt-1">
            Pick the interface that goes to your ISP (Starlink / fiber modem).
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] text-text-mute font-mono uppercase mb-2">Download (Mbps)</label>
            <input type="number" min="0" className="input input-sm w-full font-mono"
                   value={down} onChange={(e) => setDown(e.target.value)} />
          </div>
          <div>
            <label className="block text-[10px] text-text-mute font-mono uppercase mb-2">Upload (Mbps)</label>
            <input type="number" min="0" className="input input-sm w-full font-mono"
                   value={up} onChange={(e) => setUp(e.target.value)} />
          </div>
        </div>
        <div className="text-[11px] text-text-dim font-mono">
          <Network size={10} className="inline mr-1" />
          Starlink typical: 200–350 Mbps ↓ / 20–30 Mbps ↑. Fiber GPON: 300–600 Mbps ↓.
        </div>

        {save.isError && (
          <div className="text-xs text-red font-mono">{save.error?.response?.data?.error || save.error?.message}</div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-border-dim">
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button
            onClick={() => save.mutate()}
            className="btn btn-primary"
            disabled={save.isPending || !down}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
