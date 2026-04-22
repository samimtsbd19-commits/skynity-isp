import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Satellite, ArrowRight, AlertCircle } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { apiLogin2fa } from '../api/client';

export default function Login() {
  const { login, loading, setSession } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [step, setStep] = useState('password');
  const [sessionId, setSessionId] = useState('');
  const [code, setCode] = useState('');
  const [twoLoading, setTwoLoading] = useState(false);

  async function submitPassword(e) {
    e.preventDefault();
    setErr('');
    try {
      const out = await login(username, password);
      if (out?.needs2fa) {
        setSessionId(out.sessionId);
        setStep('2fa');
        return;
      }
      if (out?.admin?.must_change_password) {
        nav('/change-password');
        return;
      }
      nav('/');
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'Login failed');
    }
  }

  async function submit2fa(e) {
    e.preventDefault();
    setErr('');
    setTwoLoading(true);
    try {
      const data = await apiLogin2fa(sessionId, code);
      setSession(data.token, data.admin);
      if (data.admin?.must_change_password) {
        nav('/change-password');
        return;
      }
      nav('/');
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'Invalid code');
    } finally {
      setTwoLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex relative overflow-hidden">
      <div className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full bg-amber/10 blur-[120px]" />
      <div className="absolute -bottom-40 -right-40 w-[500px] h-[500px] rounded-full bg-cyan/5 blur-[120px]" />

      <div className="hidden lg:flex flex-col justify-between w-1/2 p-14 border-r border-border-dim relative">
        <div className="absolute inset-0 grid-overlay" />
        <div className="relative">
          <div className="flex items-center gap-2">
            <Satellite size={16} className="text-amber" strokeWidth={1.5} />
            <span className="text-mono text-xs uppercase tracking-[0.3em] text-text-dim">
              Skynity · Operations
            </span>
          </div>
        </div>
        <div className="relative">
          <div className="text-mono text-[11px] text-amber uppercase tracking-[0.25em] mb-6">
            Est. MMXXVI · Dhaka, BD
          </div>
          <h1 className="text-display text-6xl xl:text-7xl leading-[0.95]">
            The&nbsp;
            <em>control room</em>
            <br />
            for your
            <br />
            internet empire.
          </h1>
          <p className="mt-8 text-text-dim text-base max-w-md leading-relaxed">
            A dedicated operations console for MikroTik-powered ISPs. Customer
            lifecycle, billing, and network health — one screen, no noise.
          </p>
        </div>
        <div className="relative text-mono text-[10px] text-text-mute uppercase tracking-wider">
          v0.3 · phase 3
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8 relative">
        {step === 'password' ? (
          <form onSubmit={submitPassword} className="w-full max-w-sm relative">
            <div className="flex items-center gap-2 lg:hidden mb-10">
              <Satellite size={16} className="text-amber" strokeWidth={1.5} />
              <span className="text-mono text-xs uppercase tracking-[0.3em] text-text-dim">Skynity</span>
            </div>
            <div className="text-mono text-[10px] text-amber uppercase tracking-[0.25em] mb-2">Secure sign-in</div>
            <h2 className="text-display text-4xl mb-1">Welcome back.</h2>
            <p className="text-text-dim text-sm mb-8">Enter your operator credentials to continue.</p>
            <label className="block mb-4">
              <span className="text-mono text-[10px] text-text-mute uppercase tracking-wider">Username</span>
              <input type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} className="input mt-1.5" required />
            </label>
            <label className="block mb-6">
              <span className="text-mono text-[10px] text-text-mute uppercase tracking-wider">Password</span>
              <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="input mt-1.5" required />
            </label>
            {err && (
              <div className="mb-4 px-3 py-2 border border-red/40 bg-red/5 text-red text-sm flex items-center gap-2 rounded-sm">
                <AlertCircle size={14} /> {err}
              </div>
            )}
            <button type="submit" disabled={loading} className="btn btn-primary w-full group">
              {loading ? 'Authenticating…' : (<>Enter console <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" /></>)}
            </button>
            <div className="mt-8 pt-6 border-t border-border-dim">
              <div className="text-mono text-[10px] text-text-mute uppercase tracking-wider">
                First deploy? Default: <span className="text-text-dim">admin / admin123</span> —
                change immediately after first login.
              </div>
            </div>
          </form>
        ) : (
          <form onSubmit={submit2fa} className="w-full max-w-sm relative">
            <div className="text-mono text-[10px] text-amber uppercase tracking-[0.25em] mb-2">Two-factor authentication</div>
            <h2 className="text-display text-4xl mb-1">Verification code</h2>
            <p className="text-text-dim text-sm mb-8">
              Open your authenticator app and enter the 6-digit code, or use a one-time backup code.
            </p>
            <label className="block mb-6">
              <span className="text-mono text-[10px] text-text-mute uppercase tracking-wider">Code</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="input mt-1.5 font-mono tracking-widest"
                placeholder="000000"
                required
              />
            </label>
            {err && (
              <div className="mb-4 px-3 py-2 border border-red/40 bg-red/5 text-red text-sm flex items-center gap-2 rounded-sm">
                <AlertCircle size={14} /> {err}
              </div>
            )}
            <button type="submit" disabled={twoLoading} className="btn btn-primary w-full">
              {twoLoading ? 'Verifying…' : 'Verify and continue'}
            </button>
            <button
              type="button"
              className="btn btn-ghost w-full mt-3 text-sm"
              onClick={() => { setStep('password'); setCode(''); setErr(''); }}
            >
              Back to password
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
