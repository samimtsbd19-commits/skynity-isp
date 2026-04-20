// ============================================================
// Router Monitor — the big per-router dashboard.
// ------------------------------------------------------------
// A single "PRTG-lite" page with every monitoring surface the
// backend exposes for one MikroTik router:
//
//   * Device info strip (model / RouterOS / license / serial)
//   * Latest + history for CPU / RAM / temperature / active users
//   * Interface table with SFP Rx/Tx power and per-port drilldown
//   * Ping targets — add/remove + latency/loss history per target
//   * Queue history — top-N queues by current rate, with trend
//   * Top bandwidth consumers in the last 24h (drill → per-user graph)
//   * LLDP/CDP neighbor table
//   * Open events for this router
//
// All data comes from /api/monitoring/* (already collected by the
// 5-min cron). This page is 100% read-only except for the ping
// target CRUD and the "poll now" button.
// ============================================================
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  LineChart, Line, AreaChart, Area, ResponsiveContainer,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import {
  Server, Cpu, MemoryStick, Thermometer, Activity, Signal,
  RefreshCw, Plus, Trash2, Gauge, Wifi,
  ChevronRight, Users, Radio, Network, ShieldAlert,
} from 'lucide-react';
import {
  apiMonitorRouters, apiMonitorRouter, apiMonitorHistory,
  apiMonitorIfaceHistory, apiMonitorQueueHistory,
  apiMonitorTopUsers, apiMonitorSubUsage,
  apiMonitorPingHistory, apiMonitorAddPingTarget, apiMonitorDelPingTarget,
  apiMonitorPollNow,
} from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, Skeleton } from '../components/primitives';

// -----------------------------------------------------------
// Formatting helpers
// -----------------------------------------------------------
function fmtBytes(b) {
  const n = Number(b || 0);
  if (!n) return '0 B';
  const k = 1024, sizes = ['B','KB','MB','GB','TB','PB'];
  const i = Math.floor(Math.log(n) / Math.log(k));
  return `${(n / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
function fmtBps(bps) {
  const n = Number(bps || 0);
  if (n < 1000) return `${n} bps`;
  if (n < 1_000_000) return `${(n/1000).toFixed(1)} Kbps`;
  if (n < 1_000_000_000) return `${(n/1_000_000).toFixed(2)} Mbps`;
  return `${(n/1_000_000_000).toFixed(2)} Gbps`;
}
function fmtSeconds(s) {
  const n = Number(s || 0);
  if (!n) return '—';
  const d = Math.floor(n / 86400);
  const h = Math.floor((n % 86400) / 3600);
  const m = Math.floor((n % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}
function pct(used, total) {
  if (!used || !total) return 0;
  return Math.min(100, Math.round((Number(used)/Number(total)) * 100));
}
function timeLabel(t) {
  try { return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

const TOOLTIP_STYLE = {
  background: '#131316', border: '1px solid #26262b',
  borderRadius: 2, fontSize: 12, fontFamily: 'JetBrains Mono',
};

// ============================================================
// Top-level page
// ============================================================
export default function RouterMonitor() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState(null);
  const [hours, setHours] = useState(24);

  const routers = useQuery({
    queryKey: ['rm-routers'],
    queryFn: apiMonitorRouters,
    refetchInterval: 30_000,
  });

  // v5 useQuery doesn't have onSuccess — pick the first router
  // via effect once the list loads.
  useEffect(() => {
    if (selected == null && routers.data?.length) {
      setSelected(routers.data[0].id);
    }
  }, [routers.data, selected]);

  const pollNow = useMutation({
    mutationFn: apiMonitorPollNow,
    onSettled: () => qc.invalidateQueries({
      // Match every query whose key starts with "rm-…"
      predicate: (q) => typeof q.queryKey?.[0] === 'string'
                    && q.queryKey[0].startsWith('rm-'),
    }),
  });

  const list = routers.data || [];
  const current = list.find((r) => r.id === selected) || list[0] || null;

  return (
    <div>
      <PageHeader
        kicker="MikroTik"
        title={<><Server size={18} className="inline mr-2 text-amber" /> Router monitor</>}
        subtitle="Live CPU/RAM, interfaces, SFP, queues, users and neighbors — per router."
        actions={
          <>
            <select
              className="input input-sm"
              value={selected ?? ''}
              onChange={(e) => setSelected(Number(e.target.value))}
            >
              {list.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name || r.host} · {r.host}
                </option>
              ))}
            </select>
            <select
              className="input input-sm"
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
            >
              <option value={1}>1h</option>
              <option value={6}>6h</option>
              <option value={24}>24h</option>
              <option value={72}>3d</option>
              <option value={168}>7d</option>
            </select>
            <button
              className="btn btn-ghost"
              disabled={pollNow.isPending}
              onClick={() => pollNow.mutate()}
              title="Force a monitoring poll right now"
            >
              <RefreshCw size={14} className={pollNow.isPending ? 'animate-spin' : ''} />
              Poll now
            </button>
          </>
        }
      />

      <div className="p-8 space-y-8">
        {routers.isLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : !current ? (
          <div className="panel p-12">
            <EmptyState
              icon={Server}
              title="No routers configured"
              hint="Add a MikroTik router from the Routers page to start collecting metrics."
            />
          </div>
        ) : (
          <RouterBody routerId={current.id} hours={hours} />
        )}
      </div>
    </div>
  );
}

// ============================================================
// Router body — loads /monitoring/routers/:id and renders
// sections for every data surface.
// ============================================================
function RouterBody({ routerId, hours }) {
  const detail = useQuery({
    queryKey: ['rm-detail', routerId],
    queryFn: () => apiMonitorRouter(routerId),
    refetchInterval: 30_000,
  });
  const history = useQuery({
    queryKey: ['rm-history', routerId, hours],
    queryFn: () => apiMonitorHistory(routerId, hours),
    refetchInterval: 60_000,
  });
  const pingHistory = useQuery({
    queryKey: ['rm-ping', routerId, hours],
    queryFn: () => apiMonitorPingHistory(routerId, hours),
    refetchInterval: 60_000,
  });

  if (detail.isLoading) return <Skeleton className="h-96 w-full" />;
  if (!detail.data) return null;

  const d = detail.data;
  const latest = d.latest || {};

  return (
    <>
      {d.guard?.active ? <GuardBanner guard={d.guard} /> : null}
      <DeviceInfoStrip router={d.router} device={d.device} latest={latest} />
      <ResourceHistory rows={history.data || []} latest={latest} />
      <InterfacesSection
        routerId={routerId}
        interfaces={d.interfaces || []}
        hours={hours}
      />
      <PingSection
        routerId={routerId}
        targets={d.pings || []}
        rows={pingHistory.data || []}
      />
      <QueueSection routerId={routerId} hours={hours} />
      <TopUsersSection routerId={routerId} hours={hours} />
      <NeighborsSection neighbors={d.neighbors || []} />
    </>
  );
}

// ============================================================
// CPU guard banner
// ------------------------------------------------------------
// Shown when the monitor has paused expensive polls (queues /
// SFP) to relieve an overloaded router. Lifts automatically
// when CPU recovers under the resume threshold.
// ============================================================
function GuardBanner({ guard }) {
  const since = guard.since ? new Date(guard.since) : null;
  return (
    <div className="panel p-4 mb-4 flex items-start gap-3"
         style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.4)' }}>
      <ShieldAlert size={22} className="text-red mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="tag tag-red">CPU GUARD ACTIVE</span>
          <span className="text-sm">{guard.reason || 'Expensive polls paused'}</span>
        </div>
        <div className="text-[11px] text-text-dim font-mono mt-1">
          Last CPU: <b>{guard.last_cpu}%</b>
          {since && ` · since ${since.toLocaleTimeString()}`}
          {' · queue & SFP monitors are paused until CPU recovers.'}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Section 1 — Device info + latest "vitals"
// ============================================================
function DeviceInfoStrip({ router, device, latest }) {
  return (
    <section>
      <div className="section-rule mb-4">
        <h2 className="text-display text-2xl italic">Device</h2>
      </div>
      <div className="panel p-6 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6">
        <Vital icon={Server}      label="Model"     value={device?.model || device?.board_name || '—'} />
        <Vital icon={Radio}       label="RouterOS"  value={device?.routeros_version || '—'} />
        <Vital icon={Network}     label="Firmware"  value={device?.firmware_current || '—'}
               hint={device?.firmware_upgrade && device.firmware_upgrade !== device.firmware_current
                 ? `upgrade: ${device.firmware_upgrade}` : null} />
        <Vital icon={Signal}      label="License"   value={device?.license_level || '—'} />
        <Vital icon={Activity}    label="Uptime"    value={fmtSeconds(latest?.uptime_sec)} />
        <Vital icon={Cpu}         label="Host"      value={router?.host || '—'}
               hint={device?.serial_number ? `SN ${device.serial_number}` : null} />
      </div>
    </section>
  );
}
function Vital({ icon: Icon, label, value, hint }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-mono text-[10px] text-text-mute uppercase tracking-wider mb-1.5">
        <Icon size={11} /> {label}
      </div>
      <div className="text-sm font-mono text-text">{value}</div>
      {hint && <div className="text-[10px] text-text-mute mt-0.5">{hint}</div>}
    </div>
  );
}

// ============================================================
// Section 2 — Resource history (CPU / RAM / temp / active users)
// ============================================================
function ResourceHistory({ rows, latest }) {
  const series = rows.map((r) => ({
    t: new Date(r.taken_at).getTime(),
    cpu: r.cpu_load,
    mem_pct: pct(r.mem_used, r.mem_total),
    temp: Number(r.temperature || 0),
    ppp: r.active_ppp,
    hs:  r.active_hs,
  }));
  return (
    <section>
      <div className="section-rule mb-4">
        <h2 className="text-display text-2xl italic">Resources</h2>
      </div>
      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        <ResourceStat icon={Cpu}         label="CPU"          value={latest?.cpu_load != null ? `${latest.cpu_load}%` : '—'} />
        <ResourceStat icon={MemoryStick} label="RAM"
          value={latest?.mem_used && latest?.mem_total
            ? `${pct(latest.mem_used, latest.mem_total)}%`
            : '—'}
          hint={latest?.mem_used && latest?.mem_total
            ? `${fmtBytes(latest.mem_used)} / ${fmtBytes(latest.mem_total)}`
            : null} />
        <ResourceStat icon={Thermometer} label="Temp"         value={latest?.temperature ? `${latest.temperature} °C` : '—'} />
        <ResourceStat icon={Users}       label="Online users"
          value={`${(latest?.active_ppp || 0) + (latest?.active_hs || 0)}`}
          hint={`PPP ${latest?.active_ppp || 0} · HS ${latest?.active_hs || 0}`} />
      </div>
      {series.length < 2 ? (
        <div className="panel p-6 text-sm text-text-mute font-mono">Not enough history yet — give the poller a few minutes.</div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          <MiniChart title="CPU %"  series={series} dataKey="cpu"     color="#f59e0b" suffix="%" />
          <MiniChart title="RAM %"  series={series} dataKey="mem_pct" color="#06b6d4" suffix="%" />
          <MiniChart title="Temperature (°C)" series={series} dataKey="temp" color="#ef4444" suffix="°C" />
          <MiniChart title="Active users"     series={series} dataKey="ppp"  color="#10b981" secondary={{ dataKey: 'hs', color: '#a78bfa' }} />
        </div>
      )}
    </section>
  );
}
function ResourceStat({ icon: Icon, label, value, hint }) {
  return (
    <div className="panel p-4">
      <div className="flex items-center gap-1.5 text-mono text-[10px] text-text-mute uppercase tracking-wider mb-1.5">
        <Icon size={11} /> {label}
      </div>
      <div className="text-display text-2xl">{value}</div>
      {hint && <div className="text-[10px] text-text-mute mt-1 font-mono">{hint}</div>}
    </div>
  );
}
function MiniChart({ title, series, dataKey, color, suffix = '', secondary }) {
  return (
    <div className="panel p-4">
      <div className="text-mono text-[10px] text-text-mute uppercase tracking-wider mb-2">{title}</div>
      <div className="h-40 -mx-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`g-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="2 4" stroke="#26262b" vertical={false} />
            <XAxis dataKey="t" tickFormatter={timeLabel} tick={{ fill: '#8c8a85', fontSize: 10 }} />
            <YAxis tick={{ fill: '#8c8a85', fontSize: 10 }} width={36} />
            <Tooltip
              labelFormatter={(ts) => new Date(ts).toLocaleString()}
              formatter={(v) => `${v}${suffix}`}
              contentStyle={TOOLTIP_STYLE}
            />
            <Area type="monotone" dataKey={dataKey} stroke={color} fill={`url(#g-${dataKey})`} strokeWidth={1.5} isAnimationActive={false} />
            {secondary && (
              <Area type="monotone" dataKey={secondary.dataKey} stroke={secondary.color} fill="transparent" strokeWidth={1.5} isAnimationActive={false} />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ============================================================
// Section 3 — Interfaces + SFP drilldown
// ============================================================
function InterfacesSection({ routerId, interfaces, hours }) {
  const [drilldown, setDrilldown] = useState(null);
  return (
    <section>
      <div className="section-rule mb-4 flex items-center justify-between">
        <h2 className="text-display text-2xl italic">Interfaces</h2>
        {drilldown && (
          <button className="btn btn-ghost" onClick={() => setDrilldown(null)}>
            ← Back to list
          </button>
        )}
      </div>
      {drilldown ? (
        <IfaceDetail routerId={routerId} iface={drilldown} hours={hours} />
      ) : !interfaces.length ? (
        <div className="panel p-6"><EmptyState icon={Network} title="No interface data yet" hint="Waiting for the next poll…" /></div>
      ) : (
        <div className="panel overflow-hidden">
          <div className="grid grid-cols-12 px-5 py-3 border-b border-border-dim text-mono text-[10px] text-text-mute uppercase tracking-wider">
            <div className="col-span-3">Interface</div>
            <div className="col-span-2">Link</div>
            <div className="col-span-2 text-right">Rx / Tx</div>
            <div className="col-span-3">SFP</div>
            <div className="col-span-2 text-right">Action</div>
          </div>
          <ul>
            {interfaces.map((i) => (
              <li key={i.id} className="grid grid-cols-12 px-5 py-3 items-center ticker-row">
                <div className="col-span-3 font-mono text-sm">{i.interface_name}</div>
                <div className="col-span-2">
                  <span className={`led ${i.link_ok ? 'led-on' : 'led-off'}`} />
                  <span className="ml-2 text-xs font-mono text-text-dim">
                    {i.link_ok ? 'up' : 'down'}
                  </span>
                </div>
                <div className="col-span-2 text-right font-mono text-xs text-text-dim">
                  ↓ {fmtBps(i.rx_bps)}<br />
                  ↑ {fmtBps(i.tx_bps)}
                </div>
                <div className="col-span-3 font-mono text-[11px] text-text-mute">
                  {i.sfp_rx_power != null
                    ? <>Rx {i.sfp_rx_power} dBm · Tx {i.sfp_tx_power} dBm · {i.sfp_temp} °C</>
                    : '—'}
                </div>
                <div className="col-span-2 text-right">
                  <button className="btn btn-ghost btn-sm" onClick={() => setDrilldown(i.interface_name)}>
                    History <ChevronRight size={12} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
function IfaceDetail({ routerId, iface, hours }) {
  const q = useQuery({
    queryKey: ['rm-iface', routerId, iface, hours],
    queryFn: () => apiMonitorIfaceHistory(routerId, iface, hours),
    refetchInterval: 60_000,
  });
  const rows = q.data?.rows || [];
  const series = rows.map((r) => ({
    t: new Date(r.taken_at).getTime(),
    rx: Number(r.rx_bps || 0) / 1e6,
    tx: Number(r.tx_bps || 0) / 1e6,
    sfpRx: r.sfp_rx_power != null ? Number(r.sfp_rx_power) : null,
    sfpTx: r.sfp_tx_power != null ? Number(r.sfp_tx_power) : null,
    temp:  r.sfp_temp     != null ? Number(r.sfp_temp)     : null,
  }));
  const hasSfp = series.some((s) => s.sfpRx != null || s.sfpTx != null);
  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="panel p-4">
        <div className="text-mono text-[10px] text-text-mute uppercase tracking-wider mb-2">
          {iface} · Bandwidth (Mbps)
        </div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="2 4" stroke="#26262b" vertical={false} />
              <XAxis dataKey="t" tickFormatter={timeLabel} tick={{ fill: '#8c8a85', fontSize: 10 }} />
              <YAxis tick={{ fill: '#8c8a85', fontSize: 10 }} width={44} />
              <Tooltip labelFormatter={(ts) => new Date(ts).toLocaleString()}
                formatter={(v) => `${Number(v).toFixed(2)} Mbps`} contentStyle={TOOLTIP_STYLE} />
              <Line type="monotone" dataKey="rx" stroke="#06b6d4" strokeWidth={1.5} dot={false} name="Rx" isAnimationActive={false} />
              <Line type="monotone" dataKey="tx" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="Tx" isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      {hasSfp && (
        <div className="panel p-4">
          <div className="text-mono text-[10px] text-text-mute uppercase tracking-wider mb-2">
            {iface} · SFP optics (dBm / °C)
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="2 4" stroke="#26262b" vertical={false} />
                <XAxis dataKey="t" tickFormatter={timeLabel} tick={{ fill: '#8c8a85', fontSize: 10 }} />
                <YAxis tick={{ fill: '#8c8a85', fontSize: 10 }} width={44} />
                <Tooltip labelFormatter={(ts) => new Date(ts).toLocaleString()} contentStyle={TOOLTIP_STYLE} />
                <Line type="monotone" dataKey="sfpRx" stroke="#06b6d4" strokeWidth={1.5} dot={false} name="Rx dBm" isAnimationActive={false} />
                <Line type="monotone" dataKey="sfpTx" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="Tx dBm" isAnimationActive={false} />
                <Line type="monotone" dataKey="temp"  stroke="#ef4444" strokeWidth={1.5} dot={false} name="°C"    isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Section 4 — Ping targets
// ============================================================
function PingSection({ routerId, targets, rows }) {
  const qc = useQueryClient();
  const [host, setHost] = useState('');
  const [label, setLabel] = useState('');
  const addM = useMutation({
    mutationFn: () => apiMonitorAddPingTarget(routerId, { host, label }),
    onSuccess: () => {
      setHost(''); setLabel('');
      qc.invalidateQueries({ queryKey: ['rm-detail', routerId] });
    },
  });
  const delM = useMutation({
    mutationFn: (id) => apiMonitorDelPingTarget(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rm-detail', routerId] }),
  });

  const byTarget = {};
  for (const r of rows || []) {
    const k = r.host;
    if (!byTarget[k]) byTarget[k] = [];
    byTarget[k].push({
      t: new Date(r.taken_at).getTime(),
      rtt: r.rtt_avg_ms != null ? Number(r.rtt_avg_ms) : null,
      loss: r.packet_loss != null ? Number(r.packet_loss) : 0,
    });
  }

  return (
    <section>
      <div className="section-rule mb-4">
        <h2 className="text-display text-2xl italic">Ping &amp; latency</h2>
      </div>
      <div className="panel p-4 mb-4">
        <form
          onSubmit={(e) => { e.preventDefault(); if (host) addM.mutate(); }}
          className="flex gap-2 items-end flex-wrap"
        >
          <div>
            <label className="block text-[10px] text-text-mute font-mono uppercase mb-1">Host / IP</label>
            <input className="input input-sm" value={host} onChange={(e) => setHost(e.target.value)} placeholder="8.8.8.8 / google.com" />
          </div>
          <div>
            <label className="block text-[10px] text-text-mute font-mono uppercase mb-1">Label (optional)</label>
            <input className="input input-sm" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Google DNS" />
          </div>
          <button type="submit" className="btn btn-primary btn-sm" disabled={!host || addM.isPending}>
            <Plus size={14} /> Add target
          </button>
        </form>
      </div>

      {!targets.length ? (
        <div className="panel p-6"><EmptyState icon={Gauge} title="No ping targets yet" hint="Add a host above; the router will ping it every monitoring tick." /></div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {targets.map(({ target, latest }) => (
            <div key={target.id} className="panel p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="font-mono text-sm">{target.label || target.host}</div>
                  <div className="text-[11px] text-text-mute font-mono">{target.host}</div>
                </div>
                <button
                  className="btn btn-ghost btn-sm text-red"
                  onClick={() => delM.mutate(target.id)}
                  title="Remove target"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="flex gap-4 text-[11px] font-mono mb-3">
                <span>RTT <span className="text-text">{latest?.rtt_avg_ms != null ? `${Number(latest.rtt_avg_ms).toFixed(1)} ms` : '—'}</span></span>
                <span>Loss <span className={`${latest?.packet_loss > 10 ? 'text-red' : 'text-text'}`}>{latest?.packet_loss != null ? `${latest.packet_loss}%` : '—'}</span></span>
              </div>
              <div className="h-32 -mx-2">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={byTarget[target.host] || []}>
                    <CartesianGrid strokeDasharray="2 4" stroke="#26262b" vertical={false} />
                    <XAxis dataKey="t" tickFormatter={timeLabel} tick={{ fill: '#8c8a85', fontSize: 10 }} />
                    <YAxis tick={{ fill: '#8c8a85', fontSize: 10 }} width={36} />
                    <Tooltip labelFormatter={(ts) => new Date(ts).toLocaleString()} contentStyle={TOOLTIP_STYLE} />
                    <Line type="monotone" dataKey="rtt"  stroke="#06b6d4" strokeWidth={1.5} dot={false} name="RTT ms" isAnimationActive={false} />
                    <Line type="monotone" dataKey="loss" stroke="#ef4444" strokeWidth={1.5} dot={false} name="Loss %" isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ============================================================
// Section 5 — Queue history (top queues by current traffic)
// ============================================================
function QueueSection({ routerId, hours }) {
  const [drill, setDrill] = useState(null);
  const q = useQuery({
    queryKey: ['rm-queues', routerId],
    queryFn: () => apiMonitorQueueHistory(routerId, { hours: 1 }),
    refetchInterval: 60_000,
  });
  const queues = q.data?.queues || [];
  return (
    <section>
      <div className="section-rule mb-4 flex items-center justify-between">
        <h2 className="text-display text-2xl italic">Queues</h2>
        {drill && <button className="btn btn-ghost" onClick={() => setDrill(null)}>← Back</button>}
      </div>
      {drill ? (
        <QueueDrill routerId={routerId} name={drill} hours={hours} />
      ) : !queues.length ? (
        <div className="panel p-6"><EmptyState icon={Gauge} title="No queue data" hint="Enable queue polling in Settings → monitoring, or add simple queues on the router." /></div>
      ) : (
        <div className="panel overflow-hidden">
          <div className="grid grid-cols-12 px-5 py-3 border-b border-border-dim text-mono text-[10px] text-text-mute uppercase tracking-wider">
            <div className="col-span-3">Queue</div>
            <div className="col-span-2">Kind</div>
            <div className="col-span-3">Target / Parent</div>
            <div className="col-span-2 text-right">Rate</div>
            <div className="col-span-2 text-right">Action</div>
          </div>
          <ul>
            {queues.map((x) => (
              <li key={x.id} className="grid grid-cols-12 px-5 py-3 items-center ticker-row">
                <div className="col-span-3 font-mono text-sm truncate">{x.queue_name}</div>
                <div className="col-span-2 font-mono text-[11px] text-text-mute uppercase">{x.kind}</div>
                <div className="col-span-3 font-mono text-[11px] text-text-dim truncate">
                  {x.target || x.parent || '—'}
                </div>
                <div className="col-span-2 text-right font-mono text-xs text-text-dim">
                  ↓ {fmtBps(x.rx_bps)}<br />
                  ↑ {fmtBps(x.tx_bps)}
                </div>
                <div className="col-span-2 text-right">
                  <button className="btn btn-ghost btn-sm" onClick={() => setDrill(x.queue_name)}>
                    History <ChevronRight size={12} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
function QueueDrill({ routerId, name, hours }) {
  const q = useQuery({
    queryKey: ['rm-queue', routerId, name, hours],
    queryFn: () => apiMonitorQueueHistory(routerId, { queue: name, hours }),
  });
  const series = (q.data?.rows || []).map((r) => ({
    t: new Date(r.taken_at).getTime(),
    rx: Number(r.rx_bps || 0) / 1e6,
    tx: Number(r.tx_bps || 0) / 1e6,
  }));
  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="panel p-4">
      <div className="text-mono text-[10px] text-text-mute uppercase tracking-wider mb-2">
        {name} · Mbps
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series}>
            <CartesianGrid strokeDasharray="2 4" stroke="#26262b" vertical={false} />
            <XAxis dataKey="t" tickFormatter={timeLabel} tick={{ fill: '#8c8a85', fontSize: 10 }} />
            <YAxis tick={{ fill: '#8c8a85', fontSize: 10 }} width={44} />
            <Tooltip labelFormatter={(ts) => new Date(ts).toLocaleString()}
              formatter={(v) => `${Number(v).toFixed(2)} Mbps`} contentStyle={TOOLTIP_STYLE} />
            <Line type="monotone" dataKey="rx" stroke="#06b6d4" strokeWidth={1.5} dot={false} name="Rx" isAnimationActive={false} />
            <Line type="monotone" dataKey="tx" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="Tx" isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ============================================================
// Section 6 — Top bandwidth users (per router)
// ============================================================
function TopUsersSection({ routerId, hours }) {
  const [sub, setSub] = useState(null);
  const q = useQuery({
    queryKey: ['rm-topusers', routerId, hours],
    queryFn: () => apiMonitorTopUsers(routerId, { hours, limit: 10 }),
    refetchInterval: 60_000,
  });
  const rows = q.data || [];
  return (
    <section>
      <div className="section-rule mb-4 flex items-center justify-between">
        <h2 className="text-display text-2xl italic">Top users · last {hours}h</h2>
        {sub && <button className="btn btn-ghost" onClick={() => setSub(null)}>← Back</button>}
      </div>
      {sub ? (
        <UserUsageDrill sub={sub} hours={hours} onBack={() => setSub(null)} />
      ) : !rows.length ? (
        <div className="panel p-6"><EmptyState icon={Users} title="No user usage yet" hint="Data appears after the 10-min session poller has run." /></div>
      ) : (
        <div className="panel overflow-hidden">
          <div className="grid grid-cols-12 px-5 py-3 border-b border-border-dim text-mono text-[10px] text-text-mute uppercase tracking-wider">
            <div className="col-span-3">User</div>
            <div className="col-span-3">Package</div>
            <div className="col-span-2 text-right">Download</div>
            <div className="col-span-2 text-right">Upload</div>
            <div className="col-span-2 text-right">Action</div>
          </div>
          <ul>
            {rows.map((u) => (
              <li key={u.subscription_id} className="grid grid-cols-12 px-5 py-3 items-center ticker-row">
                <div className="col-span-3">
                  <div className="font-mono text-sm">{u.login_username}</div>
                  <div className="text-[11px] text-text-mute">{u.full_name}</div>
                </div>
                <div className="col-span-3 font-mono text-xs text-text-dim">{u.package_name}</div>
                <div className="col-span-2 text-right font-mono text-xs">{fmtBytes(u.bytes_in)}</div>
                <div className="col-span-2 text-right font-mono text-xs">{fmtBytes(u.bytes_out)}</div>
                <div className="col-span-2 text-right">
                  <button className="btn btn-ghost btn-sm" onClick={() => setSub(u)}>
                    Graph <ChevronRight size={12} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
function UserUsageDrill({ sub, hours }) {
  const q = useQuery({
    queryKey: ['rm-sub-usage', sub.subscription_id, hours],
    queryFn: () => apiMonitorSubUsage(sub.subscription_id, hours),
  });
  const rows = q.data?.rows || [];
  const bucket = q.data?.bucket || 'hour';
  const series = rows.map((r) => ({
    t: bucket === 'hour'
      ? new Date(r.bucket).getTime()
      : new Date(`${r.bucket}T00:00:00`).getTime(),
    inMb:  Number(r.bytes_in  || 0) / 1e6,
    outMb: Number(r.bytes_out || 0) / 1e6,
  }));
  return (
    <div className="panel p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="font-mono text-sm">{sub.login_username} · {sub.full_name}</div>
          <div className="text-[11px] text-text-mute">{sub.package_name}</div>
        </div>
      </div>
      {!series.length ? (
        <EmptyState icon={Activity} title="No usage yet" hint="Graph appears after the first session snapshot." />
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series}>
              <defs>
                <linearGradient id="g-in" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#06b6d4" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="g-out" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#f59e0b" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 4" stroke="#26262b" vertical={false} />
              <XAxis dataKey="t" tickFormatter={bucket === 'hour' ? timeLabel : (v) => new Date(v).toLocaleDateString()} tick={{ fill: '#8c8a85', fontSize: 10 }} />
              <YAxis tick={{ fill: '#8c8a85', fontSize: 10 }} width={44} label={{ value: 'MB', angle: -90, position: 'insideLeft', fill: '#52504c', fontSize: 10 }} />
              <Tooltip
                labelFormatter={(ts) => new Date(ts).toLocaleString()}
                formatter={(v) => `${Number(v).toFixed(1)} MB`}
                contentStyle={TOOLTIP_STYLE}
              />
              <Area type="monotone" dataKey="inMb"  stroke="#06b6d4" fill="url(#g-in)"  strokeWidth={1.5} name="Download" isAnimationActive={false} />
              <Area type="monotone" dataKey="outMb" stroke="#f59e0b" fill="url(#g-out)" strokeWidth={1.5} name="Upload"   isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Section 7 — Neighbors (LLDP / CDP / MNDP)
// ============================================================
function NeighborsSection({ neighbors }) {
  return (
    <section>
      <div className="section-rule mb-4">
        <h2 className="text-display text-2xl italic">Neighbors</h2>
      </div>
      {!neighbors.length ? (
        <div className="panel p-6"><EmptyState icon={Wifi} title="No neighbors discovered" hint="Enable LLDP/CDP on the relevant interfaces." /></div>
      ) : (
        <div className="panel overflow-hidden">
          <div className="grid grid-cols-12 px-5 py-3 border-b border-border-dim text-mono text-[10px] text-text-mute uppercase tracking-wider">
            <div className="col-span-3">Identity</div>
            <div className="col-span-2">Platform</div>
            <div className="col-span-2">Board / Version</div>
            <div className="col-span-2">MAC</div>
            <div className="col-span-2">IP</div>
            <div className="col-span-1">Iface</div>
          </div>
          <ul>
            {neighbors.map((n) => (
              <li key={n.id} className="grid grid-cols-12 px-5 py-3 items-center ticker-row">
                <div className="col-span-3 font-mono text-sm truncate">{n.identity || '—'}</div>
                <div className="col-span-2 font-mono text-[11px] text-text-mute">{n.platform || '—'}</div>
                <div className="col-span-2 font-mono text-[11px] text-text-dim truncate">
                  {n.board || '—'} {n.version ? ` · ${n.version}` : ''}
                </div>
                <div className="col-span-2 font-mono text-[11px] text-text-mute">{n.mac_address || '—'}</div>
                <div className="col-span-2 font-mono text-[11px] text-text-dim">{n.address || '—'}</div>
                <div className="col-span-1 font-mono text-[11px] text-text-mute">{n.interface_name || '—'}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
