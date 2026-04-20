import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Settings as Cog, Shield, Palette, Globe, Phone, Mail, Clock } from 'lucide-react';
import { apiSettings, apiSettingsBulk } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { Skeleton } from '../components/primitives';

const SECTIONS = [
  { key: 'site',         title: 'Site / Branding', icon: Globe },
  { key: 'provisioning', title: 'Provisioning',    icon: Cog },
  { key: 'telegram',     title: 'Telegram',        icon: Phone },
  { key: 'security',     title: 'Security',        icon: Shield },
  { key: 'vpn',          title: 'VPN defaults',    icon: Shield },
  { key: 'updates',      title: 'Updates',         icon: Clock },
  { key: 'branding',     title: 'Appearance',      icon: Palette },
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
