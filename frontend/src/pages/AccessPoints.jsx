import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Radio, Trash2, Activity } from 'lucide-react';
import {
  apiAccessPoints, apiAccessPointCreate, apiAccessPointDelete, apiAccessPointPing, apiRouters,
} from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { Skeleton, EmptyState } from '../components/primitives';

export default function AccessPoints() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const { data: rows, isLoading } = useQuery({ queryKey: ['access-points'], queryFn: apiAccessPoints });
  const { data: routers } = useQuery({ queryKey: ['routers'], queryFn: apiRouters });

  const pingAll = useMutation({
    mutationFn: async () => {
      const list = rows || [];
      await Promise.all(list.filter((r) => r.ip_address).map((r) => apiAccessPointPing(r.id)));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['access-points'] }),
  });

  return (
    <div>
      <PageHeader
        kicker="Network"
        title={<>Access <em>points</em></>}
        subtitle="Cudy and other AP inventory — ping checks and uplink notes."
        actions={
          <div className="flex gap-2">
            <button type="button" onClick={() => pingAll.mutate()} disabled={pingAll.isPending} className="btn btn-ghost">
              <Activity size={14} /> Ping all
            </button>
            <button type="button" onClick={() => setAdding(true)} className="btn btn-primary">
              <Plus size={14} /> Add AP
            </button>
          </div>
        }
      />
      <div className="p-8">
        {adding && (
          <ApForm
            routers={routers || []}
            onClose={() => setAdding(false)}
            onSaved={() => { setAdding(false); qc.invalidateQueries({ queryKey: ['access-points'] }); }}
          />
        )}
        {isLoading ? (
          <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>
        ) : !rows?.length ? (
          <div className="panel"><EmptyState title="No access points" icon={Radio} /></div>
        ) : (
          <div className="overflow-x-auto panel">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-mono text-[10px] text-text-mute uppercase border-b border-border-dim">
                  <th className="p-3">Name</th>
                  <th className="p-3">Model</th>
                  <th className="p-3">IP</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Last seen</th>
                  <th className="p-3">SSIDs</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((ap) => (
                  <tr key={ap.id} className="border-b border-border-dim/60 hover:bg-white/[0.02]">
                    <td className="p-3 font-mono">{ap.name}</td>
                    <td className="p-3 text-text-dim">{ap.model}</td>
                    <td className="p-3 font-mono text-xs">{ap.ip_address || '—'}</td>
                    <td className="p-3"><span className="tag tag-dim">{ap.status}</span></td>
                    <td className="p-3 text-xs text-text-mute">
                      {ap.last_seen_at ? new Date(ap.last_seen_at).toLocaleString() : '—'}
                    </td>
                    <td className="p-3 text-xs text-text-dim">
                      {[ap.ssid_24, ap.ssid_5].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td className="p-3 text-right space-x-2">
                      <button
                        type="button"
                        className="btn btn-ghost text-xs"
                        disabled={!ap.ip_address}
                        onClick={async () => {
                          await apiAccessPointPing(ap.id);
                          qc.invalidateQueries({ queryKey: ['access-points'] });
                        }}
                      >
                        Ping
                      </button>
                      <DelBtn id={ap.id} onDone={() => qc.invalidateQueries({ queryKey: ['access-points'] })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function DelBtn({ id, onDone }) {
  const m = useMutation({
    mutationFn: () => apiAccessPointDelete(id),
    onSuccess: onDone,
  });
  return (
    <button type="button" className="btn btn-ghost text-xs text-red" onClick={() => m.mutate()}>
      <Trash2 size={12} />
    </button>
  );
}

function ApForm({ routers, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: '', model: 'Cudy AX3000', ip_address: '', mac_address: '', location: '',
    router_id: '', notes: '',
  });
  const [err, setErr] = useState('');
  const create = useMutation({
    mutationFn: () => apiAccessPointCreate({
      ...form,
      router_id: form.router_id ? Number(form.router_id) : null,
    }),
    onSuccess: onSaved,
    onError: (e) => setErr(e?.response?.data?.error || e.message),
  });

  return (
    <div className="panel p-6 mb-6 max-w-xl">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-display text-xl italic">New access point</h3>
        <button type="button" className="text-text-mute" onClick={onClose}>Close</button>
      </div>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => { e.preventDefault(); setErr(''); create.mutate(); }}
      >
        <label className="sm:col-span-2">
          <span className="text-mono text-[10px] text-text-mute uppercase">Name</span>
          <input className="input mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </label>
        <label>
          <span className="text-mono text-[10px] text-text-mute uppercase">Model</span>
          <input className="input mt-1" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
        </label>
        <label>
          <span className="text-mono text-[10px] text-text-mute uppercase">IP</span>
          <input className="input mt-1 font-mono" value={form.ip_address} onChange={(e) => setForm({ ...form, ip_address: e.target.value })} />
        </label>
        <label>
          <span className="text-mono text-[10px] text-text-mute uppercase">MAC</span>
          <input className="input mt-1 font-mono" value={form.mac_address} onChange={(e) => setForm({ ...form, mac_address: e.target.value })} />
        </label>
        <label>
          <span className="text-mono text-[10px] text-text-mute uppercase">Uplink router</span>
          <select className="input mt-1" value={form.router_id} onChange={(e) => setForm({ ...form, router_id: e.target.value })}>
            <option value="">—</option>
            {routers.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </label>
        <label className="sm:col-span-2">
          <span className="text-mono text-[10px] text-text-mute uppercase">Location</span>
          <input className="input mt-1" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
        </label>
        <label className="sm:col-span-2">
          <span className="text-mono text-[10px] text-text-mute uppercase">Notes</span>
          <input className="input mt-1" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </label>
        {err && <div className="sm:col-span-2 text-red text-sm">{err}</div>}
        <div className="sm:col-span-2 flex gap-2">
          <button type="submit" className="btn btn-primary" disabled={create.isPending}>Save</button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
