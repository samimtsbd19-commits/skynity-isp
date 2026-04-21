import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Package as PackageIcon, Plus, Check, X } from 'lucide-react';
import { apiPackages, apiCreatePackage, apiUpdatePackage } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { Skeleton, EmptyState } from '../components/primitives';

const currencyFmt = (n) =>
  new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT', maximumFractionDigits: 0 }).format(n || 0);

export default function Packages() {
  const [adding, setAdding] = useState(false);
  const qc = useQueryClient();
  const { data: packages, isLoading } = useQuery({
    queryKey: ['packages'], queryFn: apiPackages,
  });

  const toggle = useMutation({
    mutationFn: ({ id, is_active }) => apiUpdatePackage(id, { is_active: is_active ? 1 : 0 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['packages'] }),
  });

  return (
    <div>
      <PageHeader
        kicker="Catalog"
        title={<>Service <em>packages</em></>}
        subtitle="The plans customers can choose from. Each maps to a MikroTik profile."
        actions={
          <button onClick={() => setAdding(true)} className="btn btn-primary">
            <Plus size={14} /> New package
          </button>
        }
      />
      <div className="p-8">
        {adding && <NewPackageForm onClose={() => setAdding(false)} />}

        {isLoading ? (
          <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-20" />)}</div>
        ) : !packages?.length ? (
          <div className="panel"><EmptyState title="No packages yet" icon={PackageIcon} /></div>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {packages.map((p) => (
              <div key={p.id} className={`panel p-5 relative ${!p.is_active ? 'opacity-50 diagonal-stripes' : ''}`}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="text-mono text-[10px] text-text-mute uppercase tracking-wider">
                      {p.code}
                    </div>
                    <div className="text-display text-2xl italic mt-1">{p.name}</div>
                  </div>
                  <span className={`tag ${p.service_type === 'pppoe' ? 'tag-cyan' : 'tag-amber'}`}>
                    {p.service_type}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-3 py-3 border-y border-border-dim my-3">
                  <Metric label="Speed" value={`${p.rate_down_mbps} Mbps`} />
                  <Metric label="Duration" value={`${p.duration_days} days`} />
                  <Metric label="Price" value={currencyFmt(p.price)} accent />
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-mono text-text-mute">
                    Profile: <span className="text-text-dim">{p.mikrotik_profile}</span>
                  </span>
                  <button
                    onClick={() => toggle.mutate({ id: p.id, is_active: !p.is_active })}
                    className={`text-[11px] font-mono uppercase tracking-wider transition-colors ${
                      p.is_active ? 'text-green' : 'text-text-mute hover:text-amber'
                    }`}
                  >
                    {p.is_active ? '● Active' : '○ Disabled'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, accent }) {
  return (
    <div>
      <div className="text-mono text-[10px] text-text-mute uppercase tracking-wider">{label}</div>
      <div className={`text-sm font-mono mt-1 ${accent ? 'text-amber' : ''}`}>{value}</div>
    </div>
  );
}

function NewPackageForm({ onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    code: '', name: '', service_type: 'pppoe',
    rate_up_mbps: 10, rate_down_mbps: 10,
    duration_days: 30, price: 500,
    mikrotik_profile: '',
  });
  const [err, setErr] = useState('');

  const create = useMutation({
    mutationFn: apiCreatePackage,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['packages'] }); onClose(); },
    onError: (e) => setErr(e?.response?.data?.error || e.message),
  });

  const up = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="panel p-6 mb-6 animate-fade-up">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-display text-2xl italic">New package</h3>
        <button onClick={onClose} className="text-text-mute hover:text-text"><X size={16} /></button>
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); create.mutate(form); }}
        className="grid grid-cols-2 gap-4"
      >
        <Field label="Code (unique)">
          <input className="input" value={form.code} onChange={up('code')} placeholder="PPPOE-50M-30D" required />
        </Field>
        <Field label="Display name">
          <input className="input" value={form.name} onChange={up('name')} placeholder="PPPoE 50Mbps — 30 Days" required />
        </Field>
        <Field label="Service type">
          <select className="input" value={form.service_type} onChange={up('service_type')}>
            <option value="pppoe">PPPoE</option>
            <option value="hotspot">Hotspot</option>
          </select>
        </Field>
        <Field label="MikroTik profile (must exist on router)">
          <input className="input" value={form.mikrotik_profile} onChange={up('mikrotik_profile')} placeholder="pppoe-50mb" required />
        </Field>
        <Field label="Down (Mbps)">
          <input type="number" className="input" value={form.rate_down_mbps} onChange={up('rate_down_mbps')} required />
        </Field>
        <Field label="Up (Mbps)">
          <input type="number" className="input" value={form.rate_up_mbps} onChange={up('rate_up_mbps')} required />
        </Field>
        <Field label="Duration (days)">
          <input type="number" className="input" value={form.duration_days} onChange={up('duration_days')} required />
        </Field>
        <Field label="Price (BDT)">
          <input type="number" step="0.01" className="input" value={form.price} onChange={up('price')} required />
        </Field>
        {err && (
          <div className="col-span-2 text-red text-sm font-mono px-3 py-2 border border-red/40 bg-red/5 rounded-sm">
            {err}
          </div>
        )}

        <div className="col-span-2 flex items-center gap-3 pt-2">
          <button type="submit" className="btn btn-primary" disabled={create.isPending}>
            <Check size={14} /> {create.isPending ? 'Saving…' : 'Save package'}
          </button>
          <button type="button" onClick={onClose} className="btn btn-ghost">Cancel</button>
        </div>
      </form>
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
