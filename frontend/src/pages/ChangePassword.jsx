import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Satellite, ArrowRight, AlertCircle } from 'lucide-react';
import { apiChangePassword } from '../api/client';

export default function ChangePassword() {
  const nav = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (next.length < 8) {
      setErr('New password must be at least 8 characters.');
      return;
    }
    if (next !== again) {
      setErr('New passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await apiChangePassword(current, next);
      nav('/');
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'Failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-8 relative">
      <div className="absolute -top-40 -left-40 w-[500px] h-[500px] rounded-full bg-amber/10 blur-[100px]" />
      <form onSubmit={submit} className="w-full max-w-sm panel p-8 relative">
        <div className="flex items-center gap-2 mb-6">
          <Satellite size={16} className="text-amber" strokeWidth={1.5} />
          <span className="text-mono text-xs uppercase tracking-[0.2em] text-text-dim">Security</span>
        </div>
        <h1 className="text-display text-3xl italic mb-1">Change password</h1>
        <p className="text-text-dim text-sm mb-6">
          Your account requires a new password before continuing.
        </p>
        <label className="block mb-4">
          <span className="text-mono text-[10px] text-text-mute uppercase tracking-wider">Current password</span>
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className="input mt-1.5" required />
        </label>
        <label className="block mb-4">
          <span className="text-mono text-[10px] text-text-mute uppercase tracking-wider">New password</span>
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className="input mt-1.5" required minLength={8} />
        </label>
        <label className="block mb-6">
          <span className="text-mono text-[10px] text-text-mute uppercase tracking-wider">Confirm new password</span>
          <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className="input mt-1.5" required />
        </label>
        {err && (
          <div className="mb-4 px-3 py-2 border border-red/40 bg-red/5 text-red text-sm flex items-center gap-2 rounded-sm">
            <AlertCircle size={14} /> {err}
          </div>
        )}
        <button type="submit" disabled={loading} className="btn btn-primary w-full">
          {loading ? 'Saving…' : (<>Continue <ArrowRight size={15} className="inline ml-1" /></>)}
        </button>
      </form>
    </div>
  );
}
