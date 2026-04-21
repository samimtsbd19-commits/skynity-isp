import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Phone, Mail, MessageCircle, Calendar, Key, Copy, Send,
  Ban, ShieldCheck, Globe, Clock, X, Network, Check,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import {
  apiCustomer, apiNotifyChannels, apiNotifySendCredentials,
  apiSubscriptionBandwidth, apiExtendSubscription,
  apiSuspensionsByCustomer, apiSuspensionApply, apiSuspensionLift,
  apiStaticIpAssign, apiStaticIpClear,
  apiTunnels, apiAssignSubTunnel, apiClearSubTunnel,
} from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { StatusPill, Skeleton } from '../components/primitives';
import BandwidthChart from '../components/BandwidthChart';

const currencyFmt = (n) =>
  new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT', maximumFractionDigits: 0 }).format(n || 0);

export default function CustomerDetail() {
  const { id } = useParams();
  const [showSuspendModal, setShowSuspendModal] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['customer', id], queryFn: () => apiCustomer(id),
  });
  const suspensionsQ = useQuery({
    queryKey: ['customer', id, 'suspensions'],
    queryFn: () => apiSuspensionsByCustomer(id),
  });

  if (isLoading) return <div className="p-8"><Skeleton className="h-96" /></div>;
  if (!data) return null;

  const { customer, subscriptions, orders } = data;
  const suspHistory = suspensionsQ.data || [];
  const activeSuspension = suspHistory.find((s) => !s.lifted_at);
  const isSuspended = customer.status === 'suspended' || customer.status === 'banned';

  return (
    <div>
      <PageHeader
        kicker={`Customer · ${customer.customer_code}`}
        title={customer.full_name}
        subtitle={
          <span className="flex items-center gap-4 font-mono text-xs">
            <span className="flex items-center gap-1.5"><Phone size={12} /> {customer.phone}</span>
            {customer.email && <span className="flex items-center gap-1.5"><Mail size={12} /> {customer.email}</span>}
            {customer.telegram_id && <span className="flex items-center gap-1.5"><MessageCircle size={12} /> @{customer.telegram_username || customer.telegram_id}</span>}
          </span>
        }
        actions={
          <>
            {!isSuspended ? (
              <button className="btn btn-ghost text-red" onClick={() => setShowSuspendModal(true)}>
                <Ban size={14} /> Suspend
              </button>
            ) : null}
            <Link to="/customers" className="btn btn-ghost">
              <ArrowLeft size={14} /> Back
            </Link>
          </>
        }
      />
      <div className="p-8 space-y-8">
        {/* Active suspension banner */}
        {activeSuspension && (
          <SuspensionBanner
            suspension={activeSuspension}
            customerId={customer.id}
          />
        )}

        {/* Bio strip */}
        <div className="panel p-6 grid sm:grid-cols-4 gap-6">
          <Stat label="Status"><StatusPill status={customer.status} /></Stat>
          <Stat label="Joined">
            <div className="text-sm font-mono">{new Date(customer.created_at).toLocaleDateString()}</div>
            <div className="text-xs text-text-mute mt-0.5">{formatDistanceToNow(new Date(customer.created_at), { addSuffix: true })}</div>
          </Stat>
          <Stat label="Subscriptions">
            <div className="text-display text-2xl">{subscriptions.length}</div>
          </Stat>
          <Stat label="Orders">
            <div className="text-display text-2xl">{orders.length}</div>
          </Stat>
        </div>

        {/* Subscriptions */}
        <section>
          <div className="section-rule mb-4">
            <h2 className="text-display text-2xl italic">Subscriptions</h2>
          </div>
          {!subscriptions.length ? (
            <div className="panel p-6 text-center text-text-mute italic">No subscriptions yet.</div>
          ) : (
            <div className="space-y-3">
              {subscriptions.map((s) => <SubscriptionCard key={s.id} sub={s} />)}
            </div>
          )}
        </section>

        {/* Orders */}
        <section>
          <div className="section-rule mb-4">
            <h2 className="text-display text-2xl italic">Order history</h2>
          </div>
          <div className="panel overflow-hidden">
            <div className="divide-y divide-border-dim">
              {!orders.length ? (
                <div className="p-6 text-center text-text-mute italic">No orders yet.</div>
              ) : orders.map((o) => (
                <div key={o.id} className="px-5 py-3.5 flex items-center gap-4 ticker-row">
                  <div className="w-1 h-8 rounded-full" style={{
                    background: o.status === 'approved' ? '#10b981'
                      : o.status === 'rejected' ? '#ef4444' : '#f59e0b'
                  }}/>
                  <div className="flex-1 min-w-0">
                    <div className="text-mono text-[11px] text-text-dim">{o.order_code}</div>
                    <div className="text-sm">{o.package_name}</div>
                  </div>
                  <StatusPill status={o.status} />
                  <div className="text-right font-mono">
                    <div className="text-amber text-sm">{currencyFmt(o.amount)}</div>
                    <div className="text-[10px] text-text-mute">{new Date(o.created_at).toLocaleDateString()}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {showSuspendModal && (
        <SuspendModal
          customerId={customer.id}
          customerName={customer.full_name}
          onClose={() => setShowSuspendModal(false)}
        />
      )}
    </div>
  );
}

function Stat({ label, children }) {
  return (
    <div>
      <div className="text-mono text-[10px] text-text-mute uppercase tracking-wider mb-1.5">{label}</div>
      {children}
    </div>
  );
}

function SubscriptionCard({ sub }) {
  const qc = useQueryClient();
  const expires = new Date(sub.expires_at);
  const expired = expires < new Date();
  const daysLeft = Math.ceil((expires - new Date()) / 86400000);
  const [showChart, setShowChart] = useState(false);
  const [showExtend, setShowExtend] = useState(false);

  return (
    <>
    <div className="panel p-5 grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
      <div>
        <div className="flex items-center gap-2">
          <span className={`led ${expired ? 'led-off' : sub.status === 'active' ? 'led-on' : 'led-warn'}`} />
          <div className="text-display text-xl italic">{sub.package_name}</div>
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs font-mono text-text-mute">
          <span className="tag tag-dim">{sub.service_type.toUpperCase()}</span>
          <StatusPill status={sub.status} />
          {sub.mt_synced ? (
            <span className="tag tag-green">Router ✓</span>
          ) : (
            <span className="tag tag-amber">Pending sync</span>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <CredentialRow icon={Key} label="Username" value={sub.login_username} />
        <CredentialRow icon={Key} label="Password" value={sub.login_password} />
        {sub.service_type === 'pppoe' && <StaticIpRow sub={sub} />}
        {sub.service_type === 'pppoe' && <TunnelRow sub={sub} /> }
      </div>

      <div className="text-right">
        <div className="flex items-center justify-end gap-1.5 text-mono text-[10px] text-text-mute uppercase tracking-wider">
          <Calendar size={10} /> Expires
        </div>
        <div className="text-sm font-mono mt-1">{expires.toLocaleDateString()}</div>
        <div className={`text-xs mt-0.5 font-mono ${expired ? 'text-red' : daysLeft < 3 ? 'text-amber' : 'text-text-mute'}`}>
          {expired ? 'Expired' : `${daysLeft} days left`}
        </div>
        <div className="mt-3 flex justify-end gap-2 flex-wrap">
          <button
            onClick={() => setShowChart((v) => !v)}
            className="btn btn-ghost text-xs"
            title="Show daily bandwidth usage"
          >
            📊 {showChart ? 'Hide' : 'Usage'}
          </button>
          <button
            onClick={() => setShowExtend(true)}
            className="btn btn-ghost text-xs text-green"
            title="Extend subscription"
          >
            + Extend
          </button>
          <SendCredentialsButton subscriptionId={sub.id} />
        </div>
      </div>
    </div>
    {showChart && (
      <div className="mt-2">
        <BandwidthChart fetcher={(days) => apiSubscriptionBandwidth(sub.id, days)} />
      </div>
    )}
    {showExtend && (
      <ExtendModal
        sub={sub}
        onClose={() => setShowExtend(false)}
        onSuccess={() => {
          setShowExtend(false);
          qc.invalidateQueries({ queryKey: ['customer'] });
        }}
      />
    )}
    </>
  );
}

const EXTEND_PRESETS = [
  { label: '7 days', days: 7 },
  { label: '10 days', days: 10 },
  { label: '15 days', days: 15 },
  { label: '30 days', days: 30 },
  { label: '60 days', days: 60 },
  { label: 'Custom', days: null },
];

function ExtendModal({ sub, onClose, onSuccess }) {
  const [preset, setPreset] = useState(30);
  const [custom, setCustom] = useState('');
  const [note, setNote] = useState('');
  const [result, setResult] = useState(null);

  const extend = useMutation({
    mutationFn: () => {
      const days = preset === null ? parseInt(custom, 10) : preset;
      return apiExtendSubscription(sub.id, days, note);
    },
    onSuccess: (data) => {
      setResult(data);
      setTimeout(onSuccess, 1500);
    },
  });

  const days = preset === null ? parseInt(custom, 10) || 0 : preset;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={onClose}
    >
      <div className="panel p-6 max-w-sm w-full space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-display text-xl italic">Extend subscription</h3>
          <button onClick={onClose} className="text-text-mute hover:text-amber"><X size={16} /></button>
        </div>

        <div className="text-xs font-mono text-text-mute bg-surface2 rounded px-3 py-2">
          <div>{sub.package_name} · {sub.login_username}</div>
          <div>Current expiry: {new Date(sub.expires_at).toLocaleDateString()}</div>
        </div>

        <div>
          <label className="block text-[10px] text-text-mute font-mono uppercase mb-2">Add days</label>
          <div className="grid grid-cols-3 gap-2">
            {EXTEND_PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => setPreset(p.days)}
                className={`btn btn-sm ${preset === p.days ? 'btn-primary' : 'btn-ghost'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {preset === null && (
            <input
              type="number" min="1" max="3650"
              className="input input-sm w-full mt-2"
              placeholder="Enter number of days"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
            />
          )}
        </div>

        <div>
          <label className="block text-[10px] text-text-mute font-mono uppercase mb-2">Note (optional)</label>
          <input
            className="input input-sm w-full"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Payment received offline"
          />
        </div>

        {result && (
          <div className="text-xs font-mono text-green bg-green/10 border border-green/30 rounded px-3 py-2">
            ✓ Extended! New expiry: {new Date(result.new_expires_at).toLocaleDateString()}
            {result.mt_error && <div className="text-amber mt-1">⚠ MikroTik: {result.mt_error}</div>}
          </div>
        )}

        {extend.isError && (
          <div className="text-xs text-red font-mono">
            {extend.error?.response?.data?.error || extend.error?.message}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-border-dim">
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button
            onClick={() => extend.mutate()}
            className="btn btn-primary"
            disabled={extend.isPending || days < 1 || result}
          >
            <Check size={14} /> {extend.isPending ? 'Extending…' : `Add ${days || '?'} days`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// "Send credentials" dropdown
//   - Shows enabled channels only
//   - Builds canonical username/password message server-side
//   - Also has a free-form "Send a message…" option
// ============================================================
function SendCredentialsButton({ subscriptionId }) {
  const { data: channels = [] } = useQuery({
    queryKey: ['notify', 'channels'],
    queryFn: apiNotifyChannels,
  });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);   // channel currently in flight
  const [result, setResult] = useState(null);

  const ready = channels.filter((c) => c.enabled && c.configured);

  const send = async (channel) => {
    setBusy(channel); setResult(null);
    try {
      await apiNotifySendCredentials({ subscription_id: subscriptionId, channel });
      setResult({ ok: true, via: channel });
    } catch (e) {
      setResult({ ok: false, detail: e?.response?.data?.error || e.message });
    } finally { setBusy(null); }
  };

  if (!ready.length) {
    return (
      <div className="text-[10px] text-text-mute italic">
        Enable a channel in Settings to send by SMS/Telegram.
      </div>
    );
  }

  return (
    <div className="relative inline-block">
      <button onClick={() => setOpen((o) => !o)} className="btn btn-ghost text-xs">
        <Send size={12} /> Send credentials
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 panel p-2 min-w-[180px]">
          {ready.map((c) => (
            <button
              key={c.channel}
              onClick={() => send(c.channel)}
              disabled={busy === c.channel}
              className="w-full text-left px-3 py-2 text-xs hover:bg-surface2 rounded-sm font-mono uppercase tracking-wider"
            >
              {busy === c.channel ? 'sending…' : `via ${c.channel}`}
            </button>
          ))}
        </div>
      )}
      {result && (
        <div className={`text-[10px] mt-1 font-mono ${result.ok ? 'text-green' : 'text-red'}`}>
          {result.ok ? `✓ sent via ${result.via}` : `✗ ${result.detail}`}
        </div>
      )}
    </div>
  );
}

function CredentialRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-2 bg-surface2 px-2.5 py-1.5 rounded-sm group">
      <Icon size={12} className="text-text-mute" />
      <span className="text-[10px] text-text-mute uppercase font-mono tracking-wider w-16">{label}</span>
      <code className="flex-1 text-sm font-mono text-text truncate">{value}</code>
      <button
        onClick={() => navigator.clipboard.writeText(value)}
        title="Copy"
        className="opacity-0 group-hover:opacity-100 text-text-mute hover:text-amber transition-all"
      >
        <Copy size={12} />
      </button>
    </div>
  );
}

// ============================================================
// Static IP editor — inline row on PPPoE subscription cards.
// Admin clicks the IP to edit it; blank submits = clear it.
// The backend pushes `remote-address` to MikroTik and kicks the
// session so the next reconnect uses the new IP.
// ============================================================
function StaticIpRow({ sub }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(sub.static_ip || '');
  const [error, setError] = useState(null);

  const save = useMutation({
    mutationFn: async (ip) => {
      if (!ip) return apiStaticIpClear(sub.id);
      return apiStaticIpAssign(sub.id, ip);
    },
    onSuccess: () => {
      setError(null); setEditing(false);
      qc.invalidateQueries({ queryKey: ['customer'] });
    },
    onError: (e) => setError(e?.response?.data?.error || e.message),
  });

  if (editing) {
    return (
      <div className="flex items-center gap-2 bg-surface2 px-2.5 py-1.5 rounded-sm">
        <Globe size={12} className="text-text-mute" />
        <span className="text-[10px] text-text-mute uppercase font-mono tracking-wider w-16">Static IP</span>
        <input
          className="input input-sm flex-1 font-mono"
          value={value}
          placeholder="e.g. 103.x.x.x  (blank = clear)"
          onChange={(e) => setValue(e.target.value)}
        />
        <button className="btn btn-primary btn-sm" disabled={save.isPending}
                onClick={() => save.mutate(value.trim())}>
          Save
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); setValue(sub.static_ip || ''); setError(null); }}>
          <X size={12} />
        </button>
        {error && <div className="text-[10px] text-red font-mono ml-1">{error}</div>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 bg-surface2 px-2.5 py-1.5 rounded-sm group">
      <Globe size={12} className="text-text-mute" />
      <span className="text-[10px] text-text-mute uppercase font-mono tracking-wider w-16">Static IP</span>
      <code className="flex-1 text-sm font-mono text-text truncate">
        {sub.static_ip || <span className="text-text-mute italic">— not assigned —</span>}
      </code>
      <button className="text-text-mute hover:text-amber text-[10px] font-mono uppercase"
              onClick={() => setEditing(true)}>
        {sub.static_ip ? 'Edit' : 'Assign'}
      </button>
    </div>
  );
}

// ============================================================
// VPN tunnel selector — route the subscription's traffic via a
// specific WireGuard / L2TP tunnel. Requires a static IP first
// (the backend uses it as the src-address match).
// ============================================================
function TunnelRow({ sub }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState(null);
  const [value, setValue] = useState(sub.tunnel_id || '');

  const tunnelsQ = useQuery({
    queryKey: ['tunnels', sub.router_id],
    queryFn: () => apiTunnels(sub.router_id),
    enabled: editing,
  });

  const save = useMutation({
    mutationFn: async (tid) => {
      if (!tid) return apiClearSubTunnel(sub.id);
      return apiAssignSubTunnel(sub.id, Number(tid));
    },
    onSuccess: () => {
      setError(null); setEditing(false);
      qc.invalidateQueries({ queryKey: ['customer'] });
    },
    onError: (e) => setError(e?.response?.data?.error || e.message),
  });

  if (editing) {
    const tunnels = tunnelsQ.data || [];
    return (
      <div className="flex items-center gap-2 bg-surface2 px-2.5 py-1.5 rounded-sm">
        <Network size={12} className="text-text-mute" />
        <span className="text-[10px] text-text-mute uppercase font-mono tracking-wider w-16">VPN</span>
        <select
          className="input input-sm flex-1 font-mono"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        >
          <option value="">— none (default route) —</option>
          {tunnels.filter((t) => t.is_enabled).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} · {t.kind}{t.client_gateway ? ` → ${t.client_gateway}` : ''}
            </option>
          ))}
        </select>
        <button className="btn btn-primary btn-sm" disabled={save.isPending}
                onClick={() => save.mutate(value)}>
          Save
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); setValue(sub.tunnel_id || ''); setError(null); }}>
          <X size={12} />
        </button>
        {error && <div className="text-[10px] text-red font-mono ml-1">{error}</div>}
      </div>
    );
  }

  const activeLabel = sub.tunnel_id
    ? <code className="text-amber">via tunnel #{sub.tunnel_id}</code>
    : <span className="text-text-mute italic">— default route —</span>;

  return (
    <div className="flex items-center gap-2 bg-surface2 px-2.5 py-1.5 rounded-sm group">
      <Network size={12} className="text-text-mute" />
      <span className="text-[10px] text-text-mute uppercase font-mono tracking-wider w-16">VPN</span>
      <code className="flex-1 text-sm font-mono truncate">{activeLabel}</code>
      <button
        className="text-text-mute hover:text-amber text-[10px] font-mono uppercase"
        onClick={() => setEditing(true)}
        title={!sub.static_ip ? 'Assign a static IP first' : ''}
      >
        {sub.tunnel_id ? 'Change' : 'Assign'}
      </button>
    </div>
  );
}

// ============================================================
// Banner shown when the customer has an active suspension.
// Displays reason + countdown + "Restore" button.
// ============================================================
function SuspensionBanner({ suspension, customerId }) {
  const qc = useQueryClient();
  const lift = useMutation({
    mutationFn: () => apiSuspensionLift(suspension.id, { reason: 'Restored by admin' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer', String(customerId)] });
      qc.invalidateQueries({ queryKey: ['customer', String(customerId), 'suspensions'] });
    },
  });

  const endsText = suspension.is_permanent
    ? 'Permanent — until manually lifted'
    : suspension.ends_at
      ? `Lifts automatically ${formatDistanceToNow(new Date(suspension.ends_at), { addSuffix: true })} · ${new Date(suspension.ends_at).toLocaleString()}`
      : 'No end date';

  return (
    <div className="panel p-4 border-red/40" style={{ background: 'rgba(239,68,68,0.08)' }}>
      <div className="flex items-start gap-3">
        <Ban size={22} className="text-red mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="tag tag-red">{suspension.is_permanent ? 'BANNED' : 'SUSPENDED'}</span>
            <span className="text-sm">{suspension.reason}</span>
          </div>
          {suspension.notes && (
            <div className="text-[11px] text-text-mute font-mono mt-1">{suspension.notes}</div>
          )}
          <div className="text-[11px] text-text-dim font-mono mt-1 flex items-center gap-1.5">
            <Clock size={11} /> {endsText}
          </div>
          {!suspension.mt_applied && (
            <div className="text-[11px] text-amber font-mono mt-1">
              ⚠ MikroTik not reachable when applied — user may still be online. Retry by clicking "Poll now" in Router monitor.
            </div>
          )}
        </div>
        <button
          className="btn btn-ghost text-green"
          disabled={lift.isPending}
          onClick={() => lift.mutate()}
        >
          <ShieldCheck size={14} /> Restore
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Modal — pick a suspension duration + reason and apply.
// ============================================================
const DURATIONS = [
  { key: '30m',       label: '30 minutes' },
  { key: '1h',        label: '1 hour' },
  { key: '6h',        label: '6 hours' },
  { key: '12h',       label: '12 hours' },
  { key: '1d',        label: '1 day' },
  { key: '3d',        label: '3 days' },
  { key: '7d',        label: '7 days' },
  { key: '30d',       label: '30 days' },
  { key: 'permanent', label: 'Permanent ban' },
  { key: 'custom',    label: 'Custom…' },
];

const DEFAULT_REASONS = [
  'Late payment', 'TOS violation', 'Abuse', 'Requested by customer',
];

function SuspendModal({ customerId, customerName, onClose }) {
  const qc = useQueryClient();
  const [duration, setDuration] = useState('1d');
  const [customHours, setCustomHours] = useState(24);
  const [reason, setReason] = useState(DEFAULT_REASONS[0]);
  const [customReason, setCustomReason] = useState('');
  const [notes, setNotes] = useState('');

  const apply = useMutation({
    mutationFn: () => apiSuspensionApply({
      customerId,
      duration,
      customHours: duration === 'custom' ? customHours : undefined,
      reason: reason === '__custom__' ? (customReason || 'Unspecified') : reason,
      notes: notes || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer', String(customerId)] });
      qc.invalidateQueries({ queryKey: ['customer', String(customerId), 'suspensions'] });
      qc.invalidateQueries({ queryKey: ['suspensions'] });
      onClose();
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={onClose}
    >
      <div
        className="panel p-6 max-w-md w-full space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-display text-xl italic">Suspend {customerName}</h3>
          <button onClick={onClose} className="text-text-mute hover:text-amber"><X size={16} /></button>
        </div>

        <div>
          <label className="block text-[10px] text-text-mute font-mono uppercase mb-2">Duration</label>
          <div className="grid grid-cols-3 gap-2">
            {DURATIONS.map((d) => (
              <button
                key={d.key}
                onClick={() => setDuration(d.key)}
                className={`btn btn-sm ${duration === d.key ? 'btn-primary' : 'btn-ghost'}`}
              >
                {d.label}
              </button>
            ))}
          </div>
          {duration === 'custom' && (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number" min="0.5" step="0.5"
                value={customHours}
                onChange={(e) => setCustomHours(Number(e.target.value))}
                className="input input-sm w-24"
              />
              <span className="text-xs text-text-mute">hours</span>
            </div>
          )}
        </div>

        <div>
          <label className="block text-[10px] text-text-mute font-mono uppercase mb-2">Reason</label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="input input-sm w-full"
          >
            {DEFAULT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            <option value="__custom__">Custom…</option>
          </select>
          {reason === '__custom__' && (
            <input
              className="input input-sm w-full mt-2"
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
              placeholder="Type a custom reason"
            />
          )}
        </div>

        <div>
          <label className="block text-[10px] text-text-mute font-mono uppercase mb-2">Internal notes (optional)</label>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="input input-sm w-full font-mono text-xs"
            placeholder="Only visible to admins"
          />
        </div>

        {apply.isError && (
          <div className="text-xs text-red font-mono">
            {apply.error?.response?.data?.error || apply.error?.message}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-border-dim">
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button
            onClick={() => apply.mutate()}
            className="btn btn-primary"
            disabled={apply.isPending || (reason === '__custom__' && !customReason.trim())}
          >
            <Ban size={14} /> {apply.isPending ? 'Applying…' : 'Suspend now'}
          </button>
        </div>
      </div>
    </div>
  );
}
