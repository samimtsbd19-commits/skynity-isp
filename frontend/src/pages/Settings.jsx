import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, AlertCircle, Check } from 'lucide-react';
import { apiChangePassword } from '../api/client';
import { PageHeader } from '../components/PageHeader';

export default function Settings() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [msg, setMsg] = useState('');
  const qc = useQueryClient();

  const mut = useMutation({
    mutationFn: () => apiChangePassword(current, next),
    onSuccess: () => {
      setMsg('Password updated.');
      setCurrent('');
      setNext('');
      setAgain('');
      qc.invalidateQueries({ queryKey: ['activity-log'] });
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
      <div className="px-8 py-6 max-w-md">
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
