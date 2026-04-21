import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Code, Eye, RotateCcw, Save, Download, Info } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { apiHotspotTemplate, apiHotspotTemplateSave, apiHotspotTemplateReset, apiGenerateDownload } from '../api/client';

const VARS = [
  { v: '$(link-login-only)', d: 'Login form action URL' },
  { v: '$(link-orig)',       d: 'Original destination URL' },
  { v: '$(mac)',             d: 'Client MAC address' },
  { v: '$(ip)',              d: 'Client IP address' },
  { v: '$(error)',           d: 'Login error message' },
  { v: '$(chap-id)',         d: 'CHAP session ID (for MD5 auth)' },
  { v: '$(chap-challenge)',  d: 'CHAP challenge (for MD5 auth)' },
  { v: '$(if chap-id)',      d: 'Conditional block start' },
  { v: '$(endif)',           d: 'Conditional block end' },
];

export default function HotspotTemplate() {
  const [tab, setTab] = useState('editor');
  const [html, setHtml] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const iframeRef = useRef(null);

  const { data, isLoading } = useQuery({
    queryKey: ['hotspot-template'],
    queryFn: apiHotspotTemplate,
  });

  useEffect(() => {
    if (data?.template && !dirty) {
      setHtml(data.template);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () => apiHotspotTemplateSave(html),
    onSuccess: () => { setSaved(true); setDirty(false); setTimeout(() => setSaved(false), 3000); },
  });

  const reset = useMutation({
    mutationFn: apiHotspotTemplateReset,
    onSuccess: (_, __, ctx) => {
      window.location.reload();
    },
  });

  function updatePreview() {
    if (iframeRef.current) {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        const preview = html
          .replace(/\$\(link-login-only\)/g, '#')
          .replace(/\$\(link-orig\)/g, '/')
          .replace(/\$\(mac\)/g, 'AA:BB:CC:DD:EE:FF')
          .replace(/\$\(ip\)/g, '192.168.1.100')
          .replace(/\$\(error\)/g, '')
          .replace(/\$\(if chap-id\)/g, '')
          .replace(/\$\(endif\)/g, '')
          .replace(/\$\(chap-id\)/g, '1')
          .replace(/\$\(chap-challenge\)/g, 'abc123');
        doc.open();
        doc.write(preview);
        doc.close();
      }
    }
  }

  useEffect(() => {
    if (tab === 'preview') updatePreview();
  }, [tab, html]);

  function insertVar(v) {
    const ta = document.getElementById('hs-template-editor');
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const newHtml = html.slice(0, start) + v + html.slice(end);
    setHtml(newHtml);
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
          {[['editor','Editor',Code],['preview','Preview',Eye]].map(([k,l,Icon]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider rounded-sm transition-colors ${
                tab===k ? 'bg-amber text-black' : 'text-text-dim hover:text-text'
              }`}>
              <Icon size={12} /> {l}
            </button>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {data?.is_custom && (
            <button
              onClick={() => { if (confirm('Reset to default template?')) reset.mutate(); }}
              className="flex items-center gap-1 text-xs font-mono text-text-mute hover:text-amber px-2 py-1.5 border border-border-dim rounded-sm"
            >
              <RotateCcw size={12} /> Reset to default
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

      {/* Status bar */}
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
        <div className="flex-1 flex flex-col min-h-0">
          {isLoading ? (
            <div className="panel flex-1 flex items-center justify-center">
              <span className="text-text-mute font-mono text-sm">Loading template…</span>
            </div>
          ) : tab === 'editor' ? (
            <textarea
              id="hs-template-editor"
              className="flex-1 bg-surface border border-border rounded-sm font-mono text-xs text-text p-4 resize-none focus:outline-none focus:border-amber transition-colors"
              style={{ minHeight: 500 }}
              value={html}
              onChange={e => { setHtml(e.target.value); setDirty(true); }}
              spellCheck={false}
            />
          ) : (
            <div className="flex-1 border border-border rounded-sm overflow-hidden bg-white">
              <iframe
                ref={iframeRef}
                title="Portal Preview"
                className="w-full h-full"
                sandbox="allow-same-origin allow-forms"
              />
            </div>
          )}
        </div>

        {/* Right: Variable reference */}
        <div className="w-64 shrink-0 space-y-3">
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
                  <div className="font-mono text-[10px] text-amber group-hover:text-amber">{v}</div>
                  <div className="text-[10px] text-text-mute mt-0.5">{d}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="panel p-4 text-xs text-text-mute space-y-2">
            <div className="font-mono text-[10px] uppercase tracking-wider text-text-dim mb-2">Instructions</div>
            <p>1. Edit HTML in Editor tab</p>
            <p>2. Preview in Preview tab</p>
            <p>3. Click <span className="text-amber font-mono">Save Template</span> to publish</p>
            <p>4. Download <code className="bg-surface2 px-1 rounded">login.html</code> and upload to MikroTik flash</p>
            <div className="mt-3 pt-3 border-t border-border-dim">
              <p className="text-amber">MikroTik path:</p>
              <code className="text-[10px] block mt-1">flash/skynity-hotspot/login.html</code>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
