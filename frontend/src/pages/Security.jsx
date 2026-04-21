// ============================================================
// Security dashboard — auth audit + brute-force signals + ops
// ============================================================
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Shield, AlertTriangle, Lock, Skull, Activity } from 'lucide-react';
import {
  apiSecuritySummary,
  apiSecurityEvents,
  apiSecurityEmergencyGet,
  apiSecurityEmergencySet,
} from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { Skeleton } from '../components/primitives';
import { useT } from '../i18n';

export default function Security() {
  const t = useT();
  const qc = useQueryClient();
  const summary = useQuery({
    queryKey: ['security-summary'],
    queryFn: () => apiSecuritySummary(168),
    refetchInterval: 60_000,
  });
  const events = useQuery({
    queryKey: ['security-events'],
    queryFn: () => apiSecurityEvents({ limit: 150, hours: 168 }),
    refetchInterval: 60_000,
  });
  const emerg = useQuery({
    queryKey: ['emergency-stop'],
    queryFn: apiSecurityEmergencyGet,
    refetchInterval: 15_000,
  });

  const toggleEmerg = useMutation({
    mutationFn: (enabled) => apiSecurityEmergencySet(enabled),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['emergency-stop'] });
    },
  });

  const s = summary.data;
  const sig = s?.brute_force_signals || {};

  return (
    <div>
      <PageHeader
        kicker="System"
        title={<><Shield size={18} className="inline mr-2 text-amber" />{t('nav.security')}</>}
        subtitle={t('security.subtitle')}
      />
      <div className="p-8 space-y-6">
        {/* Emergency stop */}
        <div
          className={`panel p-4 flex flex-wrap items-center justify-between gap-4 ${
            emerg.data?.emergency_stop ? 'border-red/50 bg-red/5' : ''
          }`}
        >
          <div>
            <div className="text-xs font-mono uppercase text-text-mute">Operations</div>
            <div className="font-semibold mt-1">
              {emerg.data?.emergency_stop ? 'Emergency stop is ON' : 'Emergency stop is OFF'}
            </div>
            <p className="text-xs text-text-mute mt-1 max-w-xl">
              When ON, all background cron jobs pause (MikroTik sync retries, monitoring polls, expiry reminders, etc.).
              HTTP API and admin panel keep working. Use Telegram <code className="font-mono">/emergency_off</code> or this toggle.
            </p>
          </div>
          <button
            type="button"
            className={emerg.data?.emergency_stop ? 'btn btn-primary' : 'btn border-red/40 text-red'}
            disabled={toggleEmerg.isPending || emerg.isLoading}
            onClick={() => toggleEmerg.mutate(!emerg.data?.emergency_stop)}
          >
            {toggleEmerg.isPending ? '…' : emerg.data?.emergency_stop ? 'Turn OFF' : 'Turn ON'}
          </button>
        </div>

        {/* Signal cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SignalCard
            icon={Lock}
            label={t('security.signals.adminFail')}
            n={sig.admin_login_fail_24h}
            warn={sig.admin_login_fail_24h >= 5}
          />
          <SignalCard
            icon={AlertTriangle}
            label={t('security.signals.otpFail')}
            n={sig.otp_fail_24h}
            warn={sig.otp_fail_24h >= 15}
          />
          <SignalCard
            icon={Skull}
            label={t('security.signals.portalFail')}
            n={sig.portal_login_fail_24h}
            warn={sig.portal_login_fail_24h >= 20}
          />
          <SignalCard
            icon={Activity}
            label={t('security.signals.total24')}
            n={s?.last_24h_total ?? 0}
            warn={false}
          />
        </div>

        <section>
          <h2 className="text-display italic text-lg mb-3">{t('security.recent')}</h2>
          {events.isLoading ? (
            <Skeleton className="h-64" />
          ) : (
            <div className="overflow-x-auto panel p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[10px] uppercase font-mono text-text-mute">
                    <th className="p-3">Time</th>
                    <th className="p-3">Type</th>
                    <th className="p-3">Severity</th>
                    <th className="p-3">IP</th>
                    <th className="p-3">Subject</th>
                  </tr>
                </thead>
                <tbody>
                  {(events.data || []).map((e) => (
                    <tr key={e.id} className="border-b border-border/60 hover:bg-surface2/50">
                      <td className="p-2 font-mono text-xs whitespace-nowrap">
                        {formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}
                      </td>
                      <td className="p-2 font-mono text-xs">{e.event_type}</td>
                      <td className="p-2">
                        <span className="tag tag-dim">{e.severity}</span>
                      </td>
                      <td className="p-2 font-mono text-xs">{e.ip || '—'}</td>
                      <td className="p-2 font-mono text-xs truncate max-w-[200px]" title={e.subject}>
                        {e.subject || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <p className="text-xs text-text-mute">
          Claude AI (Telegram): set <code className="font-mono">ai.claude.enabled</code>,{' '}
          <code className="font-mono">ai.claude.api_key</code> in System Settings — see docs/CLAUDE_TELEGRAM.md
        </p>
      </div>
    </div>
  );
}

function SignalCard({ icon: Icon, label, n, warn }) {
  return (
    <div className={`panel p-4 ${warn ? 'border-amber/50 bg-amber/5' : ''}`}>
      <div className="flex items-center gap-2 text-text-mute text-[10px] uppercase font-mono">
        <Icon size={14} /> {label}
      </div>
      <div className={`text-2xl font-mono mt-1 ${warn ? 'text-amber' : ''}`}>{n ?? 0}</div>
    </div>
  );
}
