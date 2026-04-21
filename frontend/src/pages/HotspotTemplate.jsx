import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Code, Eye, RotateCcw, Save, Download, Info, Smartphone, Monitor } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { apiHotspotTemplate, apiHotspotTemplateSave, apiHotspotTemplateReset } from '../api/client';

const VARS = [
  { v: '$(link-login-only)', d: 'Login form action URL' },
  { v: '$(link-orig)',       d: 'Original destination URL' },
  { v: '$(mac)',             d: 'Client MAC address' },
  { v: '$(ip)',              d: 'Client IP address' },
  { v: '$(error)',           d: 'Login error message' },
  { v: '$(chap-id)',         d: 'CHAP session ID (for MD5 auth)' },
  { v: '$(chap-challenge)',  d: 'CHAP challenge (for MD5 auth)' },
  { v: '$(if chap-id)',      d: 'Conditional block start' },
  { v: '$(if error)',        d: 'Show only when login fails' },
  { v: '$(endif)',           d: 'Conditional block end' },
];

function applyPreviewVars(html) {
  return html
    // Remove conditional blocks entirely in preview (no error, no chap in preview)
    .replace(/\$\(if error\)[\s\S]*?\$\(endif\)/g, '')
    .replace(/\$\(if chap-id\)[\s\S]*?\$\(endif\)/g, '')
    // Replace remaining variables
    .replace(/\$\(link-login-only\)/g, '#')
    .replace(/\$\(link-orig\)/g, '/')
    .replace(/\$\(mac\)/g, 'AA:BB:CC:DD:EE:FF')
    .replace(/\$\(ip\)/g, '192.168.1.100')
    .replace(/\$\(error\)/g, '')
    .replace(/\$\(chap-id\)/g, '1')
    .replace(/\$\(chap-challenge\)/g, 'abc123')
    // Catch-all for any remaining MikroTik conditionals
    .replace(/\$\(if [^)]+\)/g, '')
    .replace(/\$\(endif\)/g, '');
}

// Phone frame dimensions
const PHONE = { w: 390, h: 844 };
const DESKTOP = { w: '100%', h: '100%' };

export default function HotspotTemplate() {
  const [tab, setTab] = useState('editor');
  const [html, setHtml] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [viewMode, setViewMode] = useState('mobile'); // 'mobile' | 'desktop'
  const iframeRef = useRef(null);

  const { data, isLoading } = useQuery({
    queryKey: ['hotspot-template'],
    queryFn: apiHotspotTemplate,
  });

  useEffect(() => {
    if (data?.template && !dirty) setHtml(data.template);
  }, [data]);

  const save = useMutation({
    mutationFn: () => apiHotspotTemplateSave(html),
    onSuccess: () => { setSaved(true); setDirty(false); setTimeout(() => setSaved(false), 3000); },
  });

  const reset = useMutation({
    mutationFn: apiHotspotTemplateReset,
    onSuccess: () => window.location.reload(),
  });

  function updatePreview() {
    const frame = iframeRef.current;
    if (!frame) return;
    const doc = frame.contentDocument;
    if (!doc) return;
    const preview = applyPreviewVars(html);
    doc.open();
    doc.write(preview);
    doc.close();
  }

  useEffect(() => {
    if (tab === 'preview') updatePreview();
  }, [tab, html, viewMode]);

  function insertVar(v) {
    const ta = document.getElementById('hs-template-editor');
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    setHtml(html.slice(0, start) + v + html.slice(end));
    setDirty(true);
    setTimeout(() => {
      ta.selectionStart = ta.selectionEnd = start + v.length;
      ta.focus();
    }, 0);
  }

  function downloadHtml() {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'login.html';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        kicker="Hotspot"
        title={<>Portal <em>Template Editor</em></>}
        subtitle="Edit the captive portal login page shown to WiFi users."
      />

      <div className="px-8 pb-2 flex items-center justify-between gap-4 flex-wrap">
        {/* Tab switcher */}
        <div className="flex items-center gap-1 border border-border-dim rounded-sm p-0.5">
          {[['editor', 'Editor', Code], ['preview', 'Preview', Eye]].map(([k, l, Icon]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider rounded-sm transition-colors ${
                tab === k ? 'bg-amber text-black' : 'text-text-dim hover:text-text'
              }`}>
              <Icon size={12} /> {l}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {/* View mode toggle (only in preview) */}
          {tab === 'preview' && (
            <div className="flex items-center gap-1 border border-border-dim rounded-sm p-0.5">
              <button
                onClick={() => setViewMode('mobile')}
                title="Mobile preview"
                className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono rounded-sm transition-colors ${
                  viewMode === 'mobile' ? 'bg-amber text-black' : 'text-text-dim hover:text-text'
                }`}
              >
                <Smartphone size={12} /> Mobile
              </button>
              <button
                onClick={() => setViewMode('desktop')}
                title="Desktop preview"
                className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono rounded-sm transition-colors ${
                  viewMode === 'desktop' ? 'bg-amber text-black' : 'text-text-dim hover:text-text'
                }`}
              >
                <Monitor size={12} /> Desktop
              </button>
            </div>
          )}

          {data?.is_custom && (
            <button
              onClick={() => { if (confirm('Reset to default template?')) reset.mutate(); }}
              className="flex items-center gap-1 text-xs font-mono text-text-mute hover:text-amber px-2 py-1.5 border border-border-dim rounded-sm"
            >
              <RotateCcw size={12} /> Reset
            </button>
          )}
          <button onClick={downloadHtml} className="flex items-center gap-1 text-xs font-mono text-text-dim hover:text-amber px-2 py-1.5 border border-border-dim rounded-sm">
            <Download size={12} /> Download
          </button>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending || !dirty}
            className={`flex items-center gap-1 text-xs font-mono px-3 py-1.5 rounded-sm transition-colors ${
              saved ? 'bg-green text-black' : dirty ? 'bg-amber text-black' : 'bg-surface2 text-text-mute cursor-not-allowed'
            }`}
          >
            <Save size={12} /> {save.isPending ? 'Saving…' : saved ? 'Saved!' : 'Save Template'}
          </button>
        </div>
      </div>

      {dirty && !saved && (
        <div className="mx-8 mb-2 text-xs font-mono text-amber bg-amber/10 border border-amber/30 rounded px-3 py-1.5">
          ⚠ Unsaved changes — click Save Template to publish
        </div>
      )}
      {save.isError && (
        <div className="mx-8 mb-2 text-xs font-mono text-red bg-red/10 border border-red/30 rounded px-3 py-1.5">
          {save.error?.response?.data?.error || save.error?.message}
        </div>
      )}

      <div className="flex flex-1 gap-4 px-8 pb-8 min-h-0 overflow-hidden">
        {/* Left: Editor or Preview */}
        <div className="flex-1 flex flex-col min-h-0 items-center">
          {isLoading ? (
            <div className="panel flex-1 flex items-center justify-center w-full">
              <span className="text-text-mute font-mono text-sm">Loading template…</span>
            </div>
          ) : tab === 'editor' ? (
            <textarea
              id="hs-template-editor"
              className="w-full flex-1 bg-surface border border-border rounded-sm font-mono text-xs text-text p-4 resize-none focus:outline-none focus:border-amber transition-colors"
              style={{ minHeight: 500 }}
              value={html}
              onChange={e => { setHtml(e.target.value); setDirty(true); }}
              spellCheck={false}
            />
          ) : viewMode === 'mobile' ? (
            /* ── Mobile phone frame ── */
            <div className="flex-1 flex flex-col items-center justify-start overflow-y-auto py-4 w-full">
              {/* Label */}
              <div className="mb-3 text-[10px] font-mono uppercase tracking-widest text-text-mute flex items-center gap-2">
                <Smartphone size={11} />
                Mobile preview — {PHONE.w} × {PHONE.h}
              </div>

              {/* Phone shell */}
              <div
                style={{
                  width: PHONE.w,
                  height: PHONE.h,
                  flexShrink: 0,
                  position: 'relative',
                  background: '#111',
                  borderRadius: 44,
                  border: '3px solid #333',
                  boxShadow: '0 0 0 1px #222, 0 24px 80px rgba(0,0,0,.6), inset 0 0 0 2px #1a1a1a',
                  overflow: 'hidden',
                }}
              >
                {/* Status bar / notch area */}
                <div style={{
                  height: 44,
                  background: 'rgba(0,0,0,0.6)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                  zIndex: 2,
                }}>
                  {/* Notch */}
                  <div style={{
                    width: 120,
                    height: 30,
                    background: '#111',
                    borderRadius: '0 0 18px 18px',
                    position: 'absolute',
                    top: 0,
                    left: '50%',
                    transform: 'translateX(-50%)',
                  }} />
                  {/* Time */}
                  <span style={{ color: '#fff', fontSize: 12, fontFamily: 'monospace', fontWeight: 600, marginLeft: 24 }}>9:41</span>
                  {/* Icons */}
                  <div style={{ position: 'absolute', right: 20, display: 'flex', gap: 5, alignItems: 'center' }}>
                    <span style={{ color: '#fff', fontSize: 10 }}>●●●</span>
                    <span style={{ color: '#fff', fontSize: 10 }}>WiFi</span>
                    <span style={{ color: '#fff', fontSize: 10 }}>🔋</span>
                  </div>
                </div>

                {/* Page content */}
                <iframe
                  ref={iframeRef}
                  title="Portal Preview"
                  style={{
                    width: '100%',
                    height: PHONE.h - 44 - 20,
                    border: 'none',
                    display: 'block',
                    background: '#fff',
                  }}
                  sandbox="allow-same-origin allow-forms allow-scripts"
                />

                {/* Home bar */}
                <div style={{
                  height: 20,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(0,0,0,0.5)',
                }}>
                  <div style={{ width: 120, height: 5, background: '#555', borderRadius: 3 }} />
                </div>
              </div>
            </div>
          ) : (
            /* ── Desktop preview ── */
            <div className="flex-1 border border-border rounded-sm overflow-hidden bg-white w-full">
              <iframe
                ref={iframeRef}
                title="Portal Preview"
                className="w-full h-full"
                sandbox="allow-same-origin allow-forms allow-scripts"
              />
            </div>
          )}
        </div>

        {/* Right: Variable reference + instructions */}
        <div className="w-64 shrink-0 space-y-3 overflow-y-auto">
          <div className="panel p-4">
            <div className="flex items-center gap-2 mb-3">
              <Info size={13} className="text-amber" />
              <span className="text-mono text-[10px] text-text-mute uppercase tracking-wider">MikroTik Variables</span>
            </div>
            <div className="text-xs text-text-mute mb-3">Click to insert at cursor position.</div>
            <div className="space-y-1">
              {VARS.map(({ v, d }) => (
                <button
                  key={v}
                  onClick={() => { setTab('editor'); setTimeout(() => insertVar(v), 50); }}
                  className="w-full text-left group hover:bg-surface2 rounded px-2 py-1.5 transition-colors"
                >
                  <div className="font-mono text-[10px] text-amber">{v}</div>
                  <div className="text-[10px] text-text-mute mt-0.5">{d}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="panel p-4 text-xs text-text-mute space-y-2">
            <div className="font-mono text-[10px] uppercase tracking-wider text-text-dim mb-2">Instructions</div>
            <p>1. Edit HTML in Editor tab</p>
            <p>2. Preview → Mobile/Desktop tab</p>
            <p>3. Click <span className="text-amber font-mono">Save Template</span></p>
            <p>4. Download <code className="bg-surface2 px-1 rounded">login.html</code></p>
            <p>5. Upload to MikroTik flash</p>
            <div className="mt-3 pt-3 border-t border-border-dim">
              <p className="text-amber">MikroTik path:</p>
              <code className="text-[10px] block mt-1">flash/skynity-hotspot/login.html</code>
            </div>
            <div className="mt-3 pt-3 border-t border-border-dim">
              <p className="text-amber mb-1">Packages showing?</p>
              <p>Default template pulls packages from DB automatically. Add packages at <span className="text-text font-mono">/packages</span> page.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
