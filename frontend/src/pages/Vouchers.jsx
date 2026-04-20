import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ticket, Plus, Printer, Trash2, X, Check, Copy, Eye } from 'lucide-react';
import {
  apiVoucherBatches, apiVoucherBatchCreate, apiVoucherBatchDelete,
  apiVouchers, apiVoucherDelete, apiPackages, apiOpenVoucherBatchPrint,
} from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { Skeleton, EmptyState } from '../components/primitives';

export default function Vouchers() {
  const [creating, setCreating] = useState(false);
  const [viewBatch, setViewBatch] = useState(null);

  const { data: batches, isLoading } = useQuery({
    queryKey: ['voucher-batches'],
    queryFn: apiVoucherBatches,
  });

  return (
    <div>
      <PageHeader
        kicker="Prepaid"
        title={<>Voucher <em>codes</em></>}
        subtitle="Generate printable prepaid codes. Customers type the code on /portal/redeem to get instant WiFi credentials."
        actions={
          <button onClick={() => setCreating(true)} className="btn btn-primary">
            <Plus size={14} /> Generate batch
          </button>
        }
      />

      <div className="p-8">
        {creating && <NewBatchForm onClose={() => setCreating(false)} />}

        {isLoading ? (
          <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}</div>
        ) : !batches?.length ? (
          <div className="panel"><EmptyState title="No voucher batches yet" icon={Ticket} subtitle="Generate your first batch to get printable codes." /></div>
        ) : (
          <div className="space-y-3">
            {batches.map((b) => <BatchRow key={b.id} batch={b} onOpen={() => setViewBatch(b)} />)}
          </div>
        )}
      </div>

      {viewBatch && <BatchDetailModal batch={viewBatch} onClose={() => setViewBatch(null)} />}
    </div>
  );
}

function BatchRow({ batch, onOpen }) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: () => apiVoucherBatchDelete(batch.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['voucher-batches'] }),
  });

  const used = Number(batch.redeemed_count || 0);
  const total = Number(batch.count || 0);
  const pct = total ? Math.round((used / total) * 100) : 0;

  return (
    <div className="panel p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-mono text-[10px] text-text-mute uppercase tracking-wider">{batch.id}</span>
            <span className="tag tag-amber">{batch.package_code}</span>
          </div>
          <div className="text-display text-xl italic mt-1">{batch.name}</div>
          <div className="text-xs text-text-mute mt-1 font-mono">
            {batch.package_name} · {total} codes · created {new Date(batch.created_at).toLocaleDateString()}
            {batch.expires_at && <> · expires {new Date(batch.expires_at).toLocaleDateString()}</>}
          </div>
        </div>

        <div className="flex flex-col items-end">
          <div className="text-xs text-text-mute font-mono">USAGE</div>
          <div className="text-2xl font-mono">
            <span className={pct === 100 ? 'text-green' : 'text-amber'}>{used}</span>
            <span className="text-text-mute">/{total}</span>
          </div>
          <div className="w-32 h-1 bg-border-dim rounded mt-1 overflow-hidden">
            <div className="h-full bg-amber" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-4 pt-4 border-t border-border-dim">
        <button onClick={() => apiOpenVoucherBatchPrint(batch.id)} className="btn btn-ghost">
          <Printer size={14} /> Print sheet
        </button>
        <button onClick={onOpen} className="btn btn-ghost">
          <Eye size={14} /> View codes
        </button>
        <button
          onClick={() => { if (confirm('Delete all unredeemed codes in this batch?')) del.mutate(); }}
          disabled={del.isPending}
          className="btn btn-ghost text-red hover:text-red"
        >
          <Trash2 size={14} /> Delete
        </button>
      </div>
    </div>
  );
}

function NewBatchForm({ onClose }) {
  const qc = useQueryClient();
  const { data: packages } = useQuery({ queryKey: ['packages'], queryFn: apiPackages });
  const [form, setForm] = useState({
    package_id: '',
    count: 20,
    name: '',
    expires_at: '',
    note: '',
  });
  const [err, setErr] = useState('');

  const create = useMutation({
    mutationFn: apiVoucherBatchCreate,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['voucher-batches'] });
      onClose();
      if (res?.batchId && confirm(`Generated ${res.count} codes. Open printable sheet now?`)) {
        apiOpenVoucherBatchPrint(res.batchId);
      }
    },
    onError: (e) => setErr(e?.response?.data?.error || e.message),
  });

  const submit = (e) => {
    e.preventDefault();
    if (!form.package_id) return setErr('Select a package');
    create.mutate({
      package_id: Number(form.package_id),
      count: Number(form.count),
      name: form.name || undefined,
      expires_at: form.expires_at || null,
      note: form.note || undefined,
    });
  };

  return (
    <div className="panel p-6 mb-6 animate-fade-up">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-display text-2xl italic">Generate voucher batch</h3>
        <button onClick={onClose} className="text-text-mute hover:text-text"><X size={16} /></button>
      </div>

      <form onSubmit={submit} className="grid grid-cols-2 gap-4">
        <Field label="Package">
          <select className="input" value={form.package_id} onChange={(e) => setForm({ ...form, package_id: e.target.value })} required>
            <option value="">— select package —</option>
            {(packages || []).filter((p) => p.is_active).map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} · {p.name} · {p.rate_down_mbps}↓ Mbps · {p.duration_days}d · ৳{p.price}
              </option>
            ))}
          </select>
        </Field>

        <Field label="How many codes?">
          <input
            type="number" min="1" max="1000"
            className="input" value={form.count}
            onChange={(e) => setForm({ ...form, count: e.target.value })}
            required
          />
        </Field>

        <Field label="Batch name (optional)">
          <input
            className="input" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Counter sale — Apr 20"
          />
        </Field>

        <Field label="Codes expire at (optional)">
          <input
            type="datetime-local" className="input" value={form.expires_at}
            onChange={(e) => setForm({ ...form, expires_at: e.target.value })}
          />
        </Field>

        <div className="col-span-2">
          <Field label="Note (admin only)">
            <input
              className="input" value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder="e.g. Printed for shop-A on Apr 20"
            />
          </Field>
        </div>

        {err && (
          <div className="col-span-2 text-red text-sm font-mono px-3 py-2 border border-red/40 bg-red/5 rounded-sm">
            {err}
          </div>
        )}

        <div className="col-span-2 flex items-center gap-3 pt-2">
          <button type="submit" className="btn btn-primary" disabled={create.isPending}>
            <Check size={14} /> {create.isPending ? 'Generating…' : 'Generate codes'}
          </button>
          <button type="button" onClick={onClose} className="btn btn-ghost">Cancel</button>
        </div>
      </form>
    </div>
  );
}

function BatchDetailModal({ batch, onClose }) {
  const qc = useQueryClient();
  const { data: vouchers, isLoading } = useQuery({
    queryKey: ['vouchers', batch.id],
    queryFn: () => apiVouchers({ batchId: batch.id, limit: 500 }),
  });
  const del = useMutation({
    mutationFn: (id) => apiVoucherDelete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vouchers', batch.id] }),
  });

  const copyAll = () => {
    const text = (vouchers || []).map((v) => v.code).join('\n');
    navigator.clipboard.writeText(text).then(() => alert('Codes copied to clipboard'));
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="panel max-w-3xl w-full max-h-[85vh] flex flex-col">
        <div className="flex items-start justify-between p-5 border-b border-border-dim">
          <div>
            <div className="text-mono text-[10px] text-text-mute uppercase tracking-wider">{batch.id}</div>
            <div className="text-display text-xl italic mt-1">{batch.name}</div>
            <div className="text-xs text-text-mute mt-1">{batch.package_name} · {batch.count} codes</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={copyAll} className="btn btn-ghost"><Copy size={14}/> Copy all</button>
            <button onClick={() => apiOpenVoucherBatchPrint(batch.id)} className="btn btn-ghost"><Printer size={14}/> Print</button>
            <button onClick={onClose} className="btn btn-ghost"><X size={14}/></button>
          </div>
        </div>

        <div className="p-5 overflow-auto flex-1">
          {isLoading ? (
            <Skeleton className="h-40" />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-text-mute text-[10px] uppercase tracking-wider font-mono text-left">
                  <th className="pb-2">Code</th>
                  <th className="pb-2">State</th>
                  <th className="pb-2">Redeemed by</th>
                  <th className="pb-2">Redeemed at</th>
                  <th className="pb-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(vouchers || []).map((v) => (
                  <tr key={v.id} className="border-t border-border-dim">
                    <td className="py-2 font-mono">{v.code}</td>
                    <td className="py-2">
                      {v.is_redeemed
                        ? <span className="tag tag-green">used</span>
                        : <span className="tag tag-amber">unused</span>}
                    </td>
                    <td className="py-2 font-mono text-xs text-text-dim">{v.redeemed_by_phone || '-'}</td>
                    <td className="py-2 font-mono text-xs text-text-dim">
                      {v.redeemed_at ? new Date(v.redeemed_at).toLocaleString() : '-'}
                    </td>
                    <td className="py-2 text-right">
                      {!v.is_redeemed && (
                        <button
                          onClick={() => { if (confirm('Delete this code?')) del.mutate(v.id); }}
                          className="text-red hover:text-red text-xs font-mono"
                        >
                          <Trash2 size={12} className="inline" /> del
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-mono text-[10px] text-text-mute uppercase tracking-wider">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
