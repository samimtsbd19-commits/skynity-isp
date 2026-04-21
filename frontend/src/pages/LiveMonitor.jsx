import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity, Cpu, MemoryStick, Thermometer, Wifi, Users, Gauge,
  Download, Upload, Clock, Radio, Server, Zap, Pause, Play,
  HardDrive, ArrowDownCircle, ArrowUpCircle, Router as RouterIcon,
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { apiLiveDashboard } from '../api/client';
import { useSelectedRouter } from '../contexts/RouterContext';

// ── Formatters ───────────────────────────────────────────────
function fmtBps(bps) {
  const n = Number(bps || 0);
  if (n < 1000) return `${n} bps`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)} Kbps`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(2)} Mbps`;
  return `${(n / 1_000_000_000).toFixed(2)} Gbps`;
}
function fmtBytes(b) {
  const n = Number(b || 0);
  if (!n) return '0 B';
  const k = 1024, sizes = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(n) / Math.log(k));
  return `${(n / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
function fmtMem(bytes) {
  return `${Math.round((bytes || 0) / 1024 / 1024)} MB`;
}

// ── Stat card (big metric) ───────────────────────────────────
function StatCard({ icon: Icon, label, value, sub, accent = 'amber', progress }) {
  const pct = Math.min(100, Math.max(0, Number(progress) || 0));
  return (
    <div className="panel p-5 relative overflow-hidden">
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="text-mono text-[10px] text-text-mute uppercase tracking-widest">{label}</div>
          <div className="text-4xl font-display italic mt-1 leading-none">{value}</div>
          {sub && <div className="text-xs text-text-mute mt-1.5 font-mono">{sub}</div>}
        </div>
        <div className={`p-2 rounded-sm bg-${accent}/10`}>
          <Icon size={18} className={`text-${accent}`} />
        </div>
      </div>
      {progress !== undefined && (
        <div className="mt-3 h-1 bg-surface2 rounded-full overflow-hidden">
          <div
            className={`h-full bg-${accent} transition-all duration-500`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ── Mini sparkline for interface rates ───────────────────────
function Spark({ values = [], color = '#f59e0b', height = 20 }) {
  if (!values.length) return null;
  const max = Math.max(...values, 1);
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1 || 1)) * 100;
    const y = height - (v / max) * height;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width="80" height={height} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="inline-block">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ═════════════════════════════════════════════════════════════
export default function LiveMonitor() {
  const { routerId } = useSelectedRouter();
  const [paused, setPaused] = useState(false);
  const [intervalMs, setIntervalMs] = useState(3000);

  // History for sparklines
  const historyRef = useRef({ interfaces: new Map(), totals: [] });

  const { data, isLoading, error, dataUpdatedAt } = useQuery({
    queryKey: ['live-dashboard', routerId],
    queryFn: () => apiLiveDashboard(routerId),
    refetchInterval: paused ? false : intervalMs,
    refetchIntervalInBackground: false,
  });

  // Update history for sparklines when new data arrives
  useEffect(() => {
    if (!data || !data.interfaces) return;
    // Per-interface history (last 30 samples)
    for (const i of data.interfaces) {
      const key = i.name;
      const hist = historyRef.current.interfaces.get(key) || { rx: [], tx: [] };
      hist.rx = [...hist.rx.slice(-29), i.rx_bps];
      hist.tx = [...hist.tx.slice(-29), i.tx_bps];
      historyRef.current.interfaces.set(key, hist);
    }
    // Total bandwidth history
    historyRef.current.totals = [
      ...historyRef.current.totals.slice(-29),
      { rx: data.totals?.total_rx_bps || 0, tx: data.totals?.total_tx_bps || 0 },
    ];
  }, [data]);

  const d = data || {};
  const res = d.resource || {};
  const tot = d.totals || {};
  const memPct = res.memory_total ? Math.round(((res.memory_total - res.memory_free) / res.memory_total) * 100) : 0;
  const totalsHistory = historyRef.current.totals;

  return (
    <div>
      <PageHeader
        kicker="Live"
        title={<>Real-Time <em>Monitor</em></>}
        subtitle="WinBox-style live dashboard — CPU, memory, bandwidth, interfaces, and active users fetched directly from MikroTik every few seconds."
        actions={
          <div className="flex items-center gap-2">
            <select
              value={intervalMs}
              onChange={(e) => setIntervalMs(Number(e.target.value))}
              className="input text-xs py-1.5"
            >
              <option value={2000}>2s refresh</option>
              <option value={3000}>3s refresh</option>
              <option value={5000}>5s refresh</option>
              <option value={10000}>10s refresh</option>
            </select>
            <button
              onClick={() => setPaused(!paused)}
              className={`btn ${paused ? 'btn-primary' : 'btn-ghost'} text-xs`}
            >
              {paused ? <><Play size={12} /> Resume</> : <><Pause size={12} /> Pause</>}
            </button>
            <div className="text-[10px] font-mono text-text-mute">
              {data ? (
                <span className="flex items-center gap-1.5">
                  <span className={`inline-block w-2 h-2 rounded-full ${paused ? 'bg-text-mute' : 'bg-green animate-pulse'}`} />
                  {paused ? 'PAUSED' : 'LIVE'}
                </span>
              ) : '—'}
            </div>
          </div>
        }
      />

      <div className="px-8 pb-8 space-y-6">
        {error && (
          <div className="panel p-4 border-red/30 bg-red/5 text-red text-xs font-mono">
            ✗ {error.message}
          </div>
        )}
        {!data?.ts && isLoading && (
          <div className="text-center text-text-mute font-mono text-sm py-12">
            <Activity size={20} className="inline animate-pulse mr-2" /> Connecting to MikroTik…
          </div>
        )}
        {data?.ok === false && (
          <div className="panel p-4 border-red/30 bg-red/5 text-red text-xs font-mono">
            ✗ {data.error}
          </div>
        )}

        {data?.ts && (
          <>
            {/* ── Top row: Big stat cards ─────────────────────── */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <StatCard
                icon={Cpu}
                label="CPU"
                value={`${res.cpu_load ?? 0}%`}
                sub={`${res.cpu_count || 1} core${res.cpu_count > 1 ? 's' : ''} · ${res.cpu_frequency || '-'}`}
                progress={res.cpu_load || 0}
                accent={res.cpu_load > 80 ? 'red' : res.cpu_load > 50 ? 'amber' : 'green'}
              />
              <StatCard
                icon={MemoryStick}
                label="Memory"
                value={`${memPct}%`}
                sub={`${fmtMem(res.memory_total - res.memory_free)} / ${fmtMem(res.memory_total)}`}
                progress={memPct}
                accent={memPct > 80 ? 'red' : 'amber'}
              />
              <StatCard
                icon={Download}
                label="Download"
                value={fmtBps(tot.total_rx_bps || 0).split(' ')[0]}
                sub={`${fmtBps(tot.total_rx_bps || 0).split(' ')[1]} · all interfaces`}
                accent="amber"
              />
              <StatCard
                icon={Upload}
                label="Upload"
                value={fmtBps(tot.total_tx_bps || 0).split(' ')[0]}
                sub={`${fmtBps(tot.total_tx_bps || 0).split(' ')[1]} · all interfaces`}
                accent="amber"
              />
              <StatCard
                icon={Users}
                label="Users Online"
                value={tot.users_online || 0}
                sub={`${tot.pppoe_online || 0} PPPoE · ${tot.hotspot_online || 0} Hotspot`}
                accent="green"
              />
            </div>

            {/* ── Second row: Device info + combined bandwidth sparkline ── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="panel p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Server size={14} className="text-amber" />
                  <span className="text-mono text-[10px] uppercase tracking-widest text-text-mute">Device</span>
                </div>
                <div className="space-y-1.5 text-xs font-mono">
                  <Row label="Board" value={res.board_name || '—'} />
                  <Row label="RouterOS" value={res.version || '—'} />
                  <Row label="Arch" value={res.architecture || '—'} />
                  <Row label="Uptime" value={res.uptime || '—'} accent />
                  {res.temperature != null && <Row label="Temp" value={`${res.temperature}°C`} accent={res.temperature > 70 ? 'red' : 'amber'} />}
                  {res.hdd_total > 0 && <Row label="Storage" value={`${fmtBytes(res.hdd_total - res.hdd_free)} / ${fmtBytes(res.hdd_total)}`} />}
                </div>
              </div>

              <div className="panel p-5 lg:col-span-2">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Activity size={14} className="text-amber" />
                    <span className="text-mono text-[10px] uppercase tracking-widest text-text-mute">Live Bandwidth</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs font-mono">
                    <span className="flex items-center gap-1"><ArrowDownCircle size={11} className="text-green" /> {fmtBps(tot.total_rx_bps || 0)}</span>
                    <span className="flex items-center gap-1"><ArrowUpCircle size={11} className="text-amber" /> {fmtBps(tot.total_tx_bps || 0)}</span>
                  </div>
                </div>
                <BandwidthGraph history={totalsHistory} />
              </div>
            </div>

            {/* ── Interfaces table ────────────────────────────── */}
            <div className="panel overflow-hidden">
              <div className="px-5 py-3 border-b border-border-dim flex items-center gap-2 bg-surface2">
                <Wifi size={13} className="text-amber" />
                <span className="text-mono text-[10px] uppercase tracking-widest text-text-mute">Interfaces</span>
                <span className="ml-auto text-[10px] font-mono text-text-mute">{d.interfaces?.length || 0} total</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-surface2 text-text-mute">
                    <tr>
                      <th className="text-left px-4 py-2 font-mono text-[10px] uppercase tracking-wider">Interface</th>
                      <th className="text-left px-3 py-2 font-mono text-[10px] uppercase tracking-wider">Status</th>
                      <th className="text-right px-3 py-2 font-mono text-[10px] uppercase tracking-wider"><ArrowDownCircle size={10} className="inline mr-1" />RX (live)</th>
                      <th className="text-right px-3 py-2 font-mono text-[10px] uppercase tracking-wider"><ArrowUpCircle size={10} className="inline mr-1" />TX (live)</th>
                      <th className="text-right px-3 py-2 font-mono text-[10px] uppercase tracking-wider">Total RX</th>
                      <th className="text-right px-3 py-2 font-mono text-[10px] uppercase tracking-wider">Total TX</th>
                      <th className="text-left px-3 py-2 font-mono text-[10px] uppercase tracking-wider">History</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-dim">
                    {d.interfaces?.map((i) => {
                      const hist = historyRef.current.interfaces.get(i.name);
                      return (
                        <tr key={i.name} className={!i.running ? 'opacity-40' : 'hover:bg-surface2/50'}>
                          <td className="px-4 py-2 font-mono">{i.name}</td>
                          <td className="px-3 py-2">
                            {i.running
                              ? <span className="inline-flex items-center gap-1 text-green"><span className="w-1.5 h-1.5 rounded-full bg-green" />up</span>
                              : <span className="inline-flex items-center gap-1 text-text-mute"><span className="w-1.5 h-1.5 rounded-full bg-text-mute" />down</span>}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-green">{i.rx_bps ? fmtBps(i.rx_bps) : '—'}</td>
                          <td className="px-3 py-2 text-right font-mono text-amber">{i.tx_bps ? fmtBps(i.tx_bps) : '—'}</td>
                          <td className="px-3 py-2 text-right font-mono text-text-dim">{fmtBytes(i.rx_byte)}</td>
                          <td className="px-3 py-2 text-right font-mono text-text-dim">{fmtBytes(i.tx_byte)}</td>
                          <td className="px-3 py-2">
                            {hist && <Spark values={hist.rx} color="#10b981" />}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── Active users ─────────────────────────────────── */}
            <div className="panel overflow-hidden">
              <div className="px-5 py-3 border-b border-border-dim flex items-center gap-2 bg-surface2">
                <Users size={13} className="text-amber" />
                <span className="text-mono text-[10px] uppercase tracking-widest text-text-mute">Active Users</span>
                <span className="ml-auto text-[10px] font-mono text-text-mute">
                  {tot.users_online || 0} online · {tot.total_pppoe_users + tot.total_hotspot_users} total registered
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-surface2 text-text-mute">
                    <tr>
                      <th className="text-left px-4 py-2 font-mono text-[10px] uppercase tracking-wider">Type</th>
                      <th className="text-left px-3 py-2 font-mono text-[10px] uppercase tracking-wider">User</th>
                      <th className="text-left px-3 py-2 font-mono text-[10px] uppercase tracking-wider">IP Address</th>
                      <th className="text-left px-3 py-2 font-mono text-[10px] uppercase tracking-wider">MAC</th>
                      <th className="text-left px-3 py-2 font-mono text-[10px] uppercase tracking-wider">Uptime</th>
                      <th className="text-right px-3 py-2 font-mono text-[10px] uppercase tracking-wider">RX Rate</th>
                      <th className="text-right px-3 py-2 font-mono text-[10px] uppercase tracking-wider">TX Rate</th>
                      <th className="text-right px-3 py-2 font-mono text-[10px] uppercase tracking-wider">Session</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-dim">
                    {(!d.active_users || d.active_users.length === 0) && (
                      <tr>
                        <td colSpan={8} className="text-center py-8 text-text-mute font-mono">
                          No users online right now
                        </td>
                      </tr>
                    )}
                    {d.active_users?.map((u) => (
                      <tr key={`${u.type}-${u.id}`} className="hover:bg-surface2/50">
                        <td className="px-4 py-2">
                          <span className={`tag ${u.type === 'pppoe' ? 'tag-dim' : 'tag'} text-[9px]`}>{u.type}</span>
                        </td>
                        <td className="px-3 py-2 font-mono font-semibold">{u.name}</td>
                        <td className="px-3 py-2 font-mono text-text-dim">{u.address || '—'}</td>
                        <td className="px-3 py-2 font-mono text-[10px] text-text-mute">{u.mac_address || '—'}</td>
                        <td className="px-3 py-2 font-mono text-text-dim">{u.uptime || '—'}</td>
                        <td className="px-3 py-2 text-right font-mono text-green">{u.rx_bps ? fmtBps(u.rx_bps) : '—'}</td>
                        <td className="px-3 py-2 text-right font-mono text-amber">{u.tx_bps ? fmtBps(u.tx_bps) : '—'}</td>
                        <td className="px-3 py-2 text-right font-mono text-text-dim">
                          {u.bytes_in != null ? `↓${fmtBytes(u.bytes_in)} ↑${fmtBytes(u.bytes_out)}` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── Footer meta ─────────────────────────────────── */}
            <div className="text-[10px] font-mono text-text-mute text-center">
              Last refresh: {new Date(data.ts).toLocaleTimeString()} ·
              Delta window: {data.elapsed_ms ? `${(data.elapsed_ms / 1000).toFixed(1)}s` : '—'} ·
              Rates computed from byte counter deltas (accuracy improves after 2nd poll)
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Device info row ─────────────────────────────────────────
function Row({ label, value, accent = false }) {
  const colorClass = accent === 'red' ? 'text-red' : accent === 'amber' ? 'text-amber' : accent ? 'text-text' : 'text-text-dim';
  return (
    <div className="flex items-center justify-between">
      <span className="text-text-mute">{label}</span>
      <span className={colorClass}>{value}</span>
    </div>
  );
}

// ── Bandwidth graph ─────────────────────────────────────────
function BandwidthGraph({ history = [] }) {
  if (history.length < 2) {
    return <div className="h-24 flex items-center justify-center text-text-mute text-xs font-mono">Collecting data…</div>;
  }
  const maxVal = Math.max(...history.flatMap((h) => [h.rx, h.tx]), 1);
  const w = 100, h = 100;
  const rxPts = history.map((s, i) => `${(i / (history.length - 1)) * w},${h - (s.rx / maxVal) * h}`).join(' ');
  const txPts = history.map((s, i) => `${(i / (history.length - 1)) * w},${h - (s.tx / maxVal) * h}`).join(' ');
  return (
    <div className="relative h-24">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-full">
        <polyline points={`0,${h} ${rxPts} ${w},${h}`} fill="rgba(16,185,129,0.1)" stroke="none" />
        <polyline points={rxPts} fill="none" stroke="#10b981" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <polyline points={`0,${h} ${txPts} ${w},${h}`} fill="rgba(245,158,11,0.1)" stroke="none" />
        <polyline points={txPts} fill="none" stroke="#f59e0b" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="absolute top-1 right-2 text-[9px] font-mono text-text-mute">
        peak {fmtBps(maxVal)}
      </div>
    </div>
  );
}
