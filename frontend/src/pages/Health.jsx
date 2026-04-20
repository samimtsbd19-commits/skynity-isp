// ============================================================
// Health & Alerts page
// ------------------------------------------------------------
// Shows:
//   * A summary bar of open events (critical / error / warning)
//   * Per-router monitoring cards (CPU, RAM, temp, ping, SFP)
//   * A list of open issues with suggested fixes + "Resolve"
// Translates headings via the i18n catalogue.
// ============================================================
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import {
  HeartPulse, AlertTriangle, AlertOctagon, Info, CheckCircle2,
  Cpu, MemoryStick, Thermometer, Activity, Radio,
  Wifi, Satellite, ChevronRight, PlayCircle,
} from 'lucide-react';
import {
  apiEvents, apiEventsSummary, apiResolveEvent, apiRunHealthChecks,
  apiMonitorRouters, apiMonitorRouter, apiMonitorPollNow,
  apiMonitorAddPingTarget, apiMonitorDelPingTarget,
} from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, Skeleton } from '../components/primitives';
import { useT } from '../i18n';
import clsx from 'clsx';

const SEV_META = {
  critical: { icon: AlertOctagon,   color: 'text-red',    bg: 'bg-red/10 border-red/30' },
  error:    { icon: AlertTriangle,  color: 'text-red',    bg: 'bg-red/10 border-red/20' },
  warning:  { icon: AlertTriangle,  color: 'text-amber',  bg: 'bg-amber/10 border-amber/30' },
  info:     { icon: Info,           color: 'text-cyan',   bg: 'bg-cyan/10 border-cyan/30' },
};

export default function Health() {
  const t = useT();
  const qc = useQueryClient();
  const [tab, setTab] = useState('open');

  const summary = useQuery({
    queryKey: ['events-summary'],
    queryFn: apiEventsSummary,
    refetchInterval: 30_000,
  });
  const events = useQuery({
    queryKey: ['events', tab],
    queryFn: () => apiEvents(tab),
    refetchInterval: 30_000,
  });
  const routers = useQuery({
    queryKey: ['monitor-routers'],
    queryFn: apiMonitorRouters,
    refetchInterval: 30_000,
  });

  const runNow = useMutation({
    mutationFn: async () => { await apiMonitorPollNow(); await apiRunHealthChecks(); },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['events'] });
      qc.invalidateQueries({ queryKey: ['events-summary'] });
      qc.invalidateQueries({ queryKey: ['monitor-routers'] });
    },
  });
  const resolveM = useMutation({
    mutationFn: apiResolveEvent,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['events'] });
      qc.invalidateQueries({ queryKey: ['events-summary'] });
    },
  });

  const s = summary.data || { critical: 0, error: 0, warning: 0, info: 0, total: 0 };

  return (
    <div>
      <PageHeader
        kicker="System"
        title={<><HeartPulse size={18} className="inline mr-2 text-amber" />{t('health.title')}</>}
        subtitle={t('health.subtitle')}
        actions={
          <button
            onClick={() => runNow.mutate()}
            disabled={runNow.isPending}
            className="btn btn-ghost text-xs"
          >
            <PlayCircle size={12} /> {runNow.isPending ? '…' : t('health.runNow')}
          </button>
        }
      />

      <div className="p-8 space-y-6">
        {/* ---------- Summary cards ---------- */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SevCard label={t('health.summary.critical')} n={s.critical} sev="critical" />
          <SevCard label={t('health.summary.error')}    n={s.error}    sev="error" />
          <SevCard label={t('health.summary.warning')}  n={s.warning}  sev="warning" />
          <div className={clsx(
            'panel p-4 flex items-center gap-3',
            s.total === 0 ? 'border-green/40 bg-green/5' : ''
          )}>
            <CheckCircle2 size={20} className={s.total === 0 ? 'text-green' : 'text-text-mute'} />
            <div>
              <div className="text-xs text-text-mute uppercase font-mono">
                {s.total === 0 ? t('health.summary.allClear') : t('common.status')}
              </div>
              <div className="text-lg font-mono">
                {s.total === 0 ? '✓' : s.total + ' total'}
              </div>
            </div>
          </div>
        </div>

        {/* ---------- Routers ---------- */}
        <section>
          <h2 className="text-display italic text-xl mb-3">
            <Radio size={16} className="inline mr-2 text-amber" />
            {t('monitor.title')}
          </h2>
          {routers.isLoading ? (
            <div className="grid md:grid-cols-2 gap-3">
              {[1,2].map(i => <Skeleton key={i} className="h-32" />)}
            </div>
          ) : !routers.data?.length ? (
            <EmptyState title="No active routers" hint="Add one from the Routers page." icon={Satellite} />
          ) : (
            <div className="grid md:grid-cols-2 gap-3">
              {routers.data.map((r) => <RouterCard key={r.id} router={r} />)}
            </div>
          )}
        </section>

        {/* ---------- Events ---------- */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-display italic text-xl">
              <AlertTriangle size={16} className="inline mr-2 text-amber" />
              Issues
            </h2>
            <div className="flex gap-1">
              {['open', 'resolved', 'all'].map((v) => (
                <button
                  key={v}
                  onClick={() => setTab(v)}
                  className={clsx(
                    'px-3 py-1 text-xs font-mono uppercase rounded-sm',
                    tab === v ? 'bg-amber text-black' : 'text-text-dim hover:text-text'
                  )}
                >
                  {t(`health.tab.${v}`)}
                </button>
              ))}
            </div>
          </div>
          {events.isLoading ? (
            <div className="space-y-2">
              {[1,2,3].map(i => <Skeleton key={i} className="h-20" />)}
            </div>
          ) : !events.data?.length ? (
            <div className="panel">
              <EmptyState title={t('health.none')} icon={CheckCircle2} />
            </div>
          ) : (
            <div className="space-y-2">
              {events.data.map((e) => (
                <EventCard key={e.id} event={e} onResolve={() => resolveM.mutate(e.id)} t={t} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ============================================================
// Helpers
// ============================================================
function SevCard({ label, n, sev }) {
  const meta = SEV_META[sev];
  const Icon = meta.icon;
  return (
    <div className={clsx('panel p-4 flex items-center gap-3', n > 0 ? meta.bg : '')}>
      <Icon size={20} className={meta.color} />
      <div>
        <div className="text-xs text-text-mute uppercase font-mono">{label}</div>
        <div className={clsx('text-lg font-mono', n > 0 ? meta.color : 'text-text-mute')}>
          {n}
        </div>
      </div>
    </div>
  );
}

function EventCard({ event: e, onResolve, t }) {
  const [open, setOpen] = useState(false);
  const meta = SEV_META[e.severity] || SEV_META.info;
  const Icon = meta.icon;
  const resolved = !!e.resolved_at;
  return (
    <div className={clsx('panel', resolved ? 'opacity-60' : meta.bg)}>
      <div
        className="p-4 flex items-start gap-3 cursor-pointer"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon size={18} className={clsx('mt-0.5 shrink-0', meta.color)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={clsx('tag', meta.color)}>
              {t(`health.severity.${e.severity}`)}
            </span>
            <span className="tag tag-dim">{e.source}</span>
            <span className="text-mono text-[10px] text-text-mute">{e.code}</span>
          </div>
          <div className="font-medium mt-1">{e.title}</div>
          {!open && e.message && (
            <div className="text-xs text-text-mute mt-1 line-clamp-1">{e.message}</div>
          )}
          <div className="text-mono text-[10px] text-text-mute mt-1">
            {t('health.lastSeen')} · {formatDistanceToNow(new Date(e.last_seen), { addSuffix: true })}
            {e.occurrences > 1 && <span className="ml-2">· {t('health.occurrences', { n: e.occurrences })}</span>}
            {resolved && <span className="ml-2 text-green">· resolved</span>}
          </div>
        </div>
        <ChevronRight
          size={14}
          className={clsx('text-text-mute mt-1 transition-transform', open ? 'rotate-90' : '')}
        />
      </div>
      {open && (
        <div className="border-t border-border-dim px-4 py-3 space-y-2">
          {e.message && (
            <div>
              <div className="text-[10px] text-text-mute uppercase font-mono mb-1">Message</div>
              <div className="text-xs whitespace-pre-wrap">{e.message}</div>
            </div>
          )}
          {e.suggestion && (
            <div>
              <div className="text-[10px] text-text-mute uppercase font-mono mb-1">{t('health.suggestion')}</div>
              <div className="text-xs whitespace-pre-wrap text-text-dim">{e.suggestion}</div>
            </div>
          )}
          {!resolved && (
            <div className="pt-2">
              <button onClick={onResolve} className="btn btn-primary text-xs">
                <CheckCircle2 size={12} /> {t('health.resolve')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RouterCard({ router: r }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const latest = r.latest;
  const cpu    = latest ? Number(latest.cpu_load)    : null;
  const memPct = latest && latest.mem_total ? Math.round((Number(latest.mem_used) / Number(latest.mem_total)) * 100) : null;
  const temp   = latest ? (latest.temperature != null ? Number(latest.temperature) : null) : null;
  const stale  = !latest || (Date.now() - new Date(latest.taken_at).getTime() > 15 * 60 * 1000);

  const ledClass = stale
    ? 'led-off'
    : (cpu ?? 0) > 85 || (temp ?? 0) > 70
      ? 'led-warn'
      : 'led-on';

  return (
    <div className={clsx('panel', r.active_events?.length ? 'border-amber/40' : '')}>
      <div className="p-4 flex items-start gap-3">
        <span className={clsx('led mt-1', ledClass)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="font-medium">{r.name}</div>
            <span className="tag tag-dim text-[10px]">{r.host}</span>
          </div>
          <div className="text-mono text-[10px] text-text-mute mt-0.5">
            {r.model || r.board_name || '—'} · RouterOS {r.routeros_version || '—'}
          </div>

          <div className="grid grid-cols-4 gap-2 mt-3">
            <Metric icon={Cpu}         label={t('monitor.cpu')}  value={cpu  != null ? cpu + '%'  : '—'} warn={(cpu ?? 0) > 75} />
            <Metric icon={MemoryStick} label={t('monitor.memory')} value={memPct != null ? memPct + '%' : '—'} warn={(memPct ?? 0) > 80} />
            <Metric icon={Thermometer} label={t('monitor.temperature')} value={temp != null ? temp.toFixed(0) + '°' : '—'} warn={(temp ?? 0) > 60} />
            <Metric icon={Activity}    label={t('monitor.activePpp')} value={latest?.active_ppp ?? '—'} />
          </div>

          {r.active_events?.length > 0 && (
            <div className="mt-3 text-xs text-amber">
              ⚠ {r.active_events.length} open issue{r.active_events.length > 1 ? 's' : ''}
            </div>
          )}
        </div>
        <button onClick={() => setOpen((v) => !v)} className="btn btn-ghost text-xs">
          {open ? t('common.close') : 'Details'}
        </button>
      </div>

      {open && <RouterDetail routerId={r.id} />}
    </div>
  );
}

function Metric({ icon: Icon, label, value, warn }) {
  return (
    <div className={clsx('text-center p-2 rounded-sm bg-surface2/50', warn && 'border border-amber/40')}>
      <div className="flex items-center justify-center gap-1">
        <Icon size={11} className={clsx('text-text-mute', warn && 'text-amber')} />
        <span className="text-[10px] text-text-mute uppercase font-mono">{label}</span>
      </div>
      <div className={clsx('text-sm font-mono mt-0.5', warn ? 'text-amber' : 'text-text')}>{value}</div>
    </div>
  );
}

function RouterDetail({ routerId }) {
  const t = useT();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['monitor-router', routerId],
    queryFn: () => apiMonitorRouter(routerId),
    refetchInterval: 60_000,
  });
  const [pingHost, setPingHost] = useState('');
  const addPing = useMutation({
    mutationFn: () => apiMonitorAddPingTarget(routerId, { host: pingHost, label: pingHost }),
    onSettled: () => { setPingHost(''); qc.invalidateQueries({ queryKey: ['monitor-router', routerId] }); },
  });
  const delPing = useMutation({
    mutationFn: (tid) => apiMonitorDelPingTarget(tid),
    onSettled: () => qc.invalidateQueries({ queryKey: ['monitor-router', routerId] }),
  });

  if (isLoading || !data) return <div className="px-4 pb-4"><Skeleton className="h-40" /></div>;
  const { device, neighbors, interfaces, pings } = data;

  return (
    <div className="border-t border-border-dim p-4 space-y-4">
      {/* device info */}
      <div>
        <div className="text-mono text-[10px] text-text-mute uppercase mb-2">{t('monitor.device')}</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <KV k={t('monitor.model')}       v={device?.model || device?.board_name} />
          <KV k={t('monitor.routeros')}    v={device?.routeros_version} />
          <KV k={t('monitor.license')}     v={device?.license_level} />
          <KV k={t('monitor.architecture')}v={device?.architecture} />
          <KV k={t('monitor.serial')}      v={device?.serial_number} />
          <KV k={t('monitor.firmware')}    v={device?.firmware_current} />
        </div>
      </div>

      {/* interfaces + SFP */}
      {interfaces?.length > 0 && (
        <div>
          <div className="text-mono text-[10px] text-text-mute uppercase mb-2">{t('monitor.interfaces')} / {t('monitor.sfp')}</div>
          <div className="space-y-1">
            {interfaces.map((i) => (
              <div key={i.id} className="flex items-center gap-3 text-xs font-mono">
                <span className={clsx('led', i.link_ok ? 'led-on' : 'led-off')} />
                <span className="w-32 truncate">{i.interface_name}</span>
                <span className="text-text-mute">↓ {human(i.rx_bps)}</span>
                <span className="text-text-mute">↑ {human(i.tx_bps)}</span>
                {i.sfp_rx_power != null && (
                  <span className="tag tag-dim text-[10px]">
                    SFP Rx {Number(i.sfp_rx_power).toFixed(1)} dBm
                    {i.sfp_temp != null && ` · ${Number(i.sfp_temp).toFixed(0)}°C`}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ping targets */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-mono text-[10px] text-text-mute uppercase">{t('monitor.ping')}</span>
          <form
            onSubmit={(e) => { e.preventDefault(); if (pingHost) addPing.mutate(); }}
            className="flex items-center gap-1"
          >
            <input
              className="input text-xs h-7"
              placeholder="8.8.8.8"
              value={pingHost}
              onChange={(e) => setPingHost(e.target.value)}
            />
            <button type="submit" className="btn btn-ghost text-xs h-7">+ {t('monitor.addTarget')}</button>
          </form>
        </div>
        {pings?.length === 0 ? (
          <div className="text-xs text-text-mute italic">No targets configured.</div>
        ) : (
          <div className="space-y-1">
            {pings.map((p) => (
              <div key={p.target.id} className="flex items-center gap-3 text-xs font-mono">
                <Wifi size={12} className={p.latest && Number(p.latest.packet_loss) < 20 ? 'text-green' : 'text-red'} />
                <span className="w-40 truncate">{p.target.label || p.target.host}</span>
                <span className="text-text-mute">
                  {p.latest ? `${t('monitor.rtt')} ${Number(p.latest.rtt_avg_ms || 0).toFixed(0)} ms` : '—'}
                </span>
                <span className={clsx('text-text-mute', p.latest && Number(p.latest.packet_loss) > 20 && 'text-amber')}>
                  {p.latest ? `${t('monitor.loss')} ${Number(p.latest.packet_loss || 0)}%` : ''}
                </span>
                <button
                  onClick={() => delPing.mutate(p.target.id)}
                  className="ml-auto text-text-mute hover:text-red"
                >✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* neighbors */}
      {neighbors?.length > 0 && (
        <div>
          <div className="text-mono text-[10px] text-text-mute uppercase mb-2">{t('monitor.neighbors')}</div>
          <div className="space-y-1">
            {neighbors.slice(0, 10).map((n) => (
              <div key={n.id} className="text-xs font-mono flex items-center gap-2">
                <span className="text-amber">{n.identity || '—'}</span>
                <span className="text-text-mute">{n.address}</span>
                <span className="text-text-mute">{n.platform}</span>
                <span className="text-text-mute ml-auto">{n.interface_name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function KV({ k, v }) {
  return (
    <div>
      <div className="text-[10px] text-text-mute uppercase font-mono">{k}</div>
      <div className="text-xs font-mono truncate">{v || '—'}</div>
    </div>
  );
}

function human(n) {
  n = Number(n) || 0;
  if (n < 1000)          return `${n} bps`;
  if (n < 1_000_000)     return `${(n / 1000).toFixed(1)} kbps`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)} Mbps`;
  return                        `${(n / 1_000_000_000).toFixed(2)} Gbps`;
}
