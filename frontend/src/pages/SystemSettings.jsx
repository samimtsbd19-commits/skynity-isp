import { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Save, Settings as Cog, Shield, Palette, Globe, Phone, Clock,
  CreditCard, FileText, MessageSquare, Send, CheckCircle2, XCircle,
  Zap, Gift, Play, Search, ExternalLink, Stethoscope, Wifi,
  ChevronRight, Sparkles, Wrench, Lock,
} from 'lucide-react';
import {
  apiSettings, apiSettingsBulk,
  apiNotifyChannels, apiNotifyTest,
  apiRunExpiryReminders,
} from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { Skeleton } from '../components/primitives';

// ──────────────────────────────────────────────────────────────
// Section catalogue — ordered into purpose-driven super-groups.
// ──────────────────────────────────────────────────────────────
const SECTIONS = [
  // 🚀 Quick Setup
  { key: 'site',         title: 'Site Identity',       icon: Globe,        group: 'setup' },
  { key: 'branding',     title: 'Branding & Logo',     icon: Palette,      group: 'setup' },
  { key: 'payment',      title: 'Payment Methods',     icon: CreditCard,   group: 'setup' },

  // 👥 Customer Experience
  { key: 'portal',       title: 'Public Portal',       icon: FileText,     group: 'cx' },
  { key: 'trial',        title: 'Free Trial',          icon: Gift,         group: 'cx' },
  { key: 'invoice',      title: 'Invoicing',           icon: FileText,     group: 'cx' },

  // ⚙️ Operations
  { key: 'provisioning', title: 'Provisioning',        icon: Wrench,       group: 'ops' },
  { key: 'notify',       title: 'Notifications',       icon: MessageSquare,group: 'ops' },
  { key: 'telegram',     title: 'Telegram (other)',    icon: Phone,        group: 'ops' },

  // 🔒 Advanced
  { key: 'security',     title: 'Security',            icon: Lock,         group: 'advanced' },
  { key: 'vpn',          title: 'VPN Defaults',        icon: Shield,       group: 'advanced' },
  { key: 'updates',      title: 'System Updates',      icon: Clock,        group: 'advanced' },
  { key: 'feature',      title: 'Feature Toggles',     icon: Zap,          group: 'advanced' },
];

const GROUPS = [
  { key: 'setup',    label: 'Quick Setup',         icon: Sparkles },
  { key: 'cx',       label: 'Customer Experience', icon: Globe },
  { key: 'ops',      label: 'Operations',          icon: Wrench },
  { key: 'advanced', label: 'Advanced',            icon: Lock },
];

// Keys that have dedicated UI elsewhere — hide from raw editor to prevent
// duplicate-source-of-truth confusion. Show a banner pointing to the right page.
const MANAGED_ELSEWHERE = {
  'telegram.bot_token':   { page: '/diagnostics', label: 'Diagnostics' },
  'telegram.admin_ids':   { page: '/diagnostics', label: 'Diagnostics' },
  'telegram.bot_enabled': { page: '/diagnostics', label: 'Diagnostics' },
  'ai.claude.api_key':       { page: '/diagnostics', label: 'Diagnostics' },
  'ai.openrouter.api_key':   { page: '/diagnostics', label: 'Diagnostics' },
  'ai.openrouter.enabled':   { page: '/diagnostics', label: 'Diagnostics' },
  'hotspot.login_template':  { page: '/hotspot-template', label: 'Portal Template' },
};

// Sections that get a banner pointing to a richer dedicated UI.
const SECTION_HINTS = {
  branding: {
    icon: Wifi,
    text: 'For logo upload, color pickers, and live mobile preview, use the visual editor:',
    page: '/hotspot-template',
    label: 'Open Portal Template Editor',
  },
  telegram: {
    icon: Stethoscope,
    text: 'Bot token, admin IDs, and live test live in Diagnostics. The fields below are advanced extras only.',
    page: '/diagnostics',
    label: 'Open Diagnostics',
  },
  notify: {
    icon: Stethoscope,
    text: 'Need to test the AI? Diagnostics has a one-click live test.',
    page: '/diagnostics',
    label: 'Open Diagnostics',
  },
};

// ═════════════════════════════════════════════════════════════
export default function SystemSettings() {
  const qc = useQueryClient();
  const { data: settings = [], isLoading } = useQuery({
    queryKey: ['settings'], queryFn: apiSettings,
  });
  const [values, setValues] = useState({});
  const [dirty, setDirty]   = useState(new Set());
  const [search, setSearch] = useState('');
  const [activeSection, setActiveSection] = useState(null);
  const sectionRefs = useRef({});

  useEffect(() => {
    const next = {};
    for (const s of settings) next[s.key] = s.value;
    setValues(next);
    setDirty(new Set());
  }, [settings]);

  const save = useMutation({
    mutationFn: () => {
      const payload = settings
        .filter((s) => dirty.has(s.key))
        .map((s) => ({ key: s.key, type: s.type, value: values[s.key] }));
      return apiSettingsBulk(payload);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });

  // Group settings by section prefix, filtering out duplicates.
  const grouped = useMemo(() => {
    const g = {};
    const term = search.trim().toLowerCase();
    for (const s of settings) {
      if (MANAGED_ELSEWHERE[s.key]) continue;
      if (term) {
        const hay = `${s.key} ${s.description || ''}`.toLowerCase();
        if (!hay.includes(term)) continue;
      }
      const prefix = s.key.split('.')[0];
      (g[prefix] ||= []).push(s);
    }
    return g;
  }, [settings, search]);

  const onChange = (key, v) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    setDirty((prev) => { const n = new Set(prev); n.add(key); return n; });
  };

  const scrollTo = (key) => {
    const el = sectionRefs.current[key];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveSection(key);
  };

  const dirtyCount = dirty.size;

  return (
    <div className="flex h-full overflow-hidden">

      {/* ─── Sticky sidebar nav ─── */}
      <aside className="w-60 shrink-0 border-r border-border-dim flex flex-col bg-surface">
        <div className="p-4 border-b border-border-dim">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-mute" />
            <input
              type="text"
              placeholder="Search settings…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input text-xs py-1.5 pl-7 w-full"
            />
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-4">
          {GROUPS.map((group) => {
            const sectionsInGroup = SECTIONS.filter((s) => s.group === group.key && grouped[s.key]?.length);
            if (!sectionsInGroup.length) return null;
            const GIcon = group.icon;
            return (
              <div key={group.key}>
                <div className="flex items-center gap-1.5 px-2 mb-1.5 text-mono text-[10px] uppercase tracking-[0.2em] text-text-mute">
                  <GIcon size={10} />
                  {group.label}
                </div>
                <div className="space-y-0.5">
                  {sectionsInGroup.map((sec) => {
                    const SIcon = sec.icon;
                    const count = grouped[sec.key]?.length || 0;
                    const sectionDirty = [...dirty].some((k) => k.startsWith(sec.key + '.'));
                    return (
                      <button
                        key={sec.key}
                        onClick={() => scrollTo(sec.key)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded-sm transition-colors ${
                          activeSection === sec.key
                            ? 'bg-surface2 text-amber'
                            : 'text-text-dim hover:bg-surface2 hover:text-text'
                        }`}
                      >
                        <SIcon size={13} strokeWidth={1.5} />
                        <span className="flex-1 text-left">{sec.title}</span>
                        {sectionDirty && <span className="w-1.5 h-1.5 rounded-full bg-amber" />}
                        <span className="text-[9px] font-mono text-text-mute">{count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Dedicated tools cross-links */}
        <div className="border-t border-border-dim p-3 space-y-1">
          <div className="text-mono text-[10px] uppercase tracking-[0.2em] text-text-mute mb-2">
            Dedicated Tools
          </div>
          <Link to="/diagnostics" className="flex items-center gap-2 px-2 py-1.5 text-xs text-text-dim hover:text-amber rounded-sm hover:bg-surface2">
            <Stethoscope size={12} /> Diagnostics
            <ExternalLink size={10} className="ml-auto" />
          </Link>
          <Link to="/hotspot-template" className="flex items-center gap-2 px-2 py-1.5 text-xs text-text-dim hover:text-amber rounded-sm hover:bg-surface2">
            <Palette size={12} /> Portal Template
            <ExternalLink size={10} className="ml-auto" />
          </Link>
          <Link to="/guide" className="flex items-center gap-2 px-2 py-1.5 text-xs text-text-dim hover:text-amber rounded-sm hover:bg-surface2">
            <FileText size={12} /> Project Guide
            <ExternalLink size={10} className="ml-auto" />
          </Link>
        </div>
      </aside>

      {/* ─── Main content ─── */}
      <main className="flex-1 overflow-y-auto">
        <PageHeader
          kicker="Admin"
          title={<>System <em>Settings</em></>}
          subtitle="Runtime tunables stored in DB — no redeploy needed. Sensitive credentials (Telegram, AI) live in Diagnostics."
          actions={
            <button
              onClick={() => save.mutate()}
              className={`btn ${dirtyCount > 0 ? 'btn-primary' : 'btn-ghost opacity-60 cursor-not-allowed'}`}
              disabled={save.isPending || dirtyCount === 0}
            >
              <Save size={14} />
              {save.isPending
                ? 'Saving…'
                : save.isSuccess && dirtyCount === 0
                ? 'Saved ✓'
                : dirtyCount > 0
                ? `Save ${dirtyCount} change${dirtyCount > 1 ? 's' : ''}`
                : 'No changes'}
            </button>
          }
        />

        <div className="px-8 pb-12 space-y-6">
          {isLoading ? (
            <Skeleton className="h-40" />
          ) : (
            GROUPS.map((group) => {
              const sectionsInGroup = SECTIONS.filter((s) => s.group === group.key && grouped[s.key]?.length);
              if (!sectionsInGroup.length) return null;
              return (
                <div key={group.key} className="space-y-5">
                  <div className="flex items-center gap-2 sticky top-0 bg-bg z-10 py-2 -mx-2 px-2 border-b border-border-dim">
                    <group.icon size={12} className="text-amber" />
                    <h2 className="text-mono text-[11px] uppercase tracking-[0.25em] text-text-mute">{group.label}</h2>
                  </div>
                  {sectionsInGroup.map((sec) => (
                    <SectionPanel
                      key={sec.key}
                      sec={sec}
                      rows={grouped[sec.key]}
                      values={values}
                      dirty={dirty}
                      onChange={onChange}
                      sectionRef={(el) => { sectionRefs.current[sec.key] = el; }}
                    />
                  ))}
                </div>
              );
            })
          )}

          {Object.keys(grouped).length === 0 && search && (
            <div className="text-center text-text-mute font-mono text-sm py-12">
              No settings match "<span className="text-amber">{search}</span>"
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// Section panel
// ═════════════════════════════════════════════════════════════
function SectionPanel({ sec, rows, values, dirty, onChange, sectionRef }) {
  const Icon = sec.icon;
  const hint = SECTION_HINTS[sec.key];
  const sectionDirtyCount = rows.filter((r) => dirty.has(r.key)).length;

  return (
    <section ref={sectionRef} className="panel p-6 scroll-mt-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <Icon size={16} className="text-amber" strokeWidth={1.5} />
          <h3 className="text-display text-xl italic">{sec.title}</h3>
          {sectionDirtyCount > 0 && (
            <span className="text-[10px] font-mono text-amber bg-amber/10 px-1.5 py-0.5 rounded-sm">
              {sectionDirtyCount} unsaved
            </span>
          )}
        </div>
        <span className="text-[10px] font-mono text-text-mute uppercase tracking-wider">
          {rows.length} setting{rows.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Hint banner pointing to dedicated tool */}
      {hint && (
        <Link
          to={hint.page}
          className="flex items-start gap-3 p-3 mb-4 border border-amber/30 bg-amber/5 rounded-sm hover:bg-amber/10 transition-colors group"
        >
          <hint.icon size={14} className="text-amber shrink-0 mt-0.5" />
          <div className="flex-1 text-xs text-text-dim leading-relaxed">{hint.text}</div>
          <span className="text-xs font-mono text-amber group-hover:text-amber-dim flex items-center gap-1 shrink-0">
            {hint.label} <ChevronRight size={11} />
          </span>
        </Link>
      )}

      {/* Notification channel status (only on notify section) */}
      {sec.key === 'notify' && (
        <>
          <NotifyChannelStatus />
          <RunExpiryRemindersButton />
        </>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {rows.map((s) => (
          <SettingInput
            key={s.key}
            setting={s}
            value={values[s.key]}
            isDirty={dirty.has(s.key)}
            onChange={(v) => onChange(s.key, v)}
          />
        ))}
      </div>
    </section>
  );
}

// ═════════════════════════════════════════════════════════════
// Setting input (one row)
// ═════════════════════════════════════════════════════════════
const TEXTAREA_KEYS = new Set([
  'portal.intro_html',
  'portal.rules_html',
  'portal.guide_html',
  'portal.troubleshoot_html',
]);
function needsTextarea(setting, value) {
  if (setting.type !== 'string') return false;
  if (TEXTAREA_KEYS.has(setting.key)) return true;
  const s = String(value ?? '');
  return s.includes('\n') || s.length > 80;
}

function SettingInput({ setting, value, isDirty, onChange }) {
  const label = setting.key.split('.').slice(1).join('.') || setting.key;
  return (
    <label className={`block p-3 rounded-sm border transition-colors ${isDirty ? 'border-amber/50 bg-amber/5' : 'border-border-dim'}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="text-mono text-[10px] text-text-mute uppercase tracking-wider flex items-center gap-2">
          {label}
          {setting.isSecret && <span className="tag tag-dim text-[9px]">secret</span>}
          {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-amber" />}
        </div>
      </div>
      {setting.description && (
        <div className="text-[11px] text-text-mute mb-1.5 leading-snug">{setting.description}</div>
      )}
      <div className="mt-1">
        {setting.type === 'boolean' ? (
          <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={!!value}
              onChange={(e) => onChange(e.target.checked)}
              className="accent-amber"
            />
            <span className="text-text-dim font-mono text-xs">
              {value ? 'enabled' : 'disabled'}
            </span>
          </label>
        ) : setting.type === 'number' ? (
          <input
            type="number"
            className="input text-sm"
            value={value ?? ''}
            onChange={(e) => onChange(Number(e.target.value))}
          />
        ) : setting.type === 'json' ? (
          <textarea
            className="input font-mono text-[12px]"
            rows={3}
            value={value ? JSON.stringify(value, null, 2) : ''}
            onChange={(e) => {
              try { onChange(JSON.parse(e.target.value)); } catch { onChange(e.target.value); }
            }}
          />
        ) : needsTextarea(setting, value) ? (
          <textarea
            className="input font-mono text-[12px]"
            rows={Math.min(10, Math.max(3, String(value ?? '').split('\n').length + 1))}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <input
            className="input text-sm"
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
            type={setting.isSecret ? 'password' : 'text'}
          />
        )}
      </div>
    </label>
  );
}

// ═════════════════════════════════════════════════════════════
// Notification channel status
// ═════════════════════════════════════════════════════════════
function NotifyChannelStatus() {
  const { data: channels = [], refetch, isFetching } = useQuery({
    queryKey: ['notify', 'channels'],
    queryFn: apiNotifyChannels,
    refetchOnWindowFocus: false,
  });
  const [tc, setTc] = useState(null);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);

  const runTest = async () => {
    if (!tc?.channel || !tc.target) return;
    setTesting(true); setResult(null);
    try {
      const out = await apiNotifyTest({ channel: tc.channel, target: tc.target.trim() });
      setResult({ ok: true, detail: out });
    } catch (e) {
      setResult({ ok: false, detail: e?.response?.data?.error || e.message });
    } finally { setTesting(false); }
  };

  return (
    <div className="mb-6 border border-border-dim rounded-sm">
      <div className="px-4 py-2.5 border-b border-border-dim flex items-center justify-between bg-surface2">
        <div className="text-mono text-[10px] text-text-mute uppercase tracking-wider">
          Channel Status
        </div>
        <button
          onClick={() => refetch()}
          className="text-[11px] font-mono text-amber hover:text-amber-dim uppercase tracking-wider"
          disabled={isFetching}
        >{isFetching ? 'checking…' : 'refresh'}</button>
      </div>
      <ul className="divide-y divide-border-dim">
        {channels.map((c) => {
          const live = c.enabled && c.configured;
          return (
            <li key={c.channel} className="px-4 py-2.5 flex items-center gap-4">
              <div className="w-24 text-sm font-semibold uppercase tracking-wider">{c.channel}</div>
              <div className="flex items-center gap-2 text-xs">
                {live ? (
                  <span className="inline-flex items-center gap-1 text-green"><CheckCircle2 size={14} /> ready</span>
                ) : c.enabled && !c.configured ? (
                  <span className="inline-flex items-center gap-1 text-amber"><XCircle size={14} /> credentials missing</span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-text-mute"><XCircle size={14} /> off</span>
                )}
                {c.provider && <span className="tag tag-dim">{c.provider}</span>}
              </div>
              <div className="ml-auto">
                <button onClick={() => setTc({ channel: c.channel, target: '' })} className="btn btn-ghost text-xs">
                  <Send size={13} /> test
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {tc && (
        <div className="px-4 py-3 border-t border-border-dim bg-surface2/40">
          <div className="text-mono text-[10px] text-text-mute uppercase tracking-wider mb-2">
            Send test via <span className="text-amber">{tc.channel}</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              className="input flex-1"
              placeholder={tc.channel === 'telegram' ? 'Telegram chat id' : 'Phone (01XXXXXXXXX)'}
              value={tc.target}
              onChange={(e) => setTc({ ...tc, target: e.target.value })}
            />
            <button onClick={runTest} disabled={testing || !tc.target} className="btn btn-primary">
              {testing ? 'Sending…' : 'Send'}
            </button>
            <button onClick={() => { setTc(null); setResult(null); }} className="btn btn-ghost">Cancel</button>
          </div>
          {result && (
            <div className={`mt-2 text-xs font-mono ${result.ok ? 'text-green' : 'text-red'}`}>
              {result.ok ? '✓ sent' : '✗ ' + JSON.stringify(result.detail)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
function RunExpiryRemindersButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const click = async () => {
    setBusy(true); setMsg('');
    try { await apiRunExpiryReminders(); setMsg('ok'); }
    catch (ex) { setMsg(ex?.response?.data?.error || ex.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="mb-6 p-4 rounded-sm border border-border-dim bg-surface2/40">
      <div className="text-sm font-semibold mb-1">Expiry reminders</div>
      <div className="text-xs text-text-mute mb-3">
        Job runs daily at 08:00. Click below to trigger now (useful after first-time setup).
      </div>
      <button onClick={click} disabled={busy} className="btn btn-ghost text-xs">
        <Play size={12} /> {busy ? 'Running…' : 'Run expiry reminders now'}
      </button>
      {msg === 'ok' && <span className="ml-3 text-xs text-green">sent</span>}
      {msg && msg !== 'ok' && <span className="ml-3 text-xs text-red">{msg}</span>}
    </div>
  );
}
