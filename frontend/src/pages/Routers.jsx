import { useState } from 'react';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { Wifi, WifiOff, Shield, Plus, X, Check, Trash2, TestTube2 } from 'lucide-react';
import {
  apiMikrotikInfo, apiRouters,
  apiRouterCreate, apiRouterUpdate, apiRouterDelete, apiRouterTest, apiRouterTestConnection,
} from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { Skeleton, ConfirmButton } from '../components/primitives';

export default function Routers() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const { data: routers = [], isLoading } = useQuery({
    queryKey: ['routers'],
    queryFn: apiRouters,
    staleTime: 30_000,
  });

  const del = useMutation({
    mutationFn: apiRouterDelete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['routers'] }),
  });
  const live = useMutation({
    mutationFn: apiRouterTest,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['routers'] }),
  });

  const health = useQueries({
    queries: routers.map((r) => ({
      queryKey: ['mt-info', 'router-card', r.id],
      queryFn: () => apiMikrotikInfo(r.is_default ? null : r.id),
      retry: false,
      enabled: !isLoading && routers.length > 0,
    })),
  });

  return (
    <div>
      <PageHeader
        kicker="Infrastructure"
        title={<>Network <em>routers</em></>}
        subtitle="DB-registered MikroTiks. Choose one in the sidebar to scope live API + bandwidth stream."
        actions={
          <button onClick={() => setAdding(true)} className="btn btn-primary">
            <Plus size={14} /> Add router
          </button>
        }
      />
      <div className="p-8 space-y-6">
        {adding && <NewRouterForm onClose={() => setAdding(false)} />}
        {isLoading ? (
          <Skeleton className="h-40" />
        ) : !routers.length ? (
          <div className="panel p-8 text-center text-text-mute text-sm">
            No routers in database yet. Use Telegram <code className="text-amber">/addrouter</code> or seed migration.
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {routers.map((r, idx) => {
              const q = health[idx];
              const info = q?.data;
              const err = q?.error;
              return (
                <div key={r.id} className="panel p-6 relative overflow-hidden">
                  <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber/40 to-transparent" />
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="text-mono text-[10px] text-amber uppercase tracking-[0.2em] mb-1">
                        id {r.id}{r.is_default ? ' · default ★' : ''}
                      </div>
                      <h3 className="text-display text-2xl italic">{r.name}</h3>
                      <div className="text-xs font-mono text-text-mute mt-1">
                        {r.host}:{r.port} · {r.username} · SSL {r.use_ssl ? 'on' : 'off'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {q?.isLoading ? (
                        <span className="led led-warn" />
                      ) : err || !info ? (
                        <>
                          <WifiOff size={16} className="text-red" />
                          <span className="tag tag-red">Unreachable</span>
                        </>
                      ) : (
                        <>
                          <Wifi size={16} className="text-green" />
                          <span className="tag tag-green">REST ok</span>
                        </>
                      )}
                    </div>
                  </div>
                  {info && (
                    <div className="grid grid-cols-2 gap-3 text-xs font-mono border-t border-border-dim pt-4">
                      <Field label="Board">{info.boardName}</Field>
                      <Field label="ROS">{info.version}</Field>
                      <Field label="Uptime" span={2}>{info.uptime}</Field>
                    </div>
                  )}
                  {err && !q?.isLoading && (
                    <p className="text-red text-[11px] font-mono mt-2">{err.response?.data?.error || err.message}</p>
                  )}
                  <div className="mt-4 pt-3 border-t border-border-dim flex items-center justify-end gap-1">
                    <button onClick={() => live.mutate(r.id)} className="btn btn-ghost" title="Test connection">
                      <TestTube2 size={12} /> Test
                    </button>
                    <ConfirmButton variant="danger" confirmText="Delete?" onConfirm={() => del.mutate(r.id)}>
                      <Trash2 size={12} />
                    </ConfirmButton>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="panel p-6 border-dashed bg-surface2/50">
          <div className="flex items-start gap-3">
            <Shield size={20} className="text-amber mt-0.5" strokeWidth={1.5} />
            <div>
              <div className="text-sm">Add routers from web or Telegram</div>
              <div className="text-xs text-text-mute mt-1">
                Click <span className="text-amber">Add router</span> above, or use Telegram <code className="text-amber">/addrouter</code>.
                Passwords are encrypted (AES-GCM) before storage.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function NewRouterForm({ onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: '', host: '', port: 443, username: '', password: '',
    use_ssl: true, is_default: false, note: '',
  });
  const [err, setErr] = useState('');
  const [testResult, setTestResult] = useState(null);

  const create = useMutation({
    mutationFn: () => apiRouterCreate(form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['routers'] }); onClose(); },
    onError: (e) => setErr(e?.response?.data?.error || e.message),
  });
  const test = useMutation({
    mutationFn: () => apiRouterTestConnection(form),
    onSuccess: (d) => setTestResult({ ok: true, d }),
    onError: (e) => setTestResult({ ok: false, error: e?.response?.data?.error || e.message }),
  });

  const up = (k) => (e) => {
    const v = e.target?.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm({ ...form, [k]: v });
  };

  return (
    <div className="panel p-6 animate-fade-up">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-display text-2xl italic">Add MikroTik router</h3>
        <button onClick={onClose} className="text-text-mute hover:text-text"><X size={16} /></button>
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); create.mutate(); }}
        className="grid grid-cols-2 gap-4"
      >
        <Field2 label="Name"><input className="input" value={form.name} onChange={up('name')} required /></Field2>
        <Field2 label="Host / IP"><input className="input" value={form.host} onChange={up('host')} required /></Field2>
        <Field2 label="Port"><input type="number" className="input" value={form.port} onChange={up('port')} /></Field2>
        <Field2 label="Username"><input className="input" value={form.username} onChange={up('username')} required /></Field2>
        <Field2 label="Password"><input type="password" className="input" value={form.password} onChange={up('password')} required /></Field2>
        <Field2 label="Options">
          <div className="flex gap-4 pt-2 text-xs">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={form.use_ssl} onChange={up('use_ssl')} />
              <span>Use SSL</span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={form.is_default} onChange={up('is_default')} />
              <span>Default ★</span>
            </label>
          </div>
        </Field2>
        <Field2 label="Note" full>
          <input className="input" value={form.note} onChange={up('note')} />
        </Field2>

        {testResult?.ok && (
          <div className="col-span-2 text-green text-xs font-mono px-3 py-2 border border-green/30 bg-green/5 rounded-sm">
            ✓ Connected · {testResult.d.boardName} · ROS {testResult.d.version}
          </div>
        )}
        {testResult?.ok === false && (
          <div className="col-span-2 text-red text-xs font-mono px-3 py-2 border border-red/30 bg-red/5 rounded-sm">
            ✗ {testResult.error}
          </div>
        )}
        {err && (
          <div className="col-span-2 text-red text-sm font-mono px-3 py-2 border border-red/40 bg-red/5 rounded-sm">{err}</div>
        )}

        <div className="col-span-2 flex gap-2 pt-2">
          <button type="submit" className="btn btn-primary" disabled={create.isPending}>
            <Check size={14} /> {create.isPending ? 'Saving…' : 'Save router'}
          </button>
          <button type="button" onClick={() => test.mutate()} className="btn btn-ghost" disabled={test.isPending}>
            <TestTube2 size={13} /> {test.isPending ? 'Testing…' : 'Test connection'}
          </button>
          <button type="button" onClick={onClose} className="btn btn-ghost">Cancel</button>
        </div>
      </form>
    </div>
  );
}

function Field2({ label, children, full }) {
  return (
    <label className={`block ${full ? 'col-span-2' : ''}`}>
      <span className="text-mono text-[10px] text-text-mute uppercase tracking-wider">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function Field({ label, children, span }) {
  return (
    <div className={span === 2 ? 'col-span-2' : ''}>
      <div className="text-mono text-[10px] text-text-mute uppercase tracking-wider mb-0.5">{label}</div>
      <div className="text-text">{children ?? '—'}</div>
    </div>
  );
}
