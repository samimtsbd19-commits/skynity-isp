import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileCode, Upload, Download, Send, Trash2, History, X, Check, AlertCircle,
  Sparkles, Eye,
} from 'lucide-react';
import {
  apiConfigs, apiConfigUpload, apiConfigDelete, apiConfigPush, apiConfigPushes,
  apiConfigDownloadUrl, apiRouters,
  apiGenerateDownload, apiGeneratePreview,
  apiGeneratePcqDownload, apiGeneratePcqPreview,
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
          <div className="flex items-center gap-2">
            <button onClick={() => setUploading(true)} className="btn btn-ghost">
              <Upload size={14} /> Upload file
            </button>
          </div>
        }
      />
      <div className="p-8 space-y-8">
        <GenerateFromPackagesCard />
        <GeneratePcqCard />

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

// ============================================================
// Generate MikroTik artefacts from current packages / settings
// ============================================================
function GenerateFromPackagesCard() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    hotspot_interface: 'bridge-hotspot',
    hotspot_network:   '10.77.0.0/24',
    hotspot_gateway:   '10.77.0.1',
    dns_name:          'wifi.local',
    vps_host:          '',
    vps_ip:            '',
  });
  const [preview, setPreview] = useState(null);
  const [loadingKind, setLoadingKind] = useState(null);
  const [previewTab, setPreviewTab] = useState('rsc');

  const updateField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const cleanParams = () => {
    const out = {};
    for (const [k, v] of Object.entries(form)) {
      if (v !== '' && v != null) out[k] = v;
    }
    return out;
  };

  const download = async (kind) => {
    setLoadingKind(kind);
    try {
      await apiGenerateDownload(kind, cleanParams());
    } catch (err) {
      alert(err?.response?.data?.error || err.message);
    } finally {
      setLoadingKind(null);
    }
  };

  const doPreview = async () => {
    setLoadingKind('preview');
    try {
      const data = await apiGeneratePreview(cleanParams());
      setPreview(data);
    } catch (err) {
      alert(err?.response?.data?.error || err.message);
    } finally {
      setLoadingKind(null);
    }
  };

  return (
    <div className="panel p-6">
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div className="flex-1 min-w-[280px]">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles size={14} className="text-amber" />
            <span className="text-mono text-[10px] text-amber uppercase tracking-wider">Auto-generate</span>
          </div>
          <h3 className="text-display text-2xl italic">
            MikroTik <em>setup files</em>
          </h3>
          <p className="text-text-mute text-sm mt-1 max-w-xl">
            Download a ready-to-import <code className="text-amber">.rsc</code> that configures
            hotspot profiles, PPP profiles, walled-garden and firewall NAT — straight from
            your active packages. Then download a captive-portal <code className="text-amber">login.html</code>
            {' '}that shows the same packages to WiFi users.
          </p>
          <div className="text-xs text-text-mute mt-3 font-mono leading-relaxed">
            <div>1. WinBox → <b className="text-text-dim">Files</b> → drag the .rsc in</div>
            <div>2. New terminal → <code className="text-amber">/import file-name=skynity-setup.rsc</code></div>
            <div>3. Upload <code className="text-amber">login.html</code> to <code className="text-amber">flash/skynity-hotspot/</code></div>
          </div>
        </div>
        <div className="flex flex-col gap-2 min-w-[220px]">
          <button
            onClick={() => download('setup.rsc')}
            disabled={loadingKind === 'setup.rsc'}
            className="btn btn-primary"
          >
            <Download size={13} /> {loadingKind === 'setup.rsc' ? 'Generating…' : 'Download setup.rsc'}
          </button>
          <button
            onClick={() => download('login.html')}
            disabled={loadingKind === 'login.html'}
            className="btn btn-ghost"
          >
            <Download size={13} /> {loadingKind === 'login.html' ? 'Generating…' : 'Download login.html'}
          </button>
          <button
            onClick={() => setOpen((o) => !o)}
            className="btn btn-ghost"
          >
            {open ? 'Hide' : 'Show'} advanced options
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-6 pt-6 border-t border-border-dim grid grid-cols-2 gap-4">
          <Field label="Hotspot interface" value={form.hotspot_interface} onChange={updateField('hotspot_interface')} hint="bridge-hotspot / ether2 / wlan1" />
          <Field label="DNS name" value={form.dns_name} onChange={updateField('dns_name')} hint="wifi.local" />
          <Field label="Hotspot network" value={form.hotspot_network} onChange={updateField('hotspot_network')} hint="10.77.0.0/24" />
          <Field label="Gateway IP" value={form.hotspot_gateway} onChange={updateField('hotspot_gateway')} hint="10.77.0.1" />
          <Field label="VPS hostname" value={form.vps_host} onChange={updateField('vps_host')} hint="auto-detected from settings" />
          <Field label="VPS IP (optional)" value={form.vps_ip} onChange={updateField('vps_ip')} hint="extra walled-garden entry" />
          <div className="col-span-2">
            <button onClick={doPreview} disabled={loadingKind === 'preview'} className="btn btn-ghost">
              <Eye size={13} /> {loadingKind === 'preview' ? 'Loading…' : 'Preview output'}
            </button>
          </div>
        </div>
      )}

      {preview && (
        <div className="mt-6 border border-border-dim rounded-sm overflow-hidden">
          <div className="flex border-b border-border-dim bg-surface2/50">
            <button
              onClick={() => setPreviewTab('rsc')}
              className={`px-4 py-2 text-xs font-mono uppercase tracking-wider ${previewTab === 'rsc' ? 'text-amber border-b-2 border-amber' : 'text-text-mute'}`}
            >
              setup.rsc
            </button>
            <button
              onClick={() => setPreviewTab('html')}
              className={`px-4 py-2 text-xs font-mono uppercase tracking-wider ${previewTab === 'html' ? 'text-amber border-b-2 border-amber' : 'text-text-mute'}`}
            >
              login.html
            </button>
            <button onClick={() => setPreview(null)} className="ml-auto px-4 text-text-mute hover:text-text"><X size={14} /></button>
          </div>
          <pre className="text-[11px] font-mono text-text-dim p-4 bg-background max-h-[400px] overflow-auto whitespace-pre-wrap break-all">
            {previewTab === 'rsc' ? preview.rsc : preview.html}
          </pre>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, hint }) {
  return (
    <label className="block">
      <span className="text-mono text-[10px] text-text-mute uppercase tracking-wider">{label}</span>
      <input className="input mt-1.5" value={value} onChange={onChange} placeholder={hint} />
      {hint && <span className="text-[10px] text-text-mute font-mono mt-1 block">{hint}</span>}
    </label>
  );
}

// ============================================================
// PCQ (shared bandwidth) — auto-generated queue tree .rsc
// ============================================================
function GeneratePcqCard() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    total_download: '',
    total_upload:   '',
    parent_download: '',
    parent_upload:   '',
    mode:            '',
  });
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(null);
  const [err, setErr] = useState('');

  const upd = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const clean = () => {
    const o = {};
    for (const [k, v] of Object.entries(form)) if (v !== '' && v != null) o[k] = v;
    return o;
  };

  const download = async () => {
    setErr(''); setLoading('download');
    try { await apiGeneratePcqDownload(clean()); }
    catch (e) { setErr(e?.response?.data?.error || e.message); }
    finally { setLoading(null); }
  };
  const doPreview = async () => {
    setErr(''); setLoading('preview');
    try { const d = await apiGeneratePcqPreview(clean()); setPreview(d.rsc); }
    catch (e) { setErr(e?.response?.data?.error || e.message); }
    finally { setLoading(null); }
  };

  return (
    <div className="panel p-6">
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div className="flex-1 min-w-[280px]">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles size={14} className="text-amber" />
            <span className="text-mono text-[10px] text-amber uppercase tracking-wider">
              Bandwidth sharing
            </span>
          </div>
          <h3 className="text-display text-2xl italic">PCQ <em>queue tree</em></h3>
          <p className="text-text-mute text-sm mt-1 max-w-xl">
            Auto-generate a RouterOS <code className="text-amber">.rsc</code> that installs a
            Per-Connection-Queue (PCQ) tree. Your link bandwidth is divided <b>fairly among
            active users</b>. Idle users' share is automatically redistributed — no cron,
            no manual tuning. Defaults come from <b>Settings → Provisioning</b>.
          </p>
          <div className="text-xs text-text-mute mt-3 font-mono leading-relaxed">
            <div>1. Download <code className="text-amber">skynity-pcq.rsc</code></div>
            <div>2. WinBox → Files → drag it in → New Terminal:</div>
            <div>&nbsp;&nbsp;&nbsp;<code className="text-amber">/import file-name=skynity-pcq.rsc</code></div>
            <div>3. Watch live throughput: <code className="text-amber">/queue tree print stats</code></div>
          </div>
        </div>
        <div className="flex flex-col gap-2 min-w-[220px]">
          <button
            onClick={download}
            disabled={loading === 'download'}
            className="btn btn-primary"
          >
            <Download size={13} /> {loading === 'download' ? 'Generating…' : 'Download pcq.rsc'}
          </button>
          <button onClick={doPreview} disabled={loading === 'preview'} className="btn btn-ghost">
            <Eye size={13} /> {loading === 'preview' ? 'Loading…' : 'Preview'}
          </button>
          <button onClick={() => setOpen((o) => !o)} className="btn btn-ghost">
            {open ? 'Hide' : 'Override'} defaults
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-6 pt-6 border-t border-border-dim grid grid-cols-2 gap-4">
          <Field label="Total download (Mbit)"  value={form.total_download}  onChange={upd('total_download')}  hint="defaults to Settings → Provisioning" />
          <Field label="Total upload (Mbit)"    value={form.total_upload}    onChange={upd('total_upload')}    hint="defaults to Settings → Provisioning" />
          <Field label="Parent (download)"      value={form.parent_download} onChange={upd('parent_download')} hint="global | ether1 | pppoe-out1" />
          <Field label="Parent (upload)"        value={form.parent_upload}   onChange={upd('parent_upload')}   hint="global | ether1" />
          <label className="block col-span-2">
            <span className="text-mono text-[10px] text-text-mute uppercase tracking-wider">Mode</span>
            <select className="input mt-1.5" value={form.mode} onChange={upd('mode')}>
              <option value="">(default from settings)</option>
              <option value="per_user_equal">Equal share — simplest (pcq-rate=0)</option>
              <option value="per_package">Per-package — cap each tier separately</option>
            </select>
          </label>
        </div>
      )}

      {err && (
        <div className="mt-4 text-red text-xs font-mono px-3 py-2 border border-red/30 bg-red/5 rounded-sm">
          <AlertCircle size={12} className="inline mr-1" />{err}
        </div>
      )}

      {preview && (
        <div className="mt-6 border border-border-dim rounded-sm overflow-hidden">
          <div className="flex items-center border-b border-border-dim bg-surface2/50 px-4 py-2">
            <span className="text-mono text-[11px] text-amber uppercase tracking-wider">pcq.rsc preview</span>
            <button onClick={() => setPreview(null)} className="ml-auto text-text-mute hover:text-text">
              <X size={14} />
            </button>
          </div>
          <pre className="text-[11px] font-mono text-text-dim p-4 bg-background max-h-[400px] overflow-auto whitespace-pre-wrap break-all">
            {preview}
          </pre>
        </div>
      )}
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
