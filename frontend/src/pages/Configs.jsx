import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileCode, Upload, Download, Send, Trash2, History, X, Check, AlertCircle,
} from 'lucide-react';
import {
  apiConfigs, apiConfigUpload, apiConfigDelete, apiConfigPush, apiConfigPushes,
  apiConfigDownloadUrl, apiRouters,
} from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { Skeleton, EmptyState, ConfirmButton } from '../components/primitives';

const fmtBytes = (n) => {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${u[i]}`;
};

export default function Configs() {
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [historyFor, setHistoryFor] = useState(null);

  const { data: configs, isLoading } = useQuery({
    queryKey: ['configs'], queryFn: apiConfigs,
  });
  const { data: routers = [] } = useQuery({
    queryKey: ['routers'], queryFn: apiRouters,
  });

  const del = useMutation({
    mutationFn: apiConfigDelete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['configs'] }),
  });

  return (
    <div>
      <PageHeader
        kicker="VPS → MikroTik"
        title={<>Config <em>files</em></>}
        subtitle="Upload RouterOS .rsc / .backup / .conf files here. Push them to any router via REST — no Winbox needed."
        actions={
          <button onClick={() => setUploading(true)} className="btn btn-primary">
            <Upload size={14} /> Upload file
          </button>
        }
      />
      <div className="p-8">
        {uploading && <UploadForm onClose={() => setUploading(false)} />}

        {isLoading ? (
          <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-16" />)}</div>
        ) : !configs?.length ? (
          <div className="panel"><EmptyState title="No configs uploaded yet" icon={FileCode} hint="Upload a .rsc script or .backup file to get started." /></div>
        ) : (
          <div className="panel">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-dim text-mono text-[10px] text-text-mute uppercase tracking-wider">
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-left px-4 py-3">Type</th>
                  <th className="text-left px-4 py-3">Size</th>
                  <th className="text-left px-4 py-3">Downloads</th>
                  <th className="text-left px-4 py-3">Uploaded</th>
                  <th className="text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {configs.map((c) => (
                  <tr key={c.id} className="border-b border-border-dim hover:bg-surface2/30">
                    <td className="px-4 py-3">
                      <div className="font-mono text-text">{c.name}</div>
                      {c.description && <div className="text-text-mute text-[11px] mt-0.5">{c.description}</div>}
                    </td>
                    <td className="px-4 py-3"><span className="tag tag-cyan">{c.file_type}</span></td>
                    <td className="px-4 py-3 font-mono text-text-dim">{fmtBytes(c.file_size)}</td>
                    <td className="px-4 py-3 font-mono text-text-dim">{c.download_count}</td>
                    <td className="px-4 py-3 font-mono text-[11px] text-text-mute">
                      {new Date(c.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <a href={apiConfigDownloadUrl(c.id)} className="btn btn-ghost" title="Download to browser">
                          <Download size={13} />
                        </a>
                        <PushButton config={c} routers={routers} />
                        <button onClick={() => setHistoryFor(c)} className="btn btn-ghost" title="Push history">
                          <History size={13} />
                        </button>
                        <ConfirmButton
                          variant="danger"
                          confirmText="Delete?"
                          onConfirm={() => del.mutate(c.id)}
                        >
                          <Trash2 size={13} />
                        </ConfirmButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {historyFor && <PushHistoryModal cfg={historyFor} onClose={() => setHistoryFor(null)} />}
      </div>
    </div>
  );
}

function PushButton({ config, routers }) {
  const [open, setOpen] = useState(false);
  const [routerId, setRouterId] = useState('');
  const [runImport, setRunImport] = useState(true);
  const [result, setResult] = useState(null);

  const push = useMutation({
    mutationFn: () => apiConfigPush(config.id, Number(routerId), runImport),
    onSuccess: (data) => setResult({ ok: true, data }),
    onError: (err) => setResult({ ok: false, error: err?.response?.data?.error || err.message }),
  });

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn btn-ghost" title="Push to MikroTik">
        <Send size={13} />
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
      <div className="panel p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-display text-xl italic">Push to MikroTik</h3>
          <button onClick={() => setOpen(false)} className="text-text-mute hover:text-text"><X size={16} /></button>
        </div>
        <div className="text-xs font-mono text-text-mute mb-4">
          File: <span className="text-text-dim">{config.name}</span>
        </div>
        <label className="block mb-3">
          <span className="text-mono text-[10px] text-text-mute uppercase tracking-wider">Target router</span>
          <select
            className="input mt-1.5"
            value={routerId}
            onChange={(e) => setRouterId(e.target.value)}
          >
            <option value="">— choose —</option>
            {routers.map((r) => (
              <option key={r.id} value={r.id}>{r.name} · {r.host}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-text-dim mb-4">
          <input type="checkbox" checked={runImport} onChange={(e) => setRunImport(e.target.checked)} />
          Run <code className="text-amber">/import</code> after upload (for .rsc)
        </label>
        {result?.ok && (
          <div className="text-green text-xs font-mono px-3 py-2 border border-green/30 bg-green/5 rounded-sm mb-3">
            <Check size={12} className="inline mr-1" />
            Pushed successfully (status: {result.data.status})
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
            onClick={() => push.mutate()}
            disabled={!routerId || push.isPending}
            className="btn btn-primary"
          >
            <Send size={13} /> {push.isPending ? 'Pushing…' : 'Push now'}
          </button>
          <button onClick={() => setOpen(false)} className="btn btn-ghost">Close</button>
        </div>
      </div>
    </div>
  );
}

function UploadForm({ onClose }) {
  const qc = useQueryClient();
  const fileRef = useRef(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [fileType, setFileType] = useState('rsc');
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState('');

  const up = useMutation({
    mutationFn: (fd) => apiConfigUpload(fd, (e) => {
      setProgress(Math.round((e.loaded / (e.total || 1)) * 100));
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['configs'] }); onClose(); },
    onError: (e) => setErr(e?.response?.data?.error || e.message),
  });

  const submit = (e) => {
    e.preventDefault();
    if (!fileRef.current?.files?.[0]) { setErr('choose a file'); return; }
    const fd = new FormData();
    fd.append('file', fileRef.current.files[0]);
    if (name) fd.append('name', name);
    if (description) fd.append('description', description);
    fd.append('file_type', fileType);
    up.mutate(fd);
  };

  return (
    <div className="panel p-6 mb-6 animate-fade-up">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-display text-2xl italic">Upload config</h3>
        <button onClick={onClose} className="text-text-mute hover:text-text"><X size={16} /></button>
      </div>
      <form onSubmit={submit} className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <span className="text-mono text-[10px] text-text-mute uppercase tracking-wider">File</span>
          <input type="file" ref={fileRef} className="input mt-1.5" required />
        </div>
        <label className="block">
          <span className="text-mono text-[10px] text-text-mute uppercase tracking-wider">Type</span>
          <select className="input mt-1.5" value={fileType} onChange={(e) => setFileType(e.target.value)}>
            <option value="rsc">.rsc (script)</option>
            <option value="backup">.backup</option>
            <option value="conf">.conf</option>
            <option value="script">script/txt</option>
            <option value="other">other</option>
          </select>
        </label>
        <label className="block">
          <span className="text-mono text-[10px] text-text-mute uppercase tracking-wider">Display name (optional)</span>
          <input className="input mt-1.5" value={name} onChange={(e) => setName(e.target.value)} placeholder="auto = original filename" />
        </label>
        <label className="block col-span-2">
          <span className="text-mono text-[10px] text-text-mute uppercase tracking-wider">Description</span>
          <input className="input mt-1.5" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>

        {up.isPending && (
          <div className="col-span-2">
            <div className="h-1 bg-surface2 rounded-sm overflow-hidden">
              <div className="h-full bg-amber transition-all" style={{ width: `${progress}%` }} />
            </div>
            <div className="text-mono text-[11px] text-text-mute mt-1">{progress}%</div>
          </div>
        )}
        {err && (
          <div className="col-span-2 text-red text-sm font-mono px-3 py-2 border border-red/40 bg-red/5 rounded-sm">
            {err}
          </div>
        )}

        <div className="col-span-2 flex gap-2 pt-2">
          <button type="submit" className="btn btn-primary" disabled={up.isPending}>
            <Upload size={14} /> {up.isPending ? 'Uploading…' : 'Upload'}
          </button>
          <button type="button" onClick={onClose} className="btn btn-ghost">Cancel</button>
        </div>
      </form>
    </div>
  );
}

function PushHistoryModal({ cfg, onClose }) {
  const { data: pushes = [] } = useQuery({
    queryKey: ['configPushes', cfg.id],
    queryFn: () => apiConfigPushes(cfg.id),
  });
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="panel p-6 w-full max-w-2xl max-h-[80vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-display text-xl italic">Push history — {cfg.name}</h3>
          <button onClick={onClose} className="text-text-mute hover:text-text"><X size={16} /></button>
        </div>
        {!pushes.length ? (
          <EmptyState title="No pushes yet" icon={History} />
        ) : (
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="border-b border-border-dim text-text-mute">
                <th className="text-left py-2">When</th>
                <th className="text-left py-2">Router</th>
                <th className="text-left py-2">Status</th>
                <th className="text-left py-2">Detail</th>
              </tr>
            </thead>
            <tbody>
              {pushes.map((p) => (
                <tr key={p.id} className="border-b border-border-dim">
                  <td className="py-2 text-text-dim">{new Date(p.started_at).toLocaleString()}</td>
                  <td className="py-2">{p.router_name}</td>
                  <td className="py-2">
                    <span className={`tag ${p.status === 'success' ? 'tag-green' : p.status === 'failed' ? 'tag-red' : 'tag-amber'}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="py-2 text-text-mute text-[11px] truncate max-w-[200px]">
                    {p.error_message || p.remote_path || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
