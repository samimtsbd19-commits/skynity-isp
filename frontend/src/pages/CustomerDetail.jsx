import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, Phone, Mail, MessageCircle, Calendar, Key, Copy, Send,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import {
  apiCustomer, apiNotifyChannels, apiNotifySendCredentials,
} from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { StatusPill, Skeleton } from '../components/primitives';

const currencyFmt = (n) =>
  new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT', maximumFractionDigits: 0 }).format(n || 0);

export default function CustomerDetail() {
  const { id } = useParams();
  const { data, isLoading } = useQuery({
    queryKey: ['customer', id], queryFn: () => apiCustomer(id),
  });

  if (isLoading) return <div className="p-8"><Skeleton className="h-96" /></div>;
  if (!data) return null;

  const { customer, subscriptions, orders } = data;

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
          <Link to="/customers" className="btn btn-ghost">
            <ArrowLeft size={14} /> Back
          </Link>
        }
      />
      <div className="p-8 space-y-8">
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
  const expires = new Date(sub.expires_at);
  const expired = expires < new Date();
  const daysLeft = Math.ceil((expires - new Date()) / 86400000);

  return (
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
      </div>

      <div className="text-right">
        <div className="flex items-center justify-end gap-1.5 text-mono text-[10px] text-text-mute uppercase tracking-wider">
          <Calendar size={10} /> Expires
        </div>
        <div className="text-sm font-mono mt-1">{expires.toLocaleDateString()}</div>
        <div className={`text-xs mt-0.5 font-mono ${expired ? 'text-red' : daysLeft < 3 ? 'text-amber' : 'text-text-mute'}`}>
          {expired ? 'Expired' : `${daysLeft} days left`}
        </div>
        <div className="mt-3">
          <SendCredentialsButton subscriptionId={sub.id} />
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
