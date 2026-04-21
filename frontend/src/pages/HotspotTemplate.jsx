import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Code, Eye, RotateCcw, Save, Download, Info, Smartphone, Monitor,
  Palette, Type, Image, AlignCenter, AlignLeft, AlignRight, Upload,
  RefreshCw, Wand2,
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import {
  apiHotspotTemplate, apiHotspotTemplateSave, apiHotspotTemplateReset,
  apiHotspotVisualSettings, apiHotspotVisualSave, apiHotspotGenerate,
  apiHotspotLogoUpload,
} from '../api/client';

// ── MikroTik variable reference ──────────────────────────────
const VARS = [
  { v: '$(link-login-only)', d: 'Login form action URL' },
  { v: '$(link-orig)',       d: 'Original destination URL' },
  { v: '$(mac)',             d: 'Client MAC address' },
  { v: '$(ip)',              d: 'Client IP address' },
  { v: '$(error)',           d: 'Login error message' },
  { v: '$(if error)',        d: 'Show block when login fails' },
  { v: '$(if chap-id)',      d: 'Show block when CHAP active' },
  { v: '$(endif)',           d: 'End conditional block' },
];

const FONTS = [
  { label: 'System UI',  value: 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif' },
  { label: 'Inter',      value: '"Inter",sans-serif' },
  { label: 'Roboto',     value: '"Roboto",sans-serif' },
  { label: 'Open Sans',  value: '"Open Sans",sans-serif' },
  { label: 'Poppins',    value: '"Poppins",sans-serif' },
  { label: 'Noto Sans Bengali', value: '"Noto Sans Bengali","Noto Sans",sans-serif' },
  { label: 'Monospace',  value: '"Courier New",monospace' },
];

// Replace MikroTik variables for preview
function applyPreviewVars(html) {
  return html
    .replace(/\$\(if error\)[\s\S]*?\$\(endif\)/g, '')
    .replace(/\$\(if chap-id\)[\s\S]*?\$\(endif\)/g, '')
    .replace(/\$\(link-login-only\)/g, '#')
    .replace(/\$\(link-orig\)/g, '/')
    .replace(/\$\(mac\)/g, 'AA:BB:CC:DD:EE:FF')
    .replace(/\$\(ip\)/g, '192.168.1.100')
    .replace(/\$\(error\)/g, '')
    .replace(/\$\(chap-id\)/g, '1')
    .replace(/\$\(chap-challenge\)/g, 'abc123')
    .replace(/\$\(if [^)]+\)/g, '')
    .replace(/\$\(endif\)/g, '');
}

// Default visual settings
const DEFAULT_VISUAL = {
  'site.name': 'Skynity ISP',
  'portal.tagline': 'Choose a package below, or log in if you already have an account.',
  'branding.primary_color': '#f59e0b',
  'portal.bg_color': '#0b0b0d',
  'portal.card_bg': '#16161a',
  'portal.text_color': '#e7e7e9',
  'portal.font_size': '14',
  'portal.font_family': 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
  'branding.logo_url': '',
  'portal.logo_position': 'center',
  'portal.login_title': 'Already have an account? Log in',
  'site.support_phone': '',
  'site.currency_symbol': '৳',
  'portal.border_radius': '12',
  'portal.dark_mode': 'true',
};

// ── Small reusable form components ───────────────────────────
function Section({ icon: Icon, title, children }) {
  return (
    <div className="border border-border-dim rounded-sm overflow-hidden mb-3">
      <div className="flex items-center gap-2 px-3 py-2 bg-surface2 border-b border-border-dim">
        <Icon size={12} className="text-amber" />
        <span className="text-mono text-[10px] uppercase tracking-wider text-text-mute">{title}</span>
      </div>
      <div className="p-3 space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[10px] font-mono text-text-mute uppercase tracking-wider mb-1">{label}</label>
      {children}
    </div>
  );
}

function ColorField({ label, value, onChange }) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value || '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="w-8 h-8 rounded cursor-pointer border border-border-dim bg-transparent p-0.5"
        />
        <input
          type="text"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 input text-xs py-1.5 font-mono"
          placeholder="#rrggbb"
        />
      </div>
    </Field>
  );
}

// ── Phone frame preview ───────────────────────────────────────
function PhoneFrame({ iframeRef }) {
  return (
    <div className="flex flex-col items-center justify-start overflow-y-auto py-4 w-full flex-1">
      <div className="mb-3 text-[10px] font-mono uppercase tracking-widest text-text-mute flex items-center gap-2">
        <Smartphone size={11} /> Mobile preview — 390 × 844
      </div>
      <div style={{
        width: 390, height: 844, flexShrink: 0, position: 'relative',
        background: '#111', borderRadius: 44,
        border: '3px solid #333',
        boxShadow: '0 0 0 1px #222, 0 24px 80px rgba(0,0,0,.6), inset 0 0 0 2px #1a1a1a',
        overflow: 'hidden',
      }}>
        {/* Status bar */}
        <div style={{ height: 44, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', position: 'relative', zIndex: 2 }}>
          <div style={{ width: 120, height: 30, background: '#111', borderRadius: '0 0 18px 18px', position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)' }} />
          <span style={{ color: '#fff', fontSize: 12, fontFamily: 'monospace', fontWeight: 600, marginLeft: 20 }}>9:41</span>
          <span style={{ position: 'absolute', right: 16, color: '#fff', fontSize: 10 }}>●●● WiFi 🔋</span>
        </div>
        {/* Content */}
        <iframe ref={iframeRef} title="Portal Preview" style={{ width: '100%', height: 780, border: 'none', display: 'block', background: '#fff' }} sandbox="allow-same-origin allow-forms allow-scripts" />
        {/* Home bar */}
        <div style={{ height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }}>
          <div style={{ width: 120, height: 5, background: '#555', borderRadius: 3 }} />
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
export default function HotspotTemplate() {
  const [tab, setTab] = useState('visual');          // visual | editor | preview
  const [viewMode, setViewMode] = useState('mobile'); // mobile | desktop
  const [html, setHtml] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [visual, setVisual] = useState(DEFAULT_VISUAL);
  const [visualDirty, setVisualDirty] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoPreview, setLogoPreview] = useState('');
  const iframeRef = useRef(null);
  const logoInputRef = useRef(null);
  const previewTimerRef = useRef(null);

  // ── Queries ──────────────────────────────────────────────────
  const { data: tplData, isLoading: tplLoading } = useQuery({
    queryKey: ['hotspot-template'],
    queryFn: apiHotspotTemplate,
  });
  const { data: visualData, isLoading: visualLoading } = useQuery({
    queryKey: ['hotspot-visual-settings'],
    queryFn: apiHotspotVisualSettings,
  });

  useEffect(() => {
    if (tplData?.template && !dirty) setHtml(tplData.template);
  }, [tplData]);

  useEffect(() => {
    if (visualData && !visualDirty) {
      const merged = { ...DEFAULT_VISUAL };
      for (const [k, v] of Object.entries(visualData)) {
        if (v !== null && v !== undefined && v !== '') merged[k] = String(v);
      }
      setVisual(merged);
      setLogoPreview(merged['branding.logo_url'] || '');
    }
  }, [visualData]);

  // ── Mutations ────────────────────────────────────────────────
  const saveTemplate = useMutation({
    mutationFn: () => apiHotspotTemplateSave(html),
    onSuccess: () => { setSaved(true); setDirty(false); setTimeout(() => setSaved(false), 3000); },
  });
  const resetTemplate = useMutation({
    mutationFn: apiHotspotTemplateReset,
    onSuccess: () => window.location.reload(),
  });
  const saveVisual = useMutation({
    mutationFn: () => apiHotspotVisualSave(visual),
    onSuccess: () => { setVisualDirty(false); },
  });

  // ── Visual setting helper ────────────────────────────────────
  function setV(key, value) {
    setVisual((prev) => ({ ...prev, [key]: value }));
    setVisualDirty(true);
  }

  // ── Preview update ───────────────────────────────────────────
  function writeToFrame(htmlContent) {
    const frame = iframeRef.current;
    if (!frame) return;
    const doc = frame.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(applyPreviewVars(htmlContent));
    doc.close();
  }

  // Debounced live preview from visual settings
  const refreshPreviewFromVisual = useCallback(async () => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewTimerRef.current = setTimeout(async () => {
      try {
        const opts = {
          siteName:       visual['site.name'],
          tagline:        visual['portal.tagline'],
          primaryColor:   visual['branding.primary_color'],
          bgColor:        visual['portal.bg_color'],
          cardBg:         visual['portal.card_bg'],
          textColor:      visual['portal.text_color'],
          fontSize:       visual['portal.font_size'],
          fontFamily:     visual['portal.font_family'],
          logoUrl:        visual['branding.logo_url'],
          logoPosition:   visual['portal.logo_position'],
          loginTitle:     visual['portal.login_title'],
          supportPhone:   visual['site.support_phone'],
          currencySymbol: visual['site.currency_symbol'],
          borderRadius:   visual['portal.border_radius'],
          darkMode:       visual['portal.dark_mode'] !== 'false',
        };
        const generated = await apiHotspotGenerate(opts);
        writeToFrame(generated);
      } catch {
        // silently skip
      }
    }, 600);
  }, [visual]);

  // Trigger preview refresh when visual settings change (only in preview tab)
  useEffect(() => {
    if (tab === 'preview' || tab === 'visual') refreshPreviewFromVisual();
  }, [visual, tab]);

  // For raw editor tab, update preview from html
  useEffect(() => {
    if (tab === 'preview' && html) writeToFrame(html);
  }, [tab, html]);

  // ── Logo upload ──────────────────────────────────────────────
  async function handleLogoFile(file) {
    if (!file) return;
    setLogoUploading(true);
    try {
      const res = await apiHotspotLogoUpload(file);
      setV('branding.logo_url', res.url);
      setLogoPreview(res.url);
    } catch (err) {
      alert('Logo upload failed: ' + err.message);
    } finally {
      setLogoUploading(false);
    }
  }

  // ── Generate & apply to editor ───────────────────────────────
  async function generateAndApply() {
    setGenerating(true);
    try {
      const opts = {
        siteName:       visual['site.name'],
        tagline:        visual['portal.tagline'],
        primaryColor:   visual['branding.primary_color'],
        bgColor:        visual['portal.bg_color'],
        cardBg:         visual['portal.card_bg'],
        textColor:      visual['portal.text_color'],
        fontSize:       visual['portal.font_size'],
        fontFamily:     visual['portal.font_family'],
        logoUrl:        visual['branding.logo_url'],
        logoPosition:   visual['portal.logo_position'],
        loginTitle:     visual['portal.login_title'],
        supportPhone:   visual['site.support_phone'],
        currencySymbol: visual['site.currency_symbol'],
        borderRadius:   visual['portal.border_radius'],
        darkMode:       visual['portal.dark_mode'] !== 'false',
      };
      if (visualDirty) await saveVisual.mutateAsync();
      const generated = await apiHotspotGenerate(opts);
      setHtml(generated);
      setDirty(true);
      await apiHotspotTemplateSave(generated);
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      alert('Generate failed: ' + err.message);
    } finally {
      setGenerating(false);
    }
  }

  // ── Editor insert var ────────────────────────────────────────
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

  const isLoading = tplLoading || visualLoading;

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col">
      <PageHeader
        kicker="Hotspot"
        title={<>Portal <em>Template Editor</em></>}
        subtitle="Customize the captive portal login page shown to WiFi users."
      />

      {/* ── Toolbar ── */}
      <div className="px-8 pb-2 flex items-center justify-between gap-4 flex-wrap">
        {/* Tab switcher */}
        <div className="flex items-center gap-1 border border-border-dim rounded-sm p-0.5">
          {[
            ['visual',   'Visual',   Wand2],
            ['editor',   'HTML',     Code],
            ['preview',  'Preview',  Eye],
          ].map(([k, l, Icon]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider rounded-sm transition-colors ${
                tab === k ? 'bg-amber text-black' : 'text-text-dim hover:text-text'
              }`}>
              <Icon size={12} /> {l}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* View mode (preview only) */}
          {tab === 'preview' && (
            <div className="flex items-center gap-1 border border-border-dim rounded-sm p-0.5">
              <button onClick={() => setViewMode('mobile')} className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-mono rounded-sm ${viewMode === 'mobile' ? 'bg-amber text-black' : 'text-text-dim hover:text-text'}`}><Smartphone size={11} /> Mobile</button>
              <button onClick={() => setViewMode('desktop')} className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-mono rounded-sm ${viewMode === 'desktop' ? 'bg-amber text-black' : 'text-text-dim hover:text-text'}`}><Monitor size={11} /> Desktop</button>
            </div>
          )}

          {/* Visual: Generate & Save */}
          {tab === 'visual' && (
            <button
              onClick={generateAndApply}
              disabled={generating}
              className="flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 bg-amber text-black rounded-sm hover:opacity-90 disabled:opacity-50"
            >
              <RefreshCw size={12} className={generating ? 'animate-spin' : ''} />
              {generating ? 'Generating…' : 'Generate & Save'}
            </button>
          )}

          {/* Editor: save */}
          {tab === 'editor' && (
            <>
              {tplData?.is_custom && (
                <button onClick={() => { if (confirm('Reset to default?')) resetTemplate.mutate(); }}
                  className="flex items-center gap-1 text-xs font-mono text-text-mute hover:text-amber px-2 py-1.5 border border-border-dim rounded-sm">
                  <RotateCcw size={12} /> Reset
                </button>
              )}
              <button onClick={downloadHtml} className="flex items-center gap-1 text-xs font-mono text-text-dim hover:text-amber px-2 py-1.5 border border-border-dim rounded-sm">
                <Download size={12} /> Download
              </button>
              <button
                onClick={() => saveTemplate.mutate()}
                disabled={saveTemplate.isPending || !dirty}
                className={`flex items-center gap-1 text-xs font-mono px-3 py-1.5 rounded-sm transition-colors ${
                  saved ? 'bg-green text-black' : dirty ? 'bg-amber text-black' : 'bg-surface2 text-text-mute cursor-not-allowed'
                }`}
              >
                <Save size={12} /> {saveTemplate.isPending ? 'Saving…' : saved ? 'Saved!' : 'Save Template'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Status bars */}
      {dirty && tab === 'editor' && !saved && (
        <div className="mx-8 mb-2 text-xs font-mono text-amber bg-amber/10 border border-amber/30 rounded px-3 py-1.5">⚠ Unsaved changes</div>
      )}
      {saved && (
        <div className="mx-8 mb-2 text-xs font-mono text-green bg-green/10 border border-green/30 rounded px-3 py-1.5">✓ Template saved successfully</div>
      )}

      {/* ── Body ── */}
      <div className="flex flex-1 gap-4 px-8 pb-8 min-h-0 overflow-hidden">

        {/* ── VISUAL TAB ── */}
        {tab === 'visual' && (
          <>
            {/* Left: settings panel */}
            <div className="w-72 shrink-0 overflow-y-auto space-y-0 pr-1">
              {isLoading ? (
                <div className="text-text-mute text-sm font-mono mt-8 text-center">Loading…</div>
              ) : (
                <>
                  {/* Branding */}
                  <Section icon={Image} title="Branding">
                    <Field label="Site Name">
                      <input className="input text-xs py-1.5 w-full" value={visual['site.name']} onChange={e => setV('site.name', e.target.value)} />
                    </Field>
                    <Field label="Tagline">
                      <textarea className="input text-xs py-1.5 w-full resize-none" rows={2} value={visual['portal.tagline']} onChange={e => setV('portal.tagline', e.target.value)} />
                    </Field>
                    <Field label="Login Box Title">
                      <input className="input text-xs py-1.5 w-full" value={visual['portal.login_title']} onChange={e => setV('portal.login_title', e.target.value)} />
                    </Field>
                  </Section>

                  {/* Logo */}
                  <Section icon={Image} title="Logo">
                    {/* Upload button */}
                    <input ref={logoInputRef} type="file" accept="image/*" className="hidden"
                      onChange={e => handleLogoFile(e.target.files?.[0])} />
                    <button
                      onClick={() => logoInputRef.current?.click()}
                      disabled={logoUploading}
                      className="w-full flex items-center justify-center gap-2 border border-dashed border-border-dim rounded-sm py-3 text-xs font-mono text-text-mute hover:border-amber hover:text-amber transition-colors"
                    >
                      <Upload size={13} />
                      {logoUploading ? 'Uploading…' : 'Upload Logo Image'}
                    </button>
                    {logoPreview && (
                      <div className="border border-border-dim rounded p-2 bg-surface2 flex items-center justify-center min-h-[60px]">
                        <img src={logoPreview} alt="Logo" className="max-h-14 max-w-full object-contain" />
                      </div>
                    )}
                    <Field label="Or paste logo URL">
                      <input className="input text-xs py-1.5 w-full" value={visual['branding.logo_url']} onChange={e => { setV('branding.logo_url', e.target.value); setLogoPreview(e.target.value); }} placeholder="https://..." />
                    </Field>
                    <Field label="Logo Position">
                      <div className="flex gap-1">
                        {[['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]].map(([pos, Icon]) => (
                          <button key={pos} onClick={() => setV('portal.logo_position', pos)}
                            className={`flex-1 flex items-center justify-center gap-1 py-1.5 text-xs font-mono rounded-sm border transition-colors ${visual['portal.logo_position'] === pos ? 'bg-amber text-black border-amber' : 'border-border-dim text-text-mute hover:text-text'}`}>
                            <Icon size={12} /> {pos}
                          </button>
                        ))}
                      </div>
                    </Field>
                  </Section>

                  {/* Colors */}
                  <Section icon={Palette} title="Colors">
                    <div className="grid grid-cols-2 gap-2">
                      <ColorField label="Primary / Accent" value={visual['branding.primary_color']} onChange={v => setV('branding.primary_color', v)} />
                      <ColorField label="Background" value={visual['portal.bg_color']} onChange={v => setV('portal.bg_color', v)} />
                      <ColorField label="Card Background" value={visual['portal.card_bg']} onChange={v => setV('portal.card_bg', v)} />
                      <ColorField label="Text Color" value={visual['portal.text_color']} onChange={v => setV('portal.text_color', v)} />
                    </div>
                    <Field label="Theme">
                      <div className="flex gap-1">
                        {[['true', '🌙 Dark'], ['false', '☀️ Light']].map(([val, lbl]) => (
                          <button key={val} onClick={() => setV('portal.dark_mode', val)}
                            className={`flex-1 py-1.5 text-xs font-mono rounded-sm border transition-colors ${visual['portal.dark_mode'] === val ? 'bg-amber text-black border-amber' : 'border-border-dim text-text-mute hover:text-text'}`}>
                            {lbl}
                          </button>
                        ))}
                      </div>
                    </Field>
                  </Section>

                  {/* Typography */}
                  <Section icon={Type} title="Typography">
                    <Field label={`Font Size: ${visual['portal.font_size']}px`}>
                      <input type="range" min="12" max="20" value={visual['portal.font_size']}
                        onChange={e => setV('portal.font_size', e.target.value)}
                        className="w-full accent-amber" />
                      <div className="flex justify-between text-[10px] text-text-mute font-mono mt-0.5">
                        <span>12px</span><span>20px</span>
                      </div>
                    </Field>
                    <Field label="Font Family">
                      <select className="input text-xs py-1.5 w-full" value={visual['portal.font_family']}
                        onChange={e => setV('portal.font_family', e.target.value)}>
                        {FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                      </select>
                    </Field>
                    <Field label={`Corner Radius: ${visual['portal.border_radius']}px`}>
                      <input type="range" min="0" max="24" value={visual['portal.border_radius']}
                        onChange={e => setV('portal.border_radius', e.target.value)}
                        className="w-full accent-amber" />
                    </Field>
                  </Section>

                  {/* Content */}
                  <Section icon={Info} title="Content">
                    <Field label="Support Phone">
                      <input className="input text-xs py-1.5 w-full" value={visual['site.support_phone']} onChange={e => setV('site.support_phone', e.target.value)} placeholder="+880 1xxx-xxxxxx" />
                    </Field>
                    <Field label="Currency Symbol">
                      <input className="input text-xs py-1.5 w-20" value={visual['site.currency_symbol']} onChange={e => setV('site.currency_symbol', e.target.value)} />
                    </Field>
                  </Section>

                  <div className="text-[10px] text-text-mute font-mono px-1 pb-4 leading-relaxed">
                    Click <span className="text-amber">Generate & Save</span> to apply all changes and publish the portal template.
                    Packages are pulled from the <span className="text-amber">/packages</span> page automatically.
                  </div>
                </>
              )}
            </div>

            {/* Right: live mobile preview */}
            <div className="flex-1 flex flex-col min-h-0 items-center">
              <div className="mb-2 text-[10px] font-mono uppercase tracking-widest text-text-mute">Live Preview</div>
              <PhoneFrame iframeRef={iframeRef} />
            </div>
          </>
        )}

        {/* ── EDITOR TAB ── */}
        {tab === 'editor' && (
          <>
            <div className="flex-1 flex flex-col min-h-0">
              {isLoading ? (
                <div className="panel flex-1 flex items-center justify-center">
                  <span className="text-text-mute font-mono text-sm">Loading…</span>
                </div>
              ) : (
                <textarea
                  id="hs-template-editor"
                  className="flex-1 bg-surface border border-border rounded-sm font-mono text-xs text-text p-4 resize-none focus:outline-none focus:border-amber transition-colors"
                  value={html}
                  onChange={e => { setHtml(e.target.value); setDirty(true); }}
                  spellCheck={false}
                />
              )}
            </div>

            {/* Variable reference sidebar */}
            <div className="w-56 shrink-0 space-y-3 overflow-y-auto">
              <div className="panel p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Info size={13} className="text-amber" />
                  <span className="text-mono text-[10px] text-text-mute uppercase tracking-wider">MikroTik Variables</span>
                </div>
                <div className="text-xs text-text-mute mb-3">Click to insert at cursor.</div>
                <div className="space-y-1">
                  {VARS.map(({ v, d }) => (
                    <button key={v} onClick={() => { setTab('editor'); setTimeout(() => insertVar(v), 50); }}
                      className="w-full text-left hover:bg-surface2 rounded px-2 py-1.5 transition-colors">
                      <div className="font-mono text-[10px] text-amber">{v}</div>
                      <div className="text-[10px] text-text-mute mt-0.5">{d}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div className="panel p-3 text-[10px] text-text-mute space-y-1.5 font-mono">
                <div className="text-text-dim uppercase tracking-wider mb-2">MikroTik path</div>
                <code className="text-amber block">flash/skynity-hotspot/login.html</code>
                <div className="pt-2 text-text-mute">Upload via Winbox → Files, or FTP.</div>
              </div>
            </div>
          </>
        )}

        {/* ── PREVIEW TAB ── */}
        {tab === 'preview' && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-center gap-2 mb-3">
              <div className="flex gap-1 border border-border-dim rounded-sm p-0.5">
                <button onClick={() => setViewMode('mobile')} className={`flex items-center gap-1 px-3 py-1.5 text-xs font-mono rounded-sm ${viewMode === 'mobile' ? 'bg-amber text-black' : 'text-text-dim hover:text-text'}`}><Smartphone size={11} /> Mobile</button>
                <button onClick={() => setViewMode('desktop')} className={`flex items-center gap-1 px-3 py-1.5 text-xs font-mono rounded-sm ${viewMode === 'desktop' ? 'bg-amber text-black' : 'text-text-dim hover:text-text'}`}><Monitor size={11} /> Desktop</button>
              </div>
            </div>
            {viewMode === 'mobile'
              ? <PhoneFrame iframeRef={iframeRef} />
              : <div className="flex-1 border border-border rounded-sm overflow-hidden bg-white">
                  <iframe ref={iframeRef} title="Portal Preview" className="w-full h-full" sandbox="allow-same-origin allow-forms allow-scripts" />
                </div>
            }
          </div>
        )}
      </div>
    </div>
  );
}
