import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, AlertCircle, Check, Shield } from 'lucide-react';
import { apiChangePassword, apiMe, api2faSetup, api2faVerify, api2faDisable } from '../api/client';
import { PageHeader } from '../components/PageHeader';

export default function Settings() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [msg, setMsg] = useState('');
  const qc = useQueryClient();
  const meQ = useQuery({ queryKey: ['auth-me'], queryFn: apiMe });
  const totpOn = !!meQ.data?.totp_enabled;

  const [setup, setSetup] = useState(null);
  const [firstCode, setFirstCode] = useState('');
  const [backupList, setBackupList] = useState(null);
  const [disablePw, setDisablePw] = useState('');
  const [twoMsg, setTwoMsg] = useState('');

  const start2fa = useMutation({
    mutationFn: api2faSetup,
    onSuccess: (d) => { setSetup(d); setTwoMsg(''); setFirstCode(''); setBackupList(null); },
    onError: (e) => setTwoMsg(e?.response?.data?.error || e.message),
  });
  const finish2fa = useMutation({
    mutationFn: () => api2faVerify(firstCode),
    onSuccess: (d) => {
      setBackupList(d.backupCodes || []);
      setTwoMsg('2FA enabled. Store your backup codes safely.');
      setSetup(null);
      qc.invalidateQueries({ queryKey: ['auth-me'] });
    },
    onError: (e) => setTwoMsg(e?.response?.data?.error || e.message),
  });
  const off2fa = useMutation({
    mutationFn: () => api2faDisable(disablePw),
    onSuccess: () => {
      setDisablePw('');
      setTwoMsg('2FA disabled.');
      qc.invalidateQueries({ queryKey: ['auth-me'] });
    },
    onError: (e) => setTwoMsg(e?.response?.data?.error || e.message),
  });

  const mut = useMutation({
    mutationFn: () => apiChangePassword(current, next),
    onSuccess: () => {
      setMsg('Password updated.');
      setCurrent('');
      setNext('');
      setAgain('');
      qc.invalidateQueries({ queryKey: ['activity-log'] });
      qc.invalidateQueries({ queryKey: ['auth-me'] });
    },
    onError: (e) => {
      setMsg(e?.response?.data?.error || e.message || 'Failed');
    },
  });

  const submit = (e) => {
    e.preventDefault();
    setMsg('');
    if (next.length < 8) {
      setMsg('New password must be at least 8 characters.');
      return;
    }
    if (next !== again) {
      setMsg('New passwords do not match.');
      return;
    }
    mut.mutate();
  };

  return (
    <div>
      <PageHeader
        kicker="Security"
        title={<>Account <em>settings</em></>}
        subtitle="Change your dashboard password. Use a strong, unique passphrase."
      />
      <div className="px-8 py-6 max-w-lg space-y-8">
        <div className="panel p-6 space-y-4">
          <div className="flex items-center gap-2 text-mono text-[10px] text-amber uppercase tracking-wider">
            <Shield size={14} /> Two-factor authentication
          </div>
          <p className="text-sm text-text-dim">
            {totpOn ? '2FA is enabled on your account.' : 'Add an authenticator app for stronger sign-in security.'}
          </p>
          {setup && (
            <div className="space-y-3 border border-border-dim rounded-sm p-4">
              <p className="text-xs text-text-dim">Scan this QR in Google Authenticator or similar, then enter the first code.</p>
              {setup.qrDataUrl && <img src={setup.qrDataUrl} alt="2FA QR" className="w-40 h-40 bg-white p-1 rounded" />}
              <div className="text-mono text-[10px] break-all text-text-mute">Secret: {setup.secret}</div>
              <label className="block">
                <span className="text-mono text-[10px] text-text-mute uppercase">First code</span>
                <input className="input mt-1 font-mono" value={firstCode} onChange={(e) => setFirstCode(e.target.value)} />
              </label>
              <button type="button" className="btn btn-primary text-sm" onClick={() => finish2fa.mutate()} disabled={finish2fa.isPending}>
                Confirm and enable
              </button>
            </div>
          )}
          {backupList && (
            <div className="border border-amber/40 bg-amber/5 rounded-sm p-4">
              <div className="text-sm font-mono text-amber mb-2">One-time backup codes</div>
              <ul className="text-xs font-mono space-y-1">
                {backupList.map((c) => <li key={c}>{c}</li>)}
              </ul>
            </div>
          )}
          {!totpOn && !setup && (
            <button type="button" className="btn btn-primary" onClick={() => start2fa.mutate()} disabled={start2fa.isPending}>
              Enable 2FA
            </button>
          )}
          {totpOn && (
            <div className="space-y-2">
              <label className="block">
                <span className="text-mono text-[10px] text-text-mute uppercase">Password (to disable 2FA)</span>
                <input type="password" className="input mt-1" value={disablePw} onChange={(e) => setDisablePw(e.target.value)} />
              </label>
              <button type="button" className="btn btn-ghost text-red text-sm" onClick={() => off2fa.mutate()} disabled={off2fa.isPending}>
                Disable 2FA
              </button>
            </div>
          )}
          {twoMsg && (
            <div className={`text-sm px-3 py-2 rounded-sm border ${twoMsg.includes('enabled') || twoMsg.includes('disabled') ? 'border-green/40 text-green' : 'border-red/40 text-red'}`}>
              {twoMsg}
            </div>
          )}
        </div>

        <form onSubmit={submit} className="panel p-6 space-y-4">
          <div className="flex items-center gap-2 text-mono text-[10px] text-amber uppercase tracking-wider">
            <KeyRound size={14} /> Change password
          </div>

          <label className="block">
            <span className="text-mono text-[10px] text-text-mute uppercase tracking-wider">Current password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className="input mt-1.5"
              required
            />
          </label>
          <label className="block">
            <span className="text-mono text-[10px] text-text-mute uppercase tracking-wider">New password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className="input mt-1.5"
              required
              minLength={8}
            />
          </label>
          <label className="block">
            <span className="text-mono text-[10px] text-text-mute uppercase tracking-wider">Confirm new password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={again}
              onChange={(e) => setAgain(e.target.value)}
              className="input mt-1.5"
              required
            />
          </label>

          {msg && (
            <div
              className={`flex items-center gap-2 text-sm px-3 py-2 rounded-sm border ${
                msg.startsWith('Password updated')
                  ? 'border-green/40 bg-green/5 text-green'
                  : 'border-red/40 bg-red/5 text-red'
              }`}
            >
              {msg.startsWith('Password updated') ? <Check size={14} /> : <AlertCircle size={14} />}
              {msg}
            </div>
          )}

          <button type="submit" disabled={mut.isPending} className="btn btn-primary w-full">
            {mut.isPending ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  );
}
