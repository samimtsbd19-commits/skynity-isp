import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Save, Settings as Cog, Shield, Palette, Globe, Phone, Clock,
  CreditCard, FileText, MessageSquare, Send, CheckCircle2, XCircle,
  Zap, Gift, Play,
} from 'lucide-react';
import {
  apiSettings, apiSettingsBulk,
  apiNotifyChannels, apiNotifyTest,
  apiRunExpiryReminders,
} from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { Skeleton } from '../components/primitives';

const SECTIONS = [
  { key: 'feature',      title: 'Features (on / off)', icon: Zap },
  { key: 'site',         title: 'Site',                icon: Globe },
  { key: 'branding',     title: 'Branding / Logo',     icon: Palette },
  { key: 'payment',      title: 'Payment methods',     icon: CreditCard },
  { key: 'invoice',      title: 'Invoicing',           icon: FileText },
  { key: 'trial',        title: 'Free trial',          icon: Gift },
  { key: 'provisioning', title: 'Provisioning',        icon: Cog },
  { key: 'notify',       title: 'Notifications (OTP / SMS / WhatsApp / Telegram)', icon: MessageSquare },
  { key: 'telegram',     title: 'Telegram',            icon: Phone },
  { key: 'security',     title: 'Security',            icon: Shield },
  { key: 'vpn',          title: 'VPN defaults',        icon: Shield },
  { key: 'updates',      title: 'Updates',             icon: Clock },
];

export default function SystemSettings() {
  const qc = useQueryClient();
  const { data: settings = [], isLoading } = useQuery({
    queryKey: ['settings'], queryFn: apiSettings,
  });
  const [values, setValues] = useState({});

  useEffect(() => {
    const next = {};
    for (const s of settings) next[s.key] = s.value;
    setValues(next);
  }, [settings]);

  const save = useMutation({
    mutationFn: () => {
      const payload = settings.map((s) => ({
        key: s.key, type: s.type, value: values[s.key],
      }));
      return apiSettingsBulk(payload);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });

  const grouped = {};
  for (const s of settings) {
    const prefix = s.key.split('.')[0];
    (grouped[prefix] ||= []).push(s);
  }

  return (
    <div>
      <PageHeader
        kicker="Admin"
        title={<>System <em>settings</em></>}
        subtitle="Every runtime tunable — brand, provisioning, security, VPN defaults. Stored in DB, edited without redeploys."
        actions={
          <button onClick={() => save.mutate()} className="btn btn-primary" disabled={save.isPending}>
            <Save size={14} /> {save.isPending ? 'Saving…' : save.isSuccess ? 'Saved ✓' : 'Save changes'}
          </button>
        }
      />
      <div className="p-8 grid gap-6">
        {isLoading ? (
          <Skeleton className="h-40" />
        ) : (
          SECTIONS.map((sec) => {
            const rows = grouped[sec.key] || [];
            if (!rows.length) return null;
            const Icon = sec.icon;
            return (
              <section key={sec.key} className="panel p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Icon size={16} className="text-amber" strokeWidth={1.5} />
                  <h2 className="text-display text-xl italic">{sec.title}</h2>
                </div>

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
                      onChange={(v) => setValues({ ...values, [s.key]: v })}
                    />
                  ))}
                </div>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}

function RunExpiryRemindersButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const click = async () => {
    setBusy(true); setMsg('');
    try {
      await apiRunExpiryReminders();
      setMsg('ok');
    } catch (ex) {
      setMsg(ex?.response?.data?.error || ex.message);
    } finally { setBusy(false); }
  };
  return (
    <div className="mt-4 p-4 rounded border border-border-dim bg-surface">
      <div className="text-sm font-semibold mb-1">Expiry reminders</div>
      <div className="text-xs text-text-mute mb-3">
        The job runs automatically at 08:00 daily. Click below to trigger a run right now
        (useful the first time you enable expiry reminders).
      </div>
      <button
        onClick={click}
        disabled={busy}
        className="btn btn-ghost text-xs"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
      >
        <Play size={12} /> {busy ? 'Running…' : 'Run expiry reminders now'}
      </button>
      {msg === 'ok'  && <span className="ml-3 text-xs" style={{ color: '#10b981' }}>sent</span>}
      {msg && msg !== 'ok' && <span className="ml-3 text-xs text-red">{msg}</span>}
    </div>
  );
}

function NotifyChannelStatus() {
  const { data: channels = [], refetch, isFetching } = useQuery({
    queryKey: ['notify', 'channels'],
    queryFn: apiNotifyChannels,
    refetchOnWindowFocus: false,
  });
  const [tc, setTc] = useState(null); // test config: { channel, target }
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);

  const runTest = async () => {
    if (!tc?.channel || !tc.target) return;
    setTesting(true); setResult(null);
    try {
      const out = await apiNotifyTest({
        channel: tc.channel,
        target: tc.target.trim(),
      });
      setResult({ ok: true, detail: out });
    } catch (e) {
      setResult({ ok: false, detail: e?.response?.data?.error || e.message });
    } finally { setTesting(false); }
  };

  return (
    <div className="mb-6 border border-border-dim rounded-sm">
      <div className="px-4 py-3 border-b border-border-dim flex items-center justify-between">
        <div className="text-mono text-[10px] text-text-mute uppercase tracking-wider">
          Channel status
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
            <li key={c.channel} className="px-4 py-3 flex items-center gap-4">
              <div className="w-24 text-sm font-semibold uppercase tracking-wider">
                {c.channel}
              </div>
              <div className="flex items-center gap-2 text-xs">
                {live ? (
                  <span className="inline-flex items-center gap-1 text-green">
                    <CheckCircle2 size={14} /> ready
                  </span>
                ) : c.enabled && !c.configured ? (
                  <span className="inline-flex items-center gap-1 text-amber">
                    <XCircle size={14} /> enabled but credentials missing
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-text-mute">
                    <XCircle size={14} /> off
                  </span>
                )}
                {c.provider && (
                  <span className="tag tag-dim">{c.provider}</span>
                )}
              </div>
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => setTc({ channel: c.channel, target: '' })}
                  className="btn btn-ghost text-xs"
                >
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
            Send a test via <span className="text-amber">{tc.channel}</span>
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

function SettingInput({ setting, value, onChange }) {
  const label = setting.key.split('.').slice(1).join('.') || setting.key;
  return (
    <label className="block">
      <div className="text-mono text-[10px] text-text-mute uppercase tracking-wider">
        {label}
        {setting.isSecret && <span className="ml-2 tag tag-dim">secret</span>}
      </div>
      {setting.description && (
        <div className="text-[11px] text-text-mute mt-0.5">{setting.description}</div>
      )}
      <div className="mt-1.5">
        {setting.type === 'boolean' ? (
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!value}
              onChange={(e) => onChange(e.target.checked)}
            />
            <span className="text-text-dim font-mono text-xs">
              {value ? 'enabled' : 'disabled'}
            </span>
          </label>
        ) : setting.type === 'number' ? (
          <input
            type="number"
            className="input"
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
        ) : (
          <input
            className="input"
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
            type={setting.isSecret ? 'password' : 'text'}
          />
        )}
      </div>
    </label>
  );
}
