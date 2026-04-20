// ============================================================
// PublicPortal — /portal/*
// ------------------------------------------------------------
// The self-service page end-users land on when they tap a
// package card on the MikroTik captive-portal login.html.
//
// Routes handled inside this component:
//   /portal                 → package list (browse)
//   /portal/order           → auto-redirects with ?pkg=...
//   /portal/order?pkg=X     → step 1 → step 2 → step 3 → step 4
//   /portal/status/:code    → status lookup by order_code
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Routes, Route, Navigate,
  useNavigate, useParams, useSearchParams, Link,
} from 'react-router-dom';
import axios from 'axios';

const api = axios.create({ baseURL: '/api/portal', timeout: 20000 });

// ---------- shared primitives ----------
function Layout({ children, branding }) {
  const color = branding?.primary_color || '#f59e0b';
  const name = branding?.name || 'Skynity ISP';
  return (
    <div style={{
      minHeight: '100vh', background: '#0b0b0d', color: '#e7e7e9',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    }}>
      <style>{`
        *{box-sizing:border-box}
        a{color:${color};text-decoration:none}
        input,select,textarea{
          width:100%;padding:10px 12px;background:#0e0e11;border:1px solid #2a2a30;
          color:#e7e7e9;border-radius:6px;font-size:14px;font-family:inherit
        }
        input:focus,select:focus,textarea:focus{outline:none;border-color:${color}}
        .btn{
          display:inline-flex;align-items:center;justify-content:center;gap:6px;
          padding:10px 18px;background:${color};color:#0b0b0d;border:0;border-radius:6px;
          font-weight:600;cursor:pointer;font-size:14px;font-family:inherit
        }
        .btn[disabled]{opacity:.5;cursor:wait}
        .btn-ghost{background:transparent;color:#e7e7e9;border:1px solid #2a2a30}
        .card{background:#16161a;border:1px solid #2a2a30;border-radius:12px;padding:20px}
        .muted{color:#78787e;font-size:12px}
        .kicker{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:${color}}
        .label{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#78787e;margin-bottom:6px;display:block}
        .grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}
        .pkg{padding:16px;background:#16161a;border:1px solid #2a2a30;border-radius:10px;cursor:pointer;transition:.15s}
        .pkg:hover{border-color:${color};transform:translateY(-2px)}
        .pkg.sel{border-color:${color};box-shadow:0 0 0 1px ${color}}
        .tag{display:inline-block;padding:2px 6px;border-radius:3px;border:1px solid #2a2a30;font-size:10px;letter-spacing:.12em;text-transform:uppercase;background:#0e0e11}
        .tag-pppoe{color:#6ec9ff}
        .tag-hotspot{color:${color}}
        .step-dots{display:flex;gap:8px;margin:16px 0 24px}
        .step-dots span{width:24px;height:4px;background:#2a2a30;border-radius:2px}
        .step-dots span.on{background:${color}}
        .err{color:#ff6b6b;font-size:12px;margin-top:8px}
      `}</style>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px 80px' }}>
        <header style={{ textAlign: 'center', padding: '24px 0' }}>
          {branding?.logo_url
            ? <img src={branding.logo_url} alt={name} style={{ height: 48, marginBottom: 8 }} />
            : null}
          <h1 style={{ margin: 0, fontSize: 28, letterSpacing: '-.02em' }}>
            {name} <em style={{ color }}>portal</em>
          </h1>
          <p className="muted" style={{ margin: '6px 0 0' }}>Buy WiFi access in minutes</p>
        </header>
        {children}
      </div>
    </div>
  );
}

function useBranding() {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get('/packages').then((r) => setData(r.data)).catch(() => setData({}));
  }, []);
  return data;
}

// ===================================================================
// Page: Landing — list of packages
// ===================================================================
function Landing() {
  const nav = useNavigate();
  const info = useBranding();

  if (!info) return <Layout><div className="muted" style={{ textAlign: 'center' }}>Loading…</div></Layout>;

  const pkgs = info.packages || [];
  const sym = info.currency_symbol || '৳';

  return (
    <Layout branding={info.branding}>
      <div className="kicker" style={{ textAlign: 'center', marginBottom: 8 }}>Available packages</div>
      <h2 style={{ margin: '0 0 20px', textAlign: 'center', fontSize: 22 }}>Choose your <em style={{ color: info.branding?.primary_color || '#f59e0b' }}>plan</em></h2>

      {pkgs.length === 0 ? (
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="muted">No packages available right now.</div>
          {info.support_phone && <div style={{ marginTop: 8 }}>Call <a href={`tel:${info.support_phone}`}>{info.support_phone}</a></div>}
        </div>
      ) : (
        <div className="grid">
          {pkgs.map((p) => (
            <button
              key={p.code}
              onClick={() => nav(`/portal/order?pkg=${encodeURIComponent(p.code)}`)}
              className="pkg"
              style={{ textAlign: 'left', color: 'inherit', font: 'inherit' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span className={`tag tag-${p.service_type}`}>{p.service_type}</span>
                <span style={{ fontWeight: 700, color: info.branding?.primary_color || '#f59e0b' }}>
                  {sym}{Number(p.price).toFixed(0)}
                </span>
              </div>
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{p.name}</div>
              <div className="muted">{Number(p.rate_down_mbps)} Mbps · {Number(p.duration_days)} days</div>
              {p.description && <div className="muted" style={{ marginTop: 6 }}>{p.description}</div>}
            </button>
          ))}
        </div>
      )}

      <div style={{ marginTop: 24, textAlign: 'center' }}>
        <Link to="/portal/status" className="btn btn-ghost">Check order status →</Link>
      </div>
    </Layout>
  );
}

// ===================================================================
// Page: Order flow — /portal/order?pkg=...
// ===================================================================
function OrderFlow() {
  const [params] = useSearchParams();
  const pkgCode = params.get('pkg') || '';
  const mac = params.get('mac') || '';
  const info = useBranding();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ full_name: '', phone: '' });
  const [order, setOrder] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (!info) return <Layout><div className="muted" style={{ textAlign: 'center' }}>Loading…</div></Layout>;
  if (!pkgCode) return <Layout branding={info.branding}><NoPackage /></Layout>;

  const selected = (info.packages || []).find((p) => p.code === pkgCode);
  if (!selected) return <Layout branding={info.branding}><NoPackage code={pkgCode} /></Layout>;

  const createOrder = async (e) => {
    e?.preventDefault();
    setErr(''); setBusy(true);
    try {
      const { data } = await api.post('/orders', {
        package_code: pkgCode,
        full_name: form.full_name,
        phone: form.phone,
        mac,
      });
      setOrder(data);
      setStep(2);
    } catch (ex) {
      setErr(ex?.response?.data?.error || ex.message);
    } finally { setBusy(false); }
  };

  return (
    <Layout branding={info.branding}>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span className={`tag tag-${selected.service_type}`}>{selected.service_type}</span>
          <span style={{ fontWeight: 700, color: info.branding?.primary_color || '#f59e0b', fontSize: 18 }}>
            {info.currency_symbol || '৳'}{Number(selected.price).toFixed(0)}
          </span>
        </div>
        <div style={{ fontSize: 18, fontWeight: 600 }}>{selected.name}</div>
        <div className="muted" style={{ marginTop: 2 }}>{Number(selected.rate_down_mbps)} Mbps · {Number(selected.duration_days)} days</div>
        {selected.description && <div className="muted" style={{ marginTop: 8 }}>{selected.description}</div>}

        <div className="step-dots">
          <span className={step >= 1 ? 'on' : ''} />
          <span className={step >= 2 ? 'on' : ''} />
          <span className={step >= 3 ? 'on' : ''} />
          <span className={step >= 4 ? 'on' : ''} />
        </div>

        {step === 1 && (
          <form onSubmit={createOrder}>
            <div style={{ marginBottom: 12 }}>
              <label className="label">Your full name</label>
              <input
                required minLength={2} maxLength={100}
                value={form.full_name}
                onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                placeholder="e.g. Rahim Uddin"
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label className="label">Mobile number</label>
              <input
                required inputMode="tel" pattern="[\d+\- ]{7,20}"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="01XXXXXXXXX"
              />
            </div>
            {mac && <div className="muted" style={{ marginBottom: 12 }}>MAC: <code>{mac}</code></div>}
            {err && <div className="err">{err}</div>}
            <button type="submit" className="btn" disabled={busy} style={{ marginTop: 8 }}>
              {busy ? 'Creating…' : 'Continue to payment →'}
            </button>
          </form>
        )}

        {step === 2 && order && (
          <PaymentStep
            order={order}
            branding={info.branding}
            sym={info.currency_symbol || '৳'}
            onSubmitted={() => setStep(3)}
          />
        )}

        {step === 3 && order && (
          <WaitStep orderCode={order.order_code} onApproved={() => setStep(4)} onDone={setOrder} />
        )}

        {step === 4 && order?.subscription && (
          <CredsStep order={order} />
        )}
      </div>
    </Layout>
  );
}

function NoPackage({ code }) {
  return (
    <div className="card" style={{ textAlign: 'center' }}>
      <div className="muted">Package {code ? <code>{code}</code> : ''} not found or no longer available.</div>
      <Link to="/portal" className="btn btn-ghost" style={{ marginTop: 12 }}>← Choose another package</Link>
    </div>
  );
}

// ---------- step 2: payment ----------
function PaymentStep({ order, branding, sym, onSubmitted }) {
  const [method, setMethod] = useState('bkash');
  const [trx, setTrx] = useState('');
  const [sender, setSender] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const color = branding?.primary_color || '#f59e0b';
  const bkash = order.payment?.bkash || {};
  const nagad = order.payment?.nagad || {};
  const chosenNumber = method === 'bkash' ? bkash.number : method === 'nagad' ? nagad.number : '';
  const chosenType   = method === 'bkash' ? bkash.type   : method === 'nagad' ? nagad.type   : '';

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const fd = new FormData();
      fd.append('method', method);
      fd.append('trx_id', trx);
      if (sender) fd.append('sender_number', sender);
      if (file) fd.append('screenshot', file);
      await api.post(`/orders/${order.order_code}/payment`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onSubmitted();
    } catch (ex) {
      setErr(ex?.response?.data?.error || ex.message);
    } finally { setBusy(false); }
  };

  return (
    <>
      <div style={{ padding: 12, background: '#0e0e11', border: `1px solid ${color}33`, borderRadius: 8, marginBottom: 16 }}>
        <div className="kicker" style={{ color }}>Pay {sym}{Number(order.amount).toFixed(0)} to</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button type="button" onClick={() => setMethod('bkash')} className="btn btn-ghost" style={method === 'bkash' ? { borderColor: color, color } : {}}>bKash</button>
          <button type="button" onClick={() => setMethod('nagad')} className="btn btn-ghost" style={method === 'nagad' ? { borderColor: color, color } : {}}>Nagad</button>
          <button type="button" onClick={() => setMethod('other')} className="btn btn-ghost" style={method === 'other' ? { borderColor: color, color } : {}}>Other</button>
        </div>
        {method !== 'other' && chosenNumber ? (
          <div style={{ marginTop: 12 }}>
            <div className="muted">Send Money to ({chosenType || 'personal'})</div>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '.02em' }}>{chosenNumber}</div>
            <div className="muted" style={{ marginTop: 4 }}>Reference: <code>{order.order_code}</code></div>
          </div>
        ) : method !== 'other' ? (
          <div className="muted" style={{ marginTop: 8 }}>No {method} number configured yet — please use a different method or contact support.</div>
        ) : null}
      </div>

      <form onSubmit={submit}>
        <div style={{ marginBottom: 12 }}>
          <label className="label">Transaction ID (TrxID)</label>
          <input required value={trx} onChange={(e) => setTrx(e.target.value)} placeholder="e.g. 9FL3X8HC1A" />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label className="label">Your number used to send payment</label>
          <input value={sender} onChange={(e) => setSender(e.target.value)} placeholder="01XXXXXXXXX (optional)" />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label className="label">Payment screenshot (optional)</label>
          <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </div>
        {err && <div className="err">{err}</div>}
        <button type="submit" className="btn" disabled={busy} style={{ marginTop: 8 }}>
          {busy ? 'Submitting…' : 'Submit payment proof →'}
        </button>
      </form>
    </>
  );
}

// ---------- step 3: wait for admin approval ----------
function WaitStep({ orderCode, onApproved, onDone }) {
  const [status, setStatus] = useState('payment_submitted');
  const [lastErr, setLastErr] = useState('');
  const timerRef = useRef(null);

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const { data } = await api.get(`/orders/${orderCode}`);
        if (!alive) return;
        setStatus(data.status);
        if (data.subscription) onDone({ ...data, order_code: orderCode });
        if (data.status === 'approved') { onApproved(); return; }
        if (data.status === 'rejected') { return; }
      } catch (ex) {
        setLastErr(ex.message);
      }
      timerRef.current = setTimeout(poll, 5000);
    }
    poll();
    return () => { alive = false; clearTimeout(timerRef.current); };
  }, [orderCode, onApproved, onDone]);

  if (status === 'rejected') {
    return (
      <div style={{ textAlign: 'center', padding: '16px 0' }}>
        <div style={{ fontSize: 48 }}>✗</div>
        <div style={{ fontSize: 18, fontWeight: 600, color: '#ff6b6b', marginTop: 8 }}>Order rejected</div>
        <div className="muted" style={{ marginTop: 6 }}>Please contact support for help.</div>
        <Link to="/portal" className="btn btn-ghost" style={{ marginTop: 16 }}>← Try another package</Link>
      </div>
    );
  }

  return (
    <div style={{ textAlign: 'center', padding: '16px 0' }}>
      <div style={{ fontSize: 48 }}>⏳</div>
      <div style={{ fontSize: 18, fontWeight: 600, marginTop: 8 }}>Waiting for admin verification…</div>
      <div className="muted" style={{ marginTop: 6 }}>We will show your WiFi login as soon as it's approved. This page auto-refreshes.</div>
      <div className="muted" style={{ marginTop: 16 }}>Order: <code>{orderCode}</code></div>
      {lastErr && <div className="err" style={{ marginTop: 8 }}>{lastErr}</div>}
    </div>
  );
}

// ---------- step 4: credentials ----------
function CredsStep({ order }) {
  const s = order.subscription;
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 48 }}>✓</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 8 }}>You're in!</div>
      <div className="muted" style={{ marginTop: 6 }}>Use these credentials to log in to the WiFi.</div>
      <div style={{ marginTop: 16, padding: 16, background: '#0e0e11', border: '1px solid #2a2a30', borderRadius: 8, textAlign: 'left', display: 'inline-block', minWidth: 280 }}>
        <div className="muted">Username</div>
        <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{s.login_username}</div>
        <div className="muted" style={{ marginTop: 10 }}>Password</div>
        <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{s.login_password}</div>
        <div className="muted" style={{ marginTop: 10 }}>Expires</div>
        <div>{new Date(s.expires_at).toLocaleString()}</div>
      </div>
      <div style={{ marginTop: 16 }}>
        <button onClick={() => window.location.reload()} className="btn">Go back to WiFi login</button>
      </div>
      {s.mt_synced === 0 && (
        <div className="muted" style={{ marginTop: 10 }}>
          Note: your account is created but router sync is pending. It should work within a minute.
        </div>
      )}
    </div>
  );
}

// ===================================================================
// Page: Status lookup by code  — /portal/status/:code (or ?code=)
// ===================================================================
function StatusLookup() {
  const { code: paramCode } = useParams();
  const [code, setCode] = useState(paramCode || '');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const info = useBranding();

  const check = async (e) => {
    e?.preventDefault();
    setErr(''); setBusy(true);
    try {
      const { data } = await api.get(`/orders/${encodeURIComponent(code.trim())}`);
      setData(data);
    } catch (ex) {
      setErr(ex?.response?.data?.error || ex.message);
      setData(null);
    } finally { setBusy(false); }
  };

  useEffect(() => { if (paramCode) check(); /* eslint-disable-next-line */ }, [paramCode]);

  return (
    <Layout branding={info?.branding}>
      <div className="card">
        <h2 style={{ margin: '0 0 12px' }}>Check <em style={{ color: info?.branding?.primary_color || '#f59e0b' }}>order status</em></h2>
        <form onSubmit={check} style={{ display: 'flex', gap: 8 }}>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ORD-YYYYMMDD-XXXXXX" required />
          <button className="btn" disabled={busy || !code}>{busy ? '…' : 'Check'}</button>
        </form>
        {err && <div className="err">{err}</div>}
        {data && (
          <div style={{ marginTop: 16 }}>
            <div className="muted">Order <code>{data.order_code}</code></div>
            <div style={{ fontSize: 18, fontWeight: 600, marginTop: 6 }}>{data.package?.name} — {data.status}</div>
            {data.subscription && (
              <div style={{ marginTop: 12, padding: 12, background: '#0e0e11', border: '1px solid #2a2a30', borderRadius: 8 }}>
                <div className="muted">Username</div>
                <div style={{ fontWeight: 700 }}>{data.subscription.login_username}</div>
                <div className="muted" style={{ marginTop: 6 }}>Password</div>
                <div style={{ fontWeight: 700 }}>{data.subscription.login_password}</div>
                <div className="muted" style={{ marginTop: 6 }}>Expires</div>
                <div>{new Date(data.subscription.expires_at).toLocaleString()}</div>
              </div>
            )}
            {data.status === 'rejected' && (
              <div className="err" style={{ marginTop: 12 }}>Rejected: {data.rejected_reason || 'no reason given'}</div>
            )}
          </div>
        )}
        <Link to="/portal" className="btn btn-ghost" style={{ marginTop: 16 }}>← Browse packages</Link>
      </div>
    </Layout>
  );
}

// ===================================================================
// Root component — owns its own BrowserRouter so it can be mounted
// completely outside the admin app.
// ===================================================================
export default function PublicPortal() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/order" element={<OrderFlow />} />
      <Route path="/status" element={<StatusLookup />} />
      <Route path="/status/:code" element={<StatusLookup />} />
      <Route path="*" element={<Navigate to="/portal" replace />} />
    </Routes>
  );
}
