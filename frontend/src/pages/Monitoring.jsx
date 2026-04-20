import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Radio, Signal, Wifi, Cpu, HardDrive, Clock, RefreshCw } from 'lucide-react';
import {
  LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import {
  apiMikrotikActive, apiMikrotikInfo, apiMikrotikInterfaces, apiMikrotikQueues,
} from '../api/client';
import { useSelectedRouter } from '../contexts/RouterContext';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, Skeleton } from '../components/primitives';

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

/** RouterOS active PPP: prefer real counters; limit-* is a cap, not usage. */
function pppSessionTraffic(a) {
  const up = Number(a['bytes-out'] ?? a['tx-byte'] ?? 0);
  const down = Number(a['bytes-in'] ?? a['rx-byte'] ?? 0);
  if (up || down) return { up, down };
  const limUp = Number(a['limit-bytes-out'] ?? 0);
  const limDown = Number(a['limit-bytes-in'] ?? 0);
  if (limUp || limDown) return { up: limUp, down: limDown, isLimit: true };
  return { up: 0, down: 0 };
}

function formatMbps(n) {
  if (n == null || Number.isNaN(n)) return '0';
  if (n < 0.01) return n.toFixed(4);
  if (n < 1) return n.toFixed(2);
  return n.toFixed(2);
}

export default function Monitoring() {
  const { routerId } = useSelectedRouter();
  const [bwSeries, setBwSeries] = useState([]);
  const [wsStatus, setWsStatus] = useState('connecting');
  const [bwSource, setBwSource] = useState('rest');

  const { data: info } = useQuery({
    queryKey: ['mt-info', routerId],
    queryFn: () => apiMikrotikInfo(routerId),
    refetchInterval: 30_000,
    retry: false,
  });
  const { data: active, refetch, isFetching } = useQuery({
    queryKey: ['mt-active', routerId],
    queryFn: () => apiMikrotikActive(routerId),
    refetchInterval: 10_000,
    retry: false,
  });
  const { data: interfaces } = useQuery({
    queryKey: ['mt-interfaces', routerId],
    queryFn: () => apiMikrotikInterfaces(routerId),
    refetchInterval: 15_000,
    retry: false,
  });
  const { data: queues } = useQuery({
    queryKey: ['mt-queues', routerId],
    queryFn: () => apiMikrotikQueues(routerId),
    refetchInterval: 30_000,
    retry: false,
  });

  useEffect(() => {
    const token = localStorage.getItem('skynity_token');
    if (!token) return undefined;
    setBwSeries([]);
    setWsStatus('connecting');
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const q = new URLSearchParams({ token });
    if (routerId != null) q.set('routerId', String(routerId));
    const ws = new WebSocket(`${proto}//${window.location.host}/api/ws/monitor?${q.toString()}`);
    ws.onopen = () => setWsStatus('live');
    ws.onerror = () => setWsStatus('error');
    ws.onclose = () => setWsStatus((s) => (s === 'live' ? 'closed' : s));
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type !== 'bandwidth' || !Array.isArray(msg.interfaces)) return;
      if (msg.source) setBwSource(msg.source);
      let rx = 0;
      let tx = 0;
      for (const i of msg.interfaces) {
        rx += Number(i.rxBps || 0);
        tx += Number(i.txBps || 0);
      }
      const t = msg.ts || Date.now();
      setBwSeries((s) => [...s.slice(-119), { t, rxMbps: rx / 1e6, txMbps: tx / 1e6 }]);
    };
    return () => {
      ws.close();
    };
  }, [routerId]);

  const pppoe = active?.pppoe || [];
  const hotspot = active?.hotspot || [];
  const physIfaces = (interfaces || []).filter(i => i.type === 'ether');

  return (
    <div>
      <PageHeader
        kicker="Real-time"
        title={<>Live <em>sessions</em></>}
        subtitle="Everything happening on the wire, right now."
        actions={
          <button
            onClick={() => refetch()}
            className="btn btn-ghost"
          >
            <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
            Refresh
          </button>
        }
      />
      <div className="p-8 space-y-8">
        {/* Live bandwidth (WebSocket, REST-derived deltas on ether interfaces) */}
        <section>
          <div className="section-rule mb-4">
            <h2 className="text-display text-2xl italic">Bandwidth · live</h2>
          </div>
          <div className="panel p-6">
            <div className="flex items-center justify-between mb-4 text-mono text-[10px] text-text-mute uppercase tracking-wider">
              <span>Ethernet aggregate (Rx / Tx)</span>
              <span className={wsStatus === 'live' ? 'text-green' : 'text-amber'}>
                WS {wsStatus} · {bwSource}
              </span>
            </div>
            <div className="h-56 -mx-2">
              {bwSeries.length < 2 ? (
                <div className="h-full flex items-center justify-center text-text-mute text-sm font-mono">
                  Collecting samples…
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={bwSeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="2 4" stroke="#26262b" vertical={false} />
                    <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} hide tickFormatter={() => ''} />
                    <YAxis tick={{ fill: '#8c8a85', fontSize: 10 }} width={44} tickFormatter={(v) => `${v}`} label={{ value: 'Mbps', angle: -90, position: 'insideLeft', fill: '#52504c', fontSize: 10 }} />
                    <Tooltip
                      labelFormatter={(ts) => new Date(ts).toLocaleTimeString()}
                      formatter={(v, name) => [`${formatMbps(v)} Mbps`, name === 'rxMbps' ? 'Rx' : 'Tx']}
                      contentStyle={{
                        background: '#131316', border: '1px solid #26262b', borderRadius: 2, fontSize: 12, fontFamily: 'JetBrains Mono',
                      }}
                    />
                    <Legend formatter={(v) => (v === 'rxMbps' ? 'Rx (↓)' : 'Tx (↑)')} />
                    <Line type="monotone" dataKey="rxMbps" name="rxMbps" stroke="#06b6d4" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="txMbps" name="txMbps" stroke="#f59e0b" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
            <p className="text-[11px] text-text-mute mt-3 font-mono">
              Phase 4: sampled every 2s from MikroTik REST interface counters (ether). SNMP can be added as an alternate feed later.
            </p>
          </div>
        </section>

        {/* Router health strip */}
        {info ? (
          <div className="panel p-6 grid grid-cols-2 md:grid-cols-5 gap-6">
            <SysStat icon={Cpu} label="Model" value={info.boardName} />
            <SysStat icon={HardDrive} label="RouterOS" value={info.version} />
            <SysStat icon={Clock} label="Uptime" value={info.uptime} />
            <SysStat icon={Signal} label="PPPoE online" value={pppoe.length} mono />
            <SysStat icon={Wifi} label="Hotspot online" value={hotspot.length} mono />
          </div>
        ) : (
          <div className="panel p-6 border-red/40">
            <div className="text-red flex items-center gap-2">
              <Radio size={16} /> MikroTik unreachable — check tunnel / credentials
            </div>
          </div>
        )}

        {/* Interfaces */}
        {physIfaces.length > 0 && (
          <section>
            <div className="section-rule mb-4">
              <h2 className="text-display text-2xl italic">Interfaces</h2>
            </div>
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
              {physIfaces.map((iface) => (
                <div key={iface['.id']} className="panel p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`led ${iface.running === 'true' ? 'led-on' : 'led-off'}`} />
                        <span className="font-mono text-sm">{iface.name}</span>
                      </div>
                      <div className="text-[10px] text-text-mute uppercase font-mono tracking-wider mt-1">
                        {iface['mac-address']}
                      </div>
                    </div>
                    <span className="tag tag-dim">{iface.type}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border-dim text-xs font-mono">
                    <div>
                      <div className="text-text-mute text-[10px] uppercase">Tx</div>
                      <div className="text-text">{formatBytes(Number(iface['tx-byte'] || 0))}</div>
                    </div>
                    <div>
                      <div className="text-text-mute text-[10px] uppercase">Rx</div>
                      <div className="text-text">{formatBytes(Number(iface['rx-byte'] || 0))}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* PPPoE active */}
        <section>
          <div className="section-rule mb-4">
            <h2 className="text-display text-2xl italic">PPPoE · online now</h2>
          </div>
          {!pppoe.length ? (
            <div className="panel"><EmptyState title="No PPPoE sessions" icon={Signal} /></div>
          ) : (
            <div className="panel overflow-hidden">
              <div className="grid grid-cols-12 px-5 py-3 border-b border-border-dim text-mono text-[10px] text-text-mute uppercase tracking-wider">
                <div className="col-span-3">User</div>
                <div className="col-span-2">IP</div>
                <div className="col-span-2">MAC · caller</div>
                <div className="col-span-2">Uptime</div>
                <div className="col-span-3 text-right">Traffic</div>
              </div>
              <ul>
                {pppoe.map((a) => {
                  const t = pppSessionTraffic(a);
                  return (
                  <li key={a['.id']} className="grid grid-cols-12 px-5 py-3 items-center ticker-row">
                    <div className="col-span-3 flex items-center gap-2">
                      <span className="led led-on" />
                      <code className="font-mono text-sm">{a.name}</code>
                    </div>
                    <div className="col-span-2 font-mono text-xs text-text-dim">{a.address || '—'}</div>
                    <div className="col-span-2 font-mono text-[11px] text-text-mute">{a['caller-id'] || '—'}</div>
                    <div className="col-span-2 font-mono text-xs">{a.uptime || '—'}</div>
                    <div
                      className="col-span-3 text-right font-mono text-xs text-text-dim"
                      title={t.isLimit ? 'Byte quota limits (no live counters in API response)' : undefined}
                    >
                      ↑ {formatBytes(t.up)} · ↓ {formatBytes(t.down)}
                      {t.isLimit && <span className="text-[10px] text-text-mute ml-1">(quota)</span>}
                    </div>
                  </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>

        {/* Hotspot active */}
        <section>
          <div className="section-rule mb-4">
            <h2 className="text-display text-2xl italic">Hotspot · online now</h2>
          </div>
          {!hotspot.length ? (
            <div className="panel"><EmptyState title="No hotspot sessions" icon={Wifi} /></div>
          ) : (
            <div className="panel overflow-hidden">
              <div className="grid grid-cols-12 px-5 py-3 border-b border-border-dim text-mono text-[10px] text-text-mute uppercase tracking-wider">
                <div className="col-span-3">User</div>
                <div className="col-span-3">IP · MAC</div>
                <div className="col-span-2">Uptime</div>
                <div className="col-span-2">Idle</div>
                <div className="col-span-2 text-right">Login</div>
              </div>
              <ul>
                {hotspot.map((a) => (
                  <li key={a['.id']} className="grid grid-cols-12 px-5 py-3 items-center ticker-row">
                    <div className="col-span-3 flex items-center gap-2">
                      <span className="led led-on" />
                      <code className="font-mono text-sm">{a.user}</code>
                    </div>
                    <div className="col-span-3 font-mono text-[11px] text-text-dim">
                      {a.address || '—'}<br />
                      <span className="text-text-mute">{a['mac-address'] || '—'}</span>
                    </div>
                    <div className="col-span-2 font-mono text-xs">{a.uptime || '—'}</div>
                    <div className="col-span-2 font-mono text-xs text-text-mute">{a['idle-time'] || '—'}</div>
                    <div className="col-span-2 text-right font-mono text-[11px] text-text-mute">
                      {a['login-by'] || '—'}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* Simple queues */}
        {queues?.simple?.length > 0 && (
          <section>
            <div className="section-rule mb-4">
              <h2 className="text-display text-2xl italic">Queue control</h2>
            </div>
            <div className="panel overflow-hidden">
              <div className="grid grid-cols-12 px-5 py-3 border-b border-border-dim text-mono text-[10px] text-text-mute uppercase tracking-wider">
                <div className="col-span-4">Name</div>
                <div className="col-span-3">Target</div>
                <div className="col-span-3">Max limit (U/D)</div>
                <div className="col-span-2 text-right">State</div>
              </div>
              <ul>
                {queues.simple.slice(0, 20).map((q) => (
                  <li key={q['.id']} className="grid grid-cols-12 px-5 py-3 items-center ticker-row">
                    <div className="col-span-4 font-mono text-sm">{q.name}</div>
                    <div className="col-span-3 font-mono text-xs text-text-dim">{q.target || '—'}</div>
                    <div className="col-span-3 font-mono text-xs">{q['max-limit'] || '—'}</div>
                    <div className="col-span-2 text-right">
                      <span className={`led ${q.disabled === 'true' ? 'led-off' : 'led-on'}`} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function SysStat({ icon: Icon, label, value, mono }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-mono text-[10px] text-text-mute uppercase tracking-wider mb-1.5">
        <Icon size={11} /> {label}
      </div>
      <div className={mono ? 'text-display text-2xl' : 'text-sm font-mono'}>{value ?? '—'}</div>
    </div>
  );
}
