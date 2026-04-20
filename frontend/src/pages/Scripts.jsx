import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Terminal, Play, Plus, Trash2, Save, X, Check } from 'lucide-react';
import {
  apiScripts, apiScript, apiScriptCreate, apiScriptUpdate, apiScriptDelete,
  apiScriptExecute, apiScriptInlineExecute, apiScriptExecutions, apiRouters,
} from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { Skeleton, EmptyState, ConfirmButton } from '../components/primitives';

export default function Scripts() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(null);
  const [inline, setInline] = useState(false);

  const { data: scripts, isLoading } = useQuery({
    queryKey: ['scripts'], queryFn: apiScripts,
  });
  const { data: executions = [] } = useQuery({
    queryKey: ['scripts.exec'], queryFn: () => apiScriptExecutions({ limit: 20 }),
    refetchInterval: 10_000,
  });
  const { data: routers = [] } = useQuery({ queryKey: ['routers'], queryFn: apiRouters });

  const del = useMutation({
    mutationFn: apiScriptDelete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scripts'] }),
  });

  return (
    <div>
      <PageHeader
        kicker="Automation"
        title={<>Router <em>scripts</em></>}
        subtitle="Store reusable RouterOS scripts and run them on any router. Every execution is logged."
        actions={
          <div className="flex gap-2">
            <button onClick={() => setInline(true)} className="btn btn-ghost">
              <Terminal size={14} /> Inline command
            </button>
            <button onClick={() => setEditing({})} className="btn btn-primary">
              <Plus size={14} /> New script
            </button>
          </div>
        }
      />
      <div className="p-8 grid gap-6">
        {inline && <InlineRunner routers={routers} onClose={() => setInline(false)} />}
        {editing && (
          <ScriptEditor
            scriptId={editing.id}
            routers={routers}
            onClose={() => setEditing(null)}
          />
        )}

        <section>
          <h2 className="text-display text-xl italic mb-3">Library</h2>
          {isLoading ? (
            <Skeleton className="h-16" />
          ) : !scripts?.length ? (
            <div className="panel"><EmptyState title="No saved scripts" icon={Terminal} /></div>
          ) : (
            <div className="grid gap-2">
              {scripts.map((s) => (
                <div key={s.id} className="panel p-4 flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-display text-lg italic">{s.name}</span>
                      {!s.is_active && <span className="tag tag-dim">inactive</span>}
                      {s.tags && <span className="text-[11px] font-mono text-text-mute">#{s.tags}</span>}
                    </div>
                    {s.description && <div className="text-[12px] text-text-mute mt-1">{s.description}</div>}
                    <pre className="mt-2 text-[11px] font-mono text-text-dim truncate max-w-3xl">{s.source_preview}</pre>
                  </div>
                  <div className="flex gap-1">
                    <RunButton scriptId={s.id} routers={routers} />
                    <button onClick={() => setEditing({ id: s.id })} className="btn btn-ghost"><Save size={13} /></button>
                    <ConfirmButton variant="danger" confirmText="Delete?" onConfirm={() => del.mutate(s.id)}>
                      <Trash2 size={13} />
                    </ConfirmButton>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-display text-xl italic mb-3">Recent executions</h2>
          <div className="panel">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b border-border-dim text-text-mute">
                  <th className="text-left px-3 py-2">When</th>
                  <th className="text-left px-3 py-2">Router</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Preview</th>
                </tr>
              </thead>
              <tbody>
                {executions.map((e) => (
                  <tr key={e.id} className="border-b border-border-dim">
                    <td className="px-3 py-2 text-text-dim">{new Date(e.started_at).toLocaleString()}</td>
                    <td className="px-3 py-2">#{e.router_id}</td>
                    <td className="px-3 py-2">
                      <span className={`tag ${e.status === 'success' ? 'tag-green' : e.status === 'failed' ? 'tag-red' : 'tag-amber'}`}>
                        {e.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-text-mute truncate max-w-[500px]">
                      {e.error_message || e.source_preview}
                    </td>
                  </tr>
                ))}
                {!executions.length && (
                  <tr><td colSpan={4} className="px-3 py-6 text-center text-text-mute">No executions yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function RunButton({ scriptId, routers }) {
  const [open, setOpen] = useState(false);
  const [routerId, setRouterId] = useState('');
  const [result, setResult] = useState(null);
  const run = useMutation({
    mutationFn: () => apiScriptExecute(scriptId, Number(routerId)),
    onSuccess: (d) => setResult({ ok: true, d }),
    onError: (e) => setResult({ ok: false, error: e?.response?.data?.error || e.message }),
  });

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn btn-primary" title="Run">
        <Play size={13} />
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
      <div className="panel p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-display text-xl italic">Run script</h3>
          <button onClick={() => setOpen(false)} className="text-text-mute hover:text-text"><X size={16} /></button>
        </div>
        <select className="input mb-3" value={routerId} onChange={(e) => setRouterId(e.target.value)}>
          <option value="">— choose router —</option>
          {routers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        {result?.ok && (
          <pre className="panel p-3 text-[11px] text-text-dim max-h-60 overflow-auto mb-3">
            {JSON.stringify(result.d, null, 2)}
          </pre>
        )}
        {result?.ok === false && (
          <div className="text-red text-xs font-mono mb-3">{result.error}</div>
        )}
        <button onClick={() => run.mutate()} className="btn btn-primary" disabled={!routerId || run.isPending}>
          <Play size={13} /> {run.isPending ? 'Running…' : 'Execute now'}
        </button>
      </div>
    </div>
  );
}

function ScriptEditor({ scriptId, routers, onClose }) {
  const qc = useQueryClient();
  const { data: existing } = useQuery({
    queryKey: ['script', scriptId], queryFn: () => apiScript(scriptId), enabled: !!scriptId,
  });
  const [form, setForm] = useState({
    name: '', description: '', source: '', policy: 'read,write,policy,test', tags: '',
  });
  const [err, setErr] = useState('');

  useEffect(() => {
    if (existing) {
      setForm({
        name: existing.name || '',
        description: existing.description || '',
        source: existing.source || '',
        policy: existing.policy || 'read,write,policy,test',
        tags: existing.tags || '',
      });
    }
  }, [existing]);

  const save = useMutation({
    mutationFn: () => scriptId ? apiScriptUpdate(scriptId, form) : apiScriptCreate(form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['scripts'] }); onClose(); },
    onError: (e) => setErr(e?.response?.data?.error || e.message),
  });

  const up = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="panel p-6 animate-fade-up">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-display text-2xl italic">{scriptId ? 'Edit script' : 'New script'}</h3>
        <button onClick={onClose} className="text-text-mute hover:text-text"><X size={16} /></button>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Name"><input className="input" value={form.name} onChange={up('name')} required /></Field>
        <Field label="Tags (comma)"><input className="input" value={form.tags} onChange={up('tags')} /></Field>
        <Field label="Description" full>
          <input className="input" value={form.description} onChange={up('description')} />
        </Field>
        <Field label="Policy"><input className="input" value={form.policy} onChange={up('policy')} /></Field>
        <div />
        <div className="col-span-2">
          <span className="text-mono text-[10px] text-text-mute uppercase tracking-wider">RouterOS source</span>
          <textarea
            className="input font-mono text-[12px] mt-1.5"
            rows={12}
            value={form.source}
            onChange={up('source')}
            placeholder={`:log info "hello"\n/system identity print`}
            required
          />
        </div>

        {err && (
          <div className="col-span-2 text-red text-sm font-mono px-3 py-2 border border-red/40 bg-red/5 rounded-sm">{err}</div>
        )}
        <div className="col-span-2 flex gap-2 pt-2">
          <button onClick={() => save.mutate()} className="btn btn-primary" disabled={save.isPending}>
            <Save size={13} /> {save.isPending ? 'Saving…' : 'Save'}
          </button>
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
        </div>
      </div>
    </div>
  );
}

function InlineRunner({ routers, onClose }) {
  const [routerId, setRouterId] = useState('');
  const [source, setSource] = useState('/system resource print');
  const [result, setResult] = useState(null);

  const run = useMutation({
    mutationFn: () => apiScriptInlineExecute(Number(routerId), source),
    onSuccess: (d) => setResult({ ok: true, d }),
    onError: (e) => setResult({ ok: false, error: e?.response?.data?.error || e.message }),
  });

  return (
    <div className="panel p-6 animate-fade-up">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-display text-2xl italic">Inline RouterOS command</h3>
        <button onClick={onClose} className="text-text-mute hover:text-text"><X size={16} /></button>
      </div>
      <select className="input mb-3" value={routerId} onChange={(e) => setRouterId(e.target.value)}>
        <option value="">— choose router —</option>
        {routers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      <textarea
        className="input font-mono text-[12px]"
        rows={6}
        value={source}
        onChange={(e) => setSource(e.target.value)}
      />
      <div className="mt-3 flex gap-2">
        <button onClick={() => run.mutate()} className="btn btn-primary" disabled={!routerId || run.isPending}>
          <Play size={13} /> {run.isPending ? 'Running…' : 'Run once'}
        </button>
        <button onClick={onClose} className="btn btn-ghost">Close</button>
      </div>
      {result?.ok && (
        <pre className="panel p-3 mt-3 text-[11px] text-text-dim max-h-60 overflow-auto">
          {JSON.stringify(result.d, null, 2)}
        </pre>
      )}
      {result?.ok === false && <div className="text-red text-xs font-mono mt-2">{result.error}</div>}
    </div>
  );
}

function Field({ label, children, full }) {
  return (
    <label className={`block ${full ? 'col-span-2' : ''}`}>
      <span className="text-mono text-[10px] text-text-mute uppercase tracking-wider">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
