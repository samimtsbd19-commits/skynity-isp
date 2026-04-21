import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Activity, ChevronRight, Filter, X, Check } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { apiSubscriptions, apiExtendSubscription } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { StatusPill, EmptyState, Skeleton } from '../components/primitives';

const FILTERS = [
  { value: '',          label: 'All' },
  { value: 'active',    label: 'Active' },
  { value: 'expired',   label: 'Expired' },
  { value: 'suspended', label: 'Suspended' },
];

const PRESETS = [7, 10, 15, 30, 60];

export default function Subscriptions() {
  const [filter, setFilter] = useState('active');
  const [extendSub, setExtendSub] = useState(null); // sub being extended
  const qc = useQueryClient();

  const { data: subs, isLoading } = useQuery({
    queryKey: ['subscriptions', filter],
    queryFn: () => apiSubscriptions(filter || undefined),
    refetchInterval: 60_000,
  });

  return (
    <div>
      <PageHeader
        kicker="Service"
        title={<>Active <em>subscriptions</em></>}
        subtitle="Every paying seat on your network, grouped by state."
      />
      <div className="px-8 py-6">
        <div className="flex items-center gap-1 mb-6 border-b border-border-dim pb-4">
          <Filter size={14} className="text-text-mute mr-2" />
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`px-3 py-1.5 text-xs font-mono uppercase tracking-wider transition-colors rounded-sm ${
                filter === f.value
                  ? 'bg-amber text-black'
                  : 'text-text-dim hover:text-text hover:bg-surface2'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="panel p-4 space-y-2">
            {[1,2,3,4].map(i => <Skeleton key={i} className="h-16" />)}
          </div>
        ) : !subs?.length ? (
          <div className="panel">
            <EmptyState title="No subscriptions" hint="Try a different filter." icon={Activity} />
          </div>
        ) : (
          <div className="panel overflow-hidden">
            <div className="grid grid-cols-12 px-5 py-3 border-b border-border-dim text-mono text-[10px] text-text-mute uppercase tracking-wider">
              <div className="col-span-3">Customer</div>
              <div className="col-span-2">Service</div>
              <div className="col-span-2">Login</div>
              <div className="col-span-2">Package</div>
              <div className="col-span-2">Expires</div>
              <div className="col-span-1 text-right">Action</div>
            </div>
            <ul>
              {subs.map((s) => {
                const expires = new Date(s.expires_at);
                const expired = expires < new Date();
                const days = Math.ceil((expires - new Date()) / 86400000);
                return (
                  <li key={s.id} className="grid grid-cols-12 px-5 py-3.5 items-center border-b border-border-dim last:border-0 hover:bg-surface2/30 transition-colors">
                    <Link to={`/customers/${s.customer_id}`} className="col-span-3">
                      <div className="text-mono text-[11px] text-amber">{s.customer_code}</div>
                      <div className="text-sm truncate">{s.full_name}</div>
                    </Link>
                    <div className="col-span-2">
                      <div className="flex items-center gap-2">
                        <span className={`led ${s.status === 'active' && !expired ? 'led-on' : expired ? 'led-off' : 'led-warn'}`} />
                        <span className="tag tag-dim">{s.service_type.toUpperCase()}</span>
                      </div>
                    </div>
                    <div className="col-span-2">
                      <code className="text-mono text-sm text-text-dim">{s.login_username}</code>
                      {s.mac_address && (
                        <div className="text-mono text-[10px] mt-0.5">
                          <span className={s.bind_to_mac ? 'text-amber' : 'text-text-mute'}>
                            {s.bind_to_mac ? '🔒 ' : ''}{s.mac_address}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="col-span-2 text-sm truncate">{s.package_name}</div>
                    <div className="col-span-2">
                      <div className="text-mono text-xs">{expires.toLocaleDateString()}</div>
                      <div className={`text-[10px] font-mono ${expired ? 'text-red' : days < 3 ? 'text-amber' : 'text-text-mute'}`}>
                        {expired ? 'Expired' : `${days}d left`}
                      </div>
                    </div>
                    <div className="col-span-1 text-right">
                      <button
                        onClick={() => setExtendSub(s)}
                        className="text-[11px] font-mono text-green hover:text-amber transition-colors"
                        title="Extend subscription"
                      >
                        + Extend
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {extendSub && (
        <ExtendModal
          sub={extendSub}
          onClose={() => setExtendSub(null)}
          onSuccess={() => {
            setExtendSub(null);
            qc.invalidateQueries({ queryKey: ['subscriptions'] });
          }}
        />
      )}
    </div>
  );
}

function ExtendModal({ sub, onClose, onSuccess }) {
  const [days, setDays] = useState(30);
  const [custom, setCustom] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [note, setNote] = useState('');
  const [result, setResult] = useState(null);

  const extend = useMutation({
    mutationFn: () => {
      const d = isCustom ? parseInt(custom, 10) : days;
      return apiExtendSubscription(sub.id, d, note);
    },
    onSuccess: (data) => {
      setResult(data);
      setTimeout(onSuccess, 1800);
    },
  });

  const finalDays = isCustom ? parseInt(custom, 10) || 0 : days;
  const expires = new Date(sub.expires_at);
  const expired = expires < new Date();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={onClose}
    >
      <div className="panel p-6 max-w-sm w-full space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-display text-xl italic">Extend subscription</h3>
          <button onClick={onClose} className="text-text-mute hover:text-amber"><X size={16} /></button>
        </div>

        <div className="text-xs font-mono bg-surface2 rounded px-3 py-2 space-y-0.5">
          <div className="text-text">{sub.full_name} · <span className="text-amber">{sub.customer_code}</span></div>
          <div className="text-text-mute">{sub.package_name} · {sub.login_username}</div>
          <div className={expired ? 'text-red' : 'text-text-mute'}>
            Expiry: {expires.toLocaleDateString()} {expired ? '(EXPIRED)' : ''}
          </div>
        </div>

        <div>
          <label className="block text-[10px] text-text-mute font-mono uppercase mb-2">Days to add</label>
          <div className="grid grid-cols-3 gap-2 mb-2">
            {PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => { setDays(p); setIsCustom(false); }}
                className={`btn btn-sm ${!isCustom && days === p ? 'btn-primary' : 'btn-ghost'}`}
              >
                {p} days
              </button>
            ))}
            <button
              onClick={() => setIsCustom(true)}
              className={`btn btn-sm ${isCustom ? 'btn-primary' : 'btn-ghost'}`}
            >
              Custom
            </button>
          </div>
          {isCustom && (
            <input
              type="number" min="1" max="3650"
              className="input input-sm w-full"
              placeholder="Enter days (1–3650)"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              autoFocus
            />
          )}
        </div>

        <div>
          <label className="block text-[10px] text-text-mute font-mono uppercase mb-1.5">Note (optional)</label>
          <input
            className="input input-sm w-full"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Cash payment received"
          />
        </div>

        {result && (
          <div className="text-xs font-mono text-green bg-green/10 border border-green/30 rounded px-3 py-2">
            ✓ Done! New expiry: {new Date(result.new_expires_at).toLocaleDateString()}
            {!result.mt_synced && <div className="text-amber mt-0.5">⚠ MikroTik offline — will sync automatically.</div>}
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
            disabled={extend.isPending || finalDays < 1 || !!result}
          >
            <Check size={14} />
            {extend.isPending ? 'Extending…' : `Add ${finalDays || '?'} days`}
          </button>
        </div>
      </div>
    </div>
  );
}
