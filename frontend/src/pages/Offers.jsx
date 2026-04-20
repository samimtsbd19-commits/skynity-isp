import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Megaphone, Plus, Trash2, Pencil, Send, Sparkles, Package as PackageIcon,
  X, Check, AlertCircle,
} from 'lucide-react';
import {
  apiOffers, apiOfferCreate, apiOfferUpdate, apiOfferDelete, apiOfferBroadcast,
  apiPackages,
} from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { Skeleton, EmptyState, ConfirmButton } from '../components/primitives';
import { useT } from '../i18n';

// ============================================================
// Offers — admin-authored promos that:
//   • show as a highlighted banner on the public portal
//   • can be broadcast to every customer via Telegram/SMS/WhatsApp
//
// Kept intentionally simple: one row per offer, inline actions.
// ============================================================

export default function Offers() {
  const qc = useQueryClient();
  const t = useT();
  const [editing, setEditing] = useState(null); // `null` = none, `{}` = create, `{...}` = edit
  const [showInactive, setShowInactive] = useState(false);

  const { data: offers, isLoading } = useQuery({
    queryKey: ['offers', showInactive],
    queryFn: () => apiOffers(showInactive),
  });
  const { data: packages = [] } = useQuery({
    queryKey: ['packages'], queryFn: apiPackages,
  });

  const del = useMutation({
    mutationFn: apiOfferDelete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['offers'] }),
  });

  return (
    <div>
      <PageHeader
        kicker="Marketing"
        title={<>Offers <em>& broadcasts</em></>}
        subtitle="Create promos that show on the public portal, and push them to customers via your configured channels."
        actions={
          <div className="flex items-center gap-2">
            <label className="text-xs text-text-mute flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
              />
              Show inactive
            </label>
            <button onClick={() => setEditing({})} className="btn btn-primary">
              <Plus size={14} /> New offer
            </button>
          </div>
        }
      />
      <div className="p-8 space-y-6">
        {editing && (
          <OfferForm
            packages={packages}
            initial={editing}
            onClose={() => setEditing(null)}
            onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['offers'] }); }}
          />
        )}

        {isLoading ? (
          <div className="space-y-2">{[1,2,3].map((i) => <Skeleton key={i} className="h-20" />)}</div>
        ) : !offers?.length ? (
          <div className="panel">
            <EmptyState
              title="No offers yet"
              icon={Megaphone}
              hint="Create one to feature a package or send a broadcast to customers."
            />
          </div>
        ) : (
          <div className="space-y-3">
            {offers.map((o) => (
              <OfferRow
                key={o.id}
                offer={o}
                onEdit={() => setEditing(o)}
                onDelete={() => del.mutate(o.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Individual row — quick info + inline broadcast
// ============================================================
function OfferRow({ offer, onEdit, onDelete }) {
  const qc = useQueryClient();
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [result, setResult] = useState(null);

  const broadcast = useMutation({
    mutationFn: (body) => apiOfferBroadcast(offer.id, body),
    onSuccess: (r) => {
      setResult({ ok: true, r });
      qc.invalidateQueries({ queryKey: ['offers'] });
    },
    onError: (err) => setResult({ ok: false, error: err?.response?.data?.error || err.message }),
  });

  const running = isRunning(offer);
  const statusTag = !offer.is_active
    ? ['tag-dim', 'Inactive']
    : running
      ? ['tag-green', 'Running']
      : ['tag-amber', 'Scheduled'];

  return (
    <div className="panel p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={`tag ${statusTag[0]}`}>{statusTag[1]}</span>
            {offer.discount_label && (
              <span className="tag tag-amber">{offer.discount_label}</span>
            )}
            <span className="text-mono text-[10px] text-text-mute">{offer.code}</span>
          </div>
          <div className="text-lg text-text font-medium">{offer.title}</div>
          {offer.description && (
            <div className="text-xs text-text-dim mt-1 max-w-2xl whitespace-pre-line line-clamp-3">
              {offer.description}
            </div>
          )}
          <div className="mt-3 flex items-center gap-4 text-[11px] text-text-mute flex-wrap">
            {offer.package_code && (
              <span className="inline-flex items-center gap-1"><PackageIcon size={12} />{offer.package_name}</span>
            )}
            {offer.starts_at && <span>Starts {new Date(offer.starts_at).toLocaleString()}</span>}
            {offer.ends_at   && <span>Ends {new Date(offer.ends_at).toLocaleString()}</span>}
            <span>Audience: {offer.audience}</span>
            {offer.broadcast_at && (
              <span>Last sent {new Date(offer.broadcast_at).toLocaleString()} ({offer.broadcast_count || 0} delivered)</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setBroadcastOpen(true)} className="btn btn-ghost" title="Broadcast to customers">
            <Send size={13} /> Broadcast
          </button>
          <button onClick={onEdit} className="btn btn-ghost" title="Edit">
            <Pencil size={13} />
          </button>
          <ConfirmButton variant="danger" onConfirm={onDelete}>
            <Trash2 size={13} />
          </ConfirmButton>
        </div>
      </div>

      {broadcastOpen && (
        <BroadcastModal
          offer={offer}
          running={broadcast.isPending}
          result={result}
          onClose={() => { setBroadcastOpen(false); setResult(null); }}
          onSend={(body) => broadcast.mutate(body)}
        />
      )}
    </div>
  );
}

function BroadcastModal({ offer, running, result, onClose, onSend }) {
  const [channels, setChannels] = useState(['sms']);
  const [includeInactive, setIncludeInactive] = useState(false);

  const toggleCh = (c) =>
    setChannels((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]);

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="panel p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-display text-xl italic">Broadcast offer</h3>
          <button onClick={onClose} className="text-text-mute hover:text-text"><X size={16} /></button>
        </div>
        <div className="text-sm text-text-dim mb-4">
          This will send <b className="text-text">{offer.title}</b> to every customer in the <b>{offer.audience}</b> audience.
        </div>

        <div className="mb-4">
          <span className="text-mono text-[10px] text-text-mute uppercase tracking-wider">Preferred channel order</span>
          <div className="flex flex-wrap gap-2 mt-2">
            {['sms', 'telegram', 'whatsapp'].map((c) => (
              <button
                key={c}
                onClick={() => toggleCh(c)}
                className={`tag ${channels.includes(c) ? 'tag-amber' : 'tag-dim'}`}
                type="button"
              >
                {c}
              </button>
            ))}
          </div>
          <div className="text-[10px] text-text-mute mt-1">
            The notifier always falls back down the list if a channel is disabled.
          </div>
        </div>

        {!offer.is_active && (
          <label className="flex items-center gap-2 text-xs text-amber mb-3">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
            />
            This offer is inactive — allow broadcast anyway
          </label>
        )}

        {result?.ok && (
          <div className="text-green text-xs font-mono px-3 py-2 border border-green/30 bg-green/5 rounded-sm mb-3">
            <Check size={12} className="inline mr-1" />
            Queued {result.r.queued} · Sent {result.r.sent} · Failed {result.r.failed}
          </div>
        )}
        {result?.ok === false && (
          <div className="text-red text-xs font-mono px-3 py-2 border border-red/30 bg-red/5 rounded-sm mb-3">
            <AlertCircle size={12} className="inline mr-1" />
            {result.error}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => onSend({ channels, includeInactive })}
            disabled={running}
            className="btn btn-primary"
          >
            <Send size={13} /> {running ? 'Sending…' : 'Send now'}
          </button>
          <button onClick={onClose} className="btn btn-ghost">Close</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Create / edit form — reused for both operations
// ============================================================
function OfferForm({ initial, onClose, onSaved, packages }) {
  const isEdit = !!initial?.id;
  const [form, setForm] = useState({
    code: initial.code || '',
    title: initial.title || '',
    description: initial.description || '',
    discount_label: initial.discount_label || '',
    featured_package_id: initial.featured_package_id || '',
    starts_at: toLocalInput(initial.starts_at),
    ends_at:   toLocalInput(initial.ends_at),
    is_active: initial.is_active == null ? true : !!initial.is_active,
    audience: initial.audience || 'all',
  });
  const [err, setErr] = useState('');

  const mut = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        featured_package_id: form.featured_package_id || null,
        starts_at: fromLocalInput(form.starts_at),
        ends_at:   fromLocalInput(form.ends_at),
      };
      return isEdit ? apiOfferUpdate(initial.id, payload) : apiOfferCreate(payload);
    },
    onSuccess: onSaved,
    onError: (e) => setErr(e?.response?.data?.error || e.message),
  });

  const f = (k) => (e) => setForm((v) => ({ ...v, [k]: e.target.value }));

  return (
    <div className="panel p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-amber" />
          <h3 className="text-display text-xl italic">{isEdit ? 'Edit' : 'Create'} offer</h3>
        </div>
        <button onClick={onClose} className="text-text-mute hover:text-text"><X size={16} /></button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Title" value={form.title} onChange={f('title')} />
        <Field label="Discount label (optional)" value={form.discount_label} onChange={f('discount_label')} placeholder="e.g. 20% off, Save ৳100" />

        <label className="block col-span-2">
          <span className="text-mono text-[10px] text-text-mute uppercase tracking-wider">Description</span>
          <textarea
            className="input mt-1.5 min-h-[80px]"
            value={form.description}
            onChange={f('description')}
            placeholder="Shown on the portal and in the broadcast message"
          />
        </label>

        <label className="block">
          <span className="text-mono text-[10px] text-text-mute uppercase tracking-wider">Featured package</span>
          <select
            className="input mt-1.5"
            value={form.featured_package_id || ''}
            onChange={f('featured_package_id')}
          >
            <option value="">— none —</option>
            {packages.map((p) => (
              <option key={p.id} value={p.id}>{p.code} · {p.name}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-mono text-[10px] text-text-mute uppercase tracking-wider">Audience</span>
          <select className="input mt-1.5" value={form.audience} onChange={f('audience')}>
            <option value="all">Everyone in CRM</option>
            <option value="customers">Existing customers (has a subscription)</option>
            <option value="new">New (last 30 days)</option>
          </select>
        </label>

        <label className="block">
          <span className="text-mono text-[10px] text-text-mute uppercase tracking-wider">Starts</span>
          <input type="datetime-local" className="input mt-1.5" value={form.starts_at} onChange={f('starts_at')} />
        </label>
        <label className="block">
          <span className="text-mono text-[10px] text-text-mute uppercase tracking-wider">Ends</span>
          <input type="datetime-local" className="input mt-1.5" value={form.ends_at} onChange={f('ends_at')} />
        </label>

        {!isEdit && (
          <Field label="Code (optional)" value={form.code} onChange={f('code')} placeholder="auto-generated" />
        )}
        <label className="flex items-center gap-2 text-sm text-text-dim mt-6">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => setForm((v) => ({ ...v, is_active: e.target.checked }))}
          />
          Active (shown on portal, broadcastable)
        </label>

        {err && (
          <div className="col-span-2 text-red text-sm font-mono px-3 py-2 border border-red/40 bg-red/5 rounded-sm">
            {err}
          </div>
        )}

        <div className="col-span-2 flex gap-2">
          <button onClick={() => mut.mutate()} disabled={mut.isPending} className="btn btn-primary">
            {mut.isPending ? 'Saving…' : (isEdit ? 'Save changes' : 'Create offer')}
          </button>
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <span className="text-mono text-[10px] text-text-mute uppercase tracking-wider">{label}</span>
      <input className="input mt-1.5" value={value || ''} onChange={onChange} placeholder={placeholder} />
    </label>
  );
}

function isRunning(o) {
  if (!o.is_active) return false;
  const now = new Date();
  if (o.starts_at && new Date(o.starts_at) > now) return false;
  if (o.ends_at   && new Date(o.ends_at)   < now) return false;
  return true;
}

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 19).replace('T', ' ');
}
