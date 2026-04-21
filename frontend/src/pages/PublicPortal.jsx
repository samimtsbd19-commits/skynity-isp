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
import { useLang, useT, LANG_LABELS } from '../i18n';

const api = axios.create({ baseURL: '/api/portal', timeout: 20000 });

// ---------- shared primitives ----------
function Layout({ children, branding, support }) {
  const color = branding?.primary_color || '#f59e0b';
  const name = branding?.name || 'Skynity ISP';
  const { lang, setLang, available } = useLang();
  const t = useT();
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
        {/* Language switcher — top-right corner, always accessible */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: -16 }}>
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            style={{
              width: 'auto', padding: '4px 8px', fontSize: 12,
              background: '#16161a', border: '1px solid #2a2a30', borderRadius: 4,
              color: '#cbd5e1',
            }}
            aria-label={t('common.language')}
          >
            {available.map((code) => (
              <option key={code} value={code}>{LANG_LABELS[code] || code}</option>
            ))}
          </select>
        </div>
        <header style={{ textAlign: 'center', padding: '24px 0' }}>
          {branding?.logo_url
            ? <img src={branding.logo_url} alt={name} style={{ height: 48, marginBottom: 8 }} />
            : null}
          <h1 style={{ margin: 0, fontSize: 28, letterSpacing: '-.02em' }}>
            {name} <em style={{ color }}>{lang === 'bn' ? 'পোর্টাল' : 'portal'}</em>
          </h1>
          <p className="muted" style={{ margin: '6px 0 0' }}>{t('portal.tagline')}</p>
        </header>
        {children}
        <PortalFooter branding={branding} support={support} />
      </div>
      <SupportFab support={support} color={color} />
    </div>
  );
}

// ===================================================================
// Floating "Chat with support" button — appears on every portal
// page if at least one support channel is configured.
// ===================================================================
function SupportFab({ support, color }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  if (!support) return null;
  const channels = [];
  if (support.whatsapp) channels.push({
    key: 'whatsapp', label: 'WhatsApp', icon: '💬', color: '#25d366',
    href: `https://wa.me/${String(support.whatsapp).replace(/[^\d]/g, '')}?text=${encodeURIComponent('Hi! I need help with my internet.')}`,
  });
  if (support.telegram) channels.push({
    key: 'telegram', label: 'Telegram', icon: '📨', color: '#229ed9',
    href: support.telegram.startsWith('http')
      ? support.telegram
      : `https://t.me/${support.telegram.replace(/^@/, '')}`,
  });
  if (support.messenger) channels.push({
    key: 'messenger', label: 'Messenger', icon: '💬', color: '#006aff',
    href: support.messenger,
  });
  if (support.email) channels.push({
    key: 'email', label: 'Email', icon: '✉️', color: '#6b7280',
    href: `mailto:${support.email}`,
  });
  if (!channels.length) return null;

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={t('portal.chat')}
        title={t('portal.chat')}
        style={{
          position: 'fixed', right: 16, bottom: 16, zIndex: 90,
          width: 54, height: 54, borderRadius: '50%', border: 0, cursor: 'pointer',
          background: color, color: '#0b0b0d', fontSize: 24,
          boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
        }}
      >{open ? '×' : '💬'}</button>
      {open && (
        <div style={{
          position: 'fixed', right: 16, bottom: 80, zIndex: 90,
          background: '#16161a', border: '1px solid #2a2a30', borderRadius: 12,
          padding: 14, width: 260, boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
        }}>
          <div className="kicker" style={{ marginBottom: 6 }}>Need a hand?</div>
          <div style={{ fontSize: 13, marginBottom: 10, color: '#cbd5e1' }}>
            Pick a channel — we usually reply within a few minutes.
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {channels.map((c) => (
              <a
                key={c.key}
                href={c.href}
                target="_blank" rel="noopener noreferrer"
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                  border: '1px solid #2a2a30', borderRadius: 8,
                  color: '#e7e7e9', background: '#0e0e11',
                }}
              >
                <span style={{ color: c.color, fontSize: 18 }}>{c.icon}</span>
                <span>{c.label}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ===================================================================
// Portal footer — social links + legal links + help link.
// ===================================================================
function PortalFooter({ branding, support }) {
  const color = branding?.primary_color || '#f59e0b';
  const s = support || {};
  const hasSocial = s.facebook || s.youtube || s.website;
  const t = useT();
  return (
    <footer style={{
      marginTop: 40, paddingTop: 20, borderTop: '1px solid #2a2a30',
      textAlign: 'center', fontSize: 12, color: '#78787e',
    }}>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 10 }}>
        <Link to="/portal/help" style={{ color }}>{t('portal.help')}</Link>
        {s.facebook && <a href={s.facebook} target="_blank" rel="noopener noreferrer">Facebook</a>}
        {s.youtube  && <a href={s.youtube}  target="_blank" rel="noopener noreferrer">YouTube</a>}
        {s.website  && <a href={s.website}  target="_blank" rel="noopener noreferrer">Website</a>}
      </div>
      {hasSocial && <div style={{ opacity: .6 }}>© {new Date().getFullYear()} {branding?.name || 'Skynity'}</div>}
    </footer>
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
// Active marketing offers — shown at the top of the landing page.
// The backend honours the `feature.offers_portal` flag, so we just
// trust whatever it hands back.
// ===================================================================
function useActiveOffers() {
  const [offers, setOffers] = useState([]);
  useEffect(() => {
    api.get('/offers')
      .then((r) => setOffers(r.data?.offers || []))
      .catch(() => setOffers([]));
  }, []);
  return offers;
}

// ===================================================================
// Page: Landing — list of packages
// ===================================================================
function Landing() {
  const nav = useNavigate();
  const info = useBranding();
  const offers = useActiveOffers();
  const t = useT();

  if (!info) return <Layout><div className="muted" style={{ textAlign: 'center' }}>{t('common.loading')}</div></Layout>;

  const pkgs = info.packages || [];
  const sym = info.currency_symbol || '৳';
  const flags = info.flags || {};
  const apps  = info.apps  || {};
  const content = info.content || {};
  const support = info.support || {};
  const color = info.branding?.primary_color || '#f59e0b';

  // Packages that are featured by any active offer — we highlight
  // their card and show a small "offer" ribbon.
  const featuredCodes = new Set(offers.map((o) => o.package_code).filter(Boolean));

  return (
    <Layout branding={info.branding} support={support}>
      {/* About us — admin-editable intro */}
      {(content.intro_title || content.intro_html) && (
        <div className="card" style={{
          marginBottom: 20,
          background: `linear-gradient(135deg, ${color}11, transparent)`,
          border: `1px solid ${color}33`,
        }}>
          {content.intro_title && (
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>
              {content.intro_title}
            </div>
          )}
          {content.intro_html && (
            <div style={{ fontSize: 13, color: '#cbd5e1', whiteSpace: 'pre-line' }}>
              {content.intro_html}
            </div>
          )}
        </div>
      )}

      {/* Top promo row — free trial + PWA install + app download */}
      {(flags.free_trial || flags.pwa_install || apps.android_url || apps.ios_url) && (
        <div style={{ marginBottom: 20, display: 'grid', gap: 10 }}>
          {flags.free_trial && <TrialBanner color={color} />}
          {flags.pwa_install && <InstallBanner />}
          {(apps.android_url || apps.ios_url) && <AppDownloadBanner apps={apps} color={color} />}
        </div>
      )}

      {/* Active marketing offers — each card scrolls the user down
          to the featured package or opens the full order flow. */}
      {offers.length > 0 && (
        <div style={{ marginBottom: 20, display: 'grid', gap: 10 }}>
          {offers.map((o) => (
            <OfferBanner
              key={o.id}
              offer={o}
              color={color}
              onClick={() => {
                if (o.package_code) {
                  nav(`/portal/order?pkg=${encodeURIComponent(o.package_code)}&offer=${encodeURIComponent(o.code)}`);
                }
              }}
            />
          ))}
        </div>
      )}

      <div className="kicker" style={{ textAlign: 'center', marginBottom: 8 }}>Available packages</div>
      <h2 style={{ margin: '0 0 20px', textAlign: 'center', fontSize: 22 }}>Choose your <em style={{ color }}>plan</em></h2>

      {pkgs.length === 0 ? (
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="muted">No packages available right now.</div>
          {info.support_phone && <div style={{ marginTop: 8 }}>Call <a href={`tel:${info.support_phone}`}>{info.support_phone}</a></div>}
        </div>
      ) : (
        <div className="grid">
          {pkgs.map((p) => {
            const featured = featuredCodes.has(p.code);
            return (
              <button
                key={p.code}
                onClick={() => nav(`/portal/order?pkg=${encodeURIComponent(p.code)}`)}
                className="pkg"
                style={{
                  textAlign: 'left', color: 'inherit', font: 'inherit',
                  position: 'relative',
                  ...(featured
                    ? {
                        borderColor: color,
                        boxShadow: `0 0 0 1px ${color}, 0 0 22px ${color}33`,
                      }
                    : {}),
                }}
              >
                {featured && (
                  <span style={{
                    position: 'absolute', top: -8, right: 10,
                    background: color, color: '#0b0b0d', fontSize: 10,
                    fontWeight: 700, padding: '3px 8px', borderRadius: 4,
                    letterSpacing: '.1em', textTransform: 'uppercase',
                  }}>
                    🔥 Offer
                  </span>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span className={`tag tag-${p.service_type}`}>{p.service_type}</span>
                  <span style={{ fontWeight: 700, color }}>
                    {sym}{Number(p.price).toFixed(0)}
                  </span>
                </div>
                <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{p.name}</div>
                <div className="muted">{Number(p.rate_down_mbps)} Mbps · {Number(p.duration_days)} days</div>
                {p.description && <div className="muted" style={{ marginTop: 6 }}>{p.description}</div>}
              </button>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 32, display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
        {flags.vouchers_portal !== false && (
          <Link to="/portal/redeem" className="btn">🎟 {t('portal.redeem')}</Link>
        )}
        <Link to="/portal/login"  className="btn btn-ghost">↻ {t('portal.login')}</Link>
        {flags.customer_accounts && (
          <Link to="/portal/account" className="btn btn-ghost">👤 {t('portal.myAccount')}</Link>
        )}
        <Link to="/portal/status" className="btn btn-ghost">🔎 {t('portal.checkStatus')}</Link>
      </div>

      {/* App download row */}
      {flags.show_download_button && (apps.android_url || apps.ios_url) && (
        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Prefer the app?</div>
          <div style={{ display: 'inline-flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            {apps.android_url && (
              <a className="btn btn-ghost" href={apps.android_url} target="_blank" rel="noopener noreferrer">
                📱 Android
              </a>
            )}
            {apps.ios_url && (
              <a className="btn btn-ghost" href={apps.ios_url} target="_blank" rel="noopener noreferrer">
                🍏 iOS
              </a>
            )}
          </div>
        </div>
      )}

      {/* User guide / rules / troubleshooting — expandable so the
          page stays short for repeat visitors but is fully
          informative on first load. */}
      <div style={{ marginTop: 32, display: 'grid', gap: 12 }}>
        {content.guide_html && (
          <ContentBlock
            title="📘 How it works"
            kicker="User guide"
            body={content.guide_html}
            defaultOpen
            color={color}
          />
        )}
        {content.rules_html && (
          <ContentBlock
            title="⚠️ Rules & fair-use"
            kicker="Please read"
            body={content.rules_html}
            color={color}
          />
        )}
        {content.troubleshoot_html && (
          <ContentBlock
            title="🔧 Having trouble?"
            kicker="Troubleshooting"
            body={content.troubleshoot_html}
            color={color}
          />
        )}
        {content.support_hours && (
          <div style={{
            textAlign: 'center', fontSize: 12, color: '#94a3b8',
            padding: '10px 14px', border: '1px dashed #2a2a30', borderRadius: 8,
          }}>
            {content.support_hours}
          </div>
        )}
      </div>
    </Layout>
  );
}

// ===================================================================
// Collapsible content block for admin-editable portal copy.
// ===================================================================
function ContentBlock({ title, kicker, body, defaultOpen = false, color }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%', padding: '14px 18px', background: 'transparent',
          border: 0, color: 'inherit', textAlign: 'left', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 10,
        }}
      >
        <div style={{ flex: 1 }}>
          {kicker && <div className="kicker" style={{ marginBottom: 4 }}>{kicker}</div>}
          <div style={{ fontWeight: 600, fontSize: 15 }}>{title}</div>
        </div>
        <div style={{
          color, fontSize: 18, transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
          transition: 'transform .2s',
        }}>⌄</div>
      </button>
      {open && (
        <div style={{
          padding: '0 18px 16px', fontSize: 13, color: '#cbd5e1',
          whiteSpace: 'pre-line',
        }}>
          {body}
        </div>
      )}
    </div>
  );
}

// ===================================================================
// Single offer banner — admin-authored promo card.
// ===================================================================
function OfferBanner({ offer, color, onClick }) {
  return (
    <button
      onClick={onClick}
      className="card"
      disabled={!offer.package_code}
      style={{
        background: `linear-gradient(135deg, ${color}22, ${color}08)`,
        border: `1px solid ${color}66`,
        textAlign: 'left', cursor: offer.package_code ? 'pointer' : 'default',
        color: 'inherit', display: 'block', width: '100%',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <div style={{
          fontSize: 28, lineHeight: 1,
          filter: `drop-shadow(0 0 8px ${color}aa)`,
        }}>🎁</div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            {offer.discount_label && (
              <span style={{
                background: color, color: '#0b0b0d',
                fontSize: 10, fontWeight: 700, padding: '2px 6px',
                borderRadius: 3, letterSpacing: '.08em', textTransform: 'uppercase',
              }}>{offer.discount_label}</span>
            )}
            <span style={{ fontWeight: 700, fontSize: 16 }}>{offer.title}</span>
          </div>
          {offer.description && (
            <div className="muted" style={{ color: '#cbd5e1', whiteSpace: 'pre-line' }}>
              {offer.description}
            </div>
          )}
          {offer.package_name && (
            <div style={{ marginTop: 6, fontSize: 12, color }}>
              📦 {offer.package_name}{' '}
              {offer.package_price ? `— ৳${Number(offer.package_price).toFixed(0)}` : ''}
              {offer.rate_down_mbps ? ` · ${Number(offer.rate_down_mbps)} Mbps` : ''}
              {offer.duration_days ? ` · ${Number(offer.duration_days)} days` : ''}
            </div>
          )}
        </div>
        {offer.package_code && (
          <span style={{ color, fontWeight: 600, fontSize: 13 }}>Get it →</span>
        )}
      </div>
    </button>
  );
}

// ===================================================================
// Top-of-landing banners
// ===================================================================
function TrialBanner({ color }) {
  const nav = useNavigate();
  return (
    <button
      onClick={() => nav('/portal/trial')}
      className="card"
      style={{
        background: `linear-gradient(135deg, ${color}22, ${color}08)`,
        border: `1px solid ${color}55`,
        textAlign: 'left', cursor: 'pointer', color: 'inherit',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 28 }}>🎁</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>7 days free — on us</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            One free trial per phone. Claim from our WiFi and connect right away.
          </div>
        </div>
        <div style={{ color, fontWeight: 700 }}>Start →</div>
      </div>
    </button>
  );
}

function AppDownloadBanner({ apps, color }) {
  return (
    <div
      className="card"
      style={{
        background: `linear-gradient(135deg, ${color}18, transparent)`,
        border: `1px solid ${color}44`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 28 }}>📱</div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Get the mobile app</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            Manage your plan, see live speed, and get instant offer alerts.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {apps.android_url && (
            <a
              href={apps.android_url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn"
              style={{ background: color, color: '#111', fontWeight: 600 }}
            >
              Android ↓
            </a>
          )}
          {apps.ios_url && (
            <a
              href={apps.ios_url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost"
            >
              iOS ↓
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function InstallBanner() {
  const [deferred, setDeferred] = useState(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const h = (e) => { e.preventDefault(); setDeferred(e); };
    window.addEventListener('beforeinstallprompt', h);
    const ih = () => setInstalled(true);
    window.addEventListener('appinstalled', ih);
    return () => {
      window.removeEventListener('beforeinstallprompt', h);
      window.removeEventListener('appinstalled', ih);
    };
  }, []);

  if (installed || !deferred) return null;

  return (
    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ fontSize: 22 }}>📲</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>Install this portal as an app</div>
        <div className="muted" style={{ fontSize: 11 }}>One-tap access from your home screen.</div>
      </div>
      <button
        className="btn btn-ghost"
        onClick={async () => {
          deferred.prompt();
          const r = await deferred.userChoice;
          if (r.outcome !== 'dismissed') setDeferred(null);
        }}
      >Install</button>
    </div>
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
// Page: Voucher redeem — /portal/redeem
// ===================================================================
function Redeem() {
  const [code, setCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const info = useBranding();

  // Lookup package info as soon as the user types a full-looking code.
  useEffect(() => {
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length < 10) { setPreview(null); return; }
    let alive = true;
    api.get(`/vouchers/${encodeURIComponent(trimmed)}/info`)
      .then((r) => { if (alive) setPreview(r.data); })
      .catch(() => { if (alive) setPreview(null); });
    return () => { alive = false; };
  }, [code]);

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const { data } = await api.post('/vouchers/redeem', {
        code: code.trim(),
        full_name: fullName.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      setResult(data);
    } catch (ex) {
      setErr(ex?.response?.data?.error || ex.message);
    } finally { setBusy(false); }
  };

  if (result) {
    const s = result.subscription;
    return (
      <Layout branding={info?.branding}>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48 }}>✓</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 8 }}>Voucher activated</div>
          <div className="muted" style={{ marginTop: 6 }}>Use these credentials to log in to the WiFi.</div>

          <div style={{ marginTop: 16, padding: 16, background: '#0e0e11', border: '1px solid #2a2a30', borderRadius: 8, textAlign: 'left', display: 'inline-block', minWidth: 280 }}>
            <div className="muted">Package</div>
            <div style={{ fontWeight: 700 }}>{result.package.name}</div>
            <div className="muted" style={{ marginTop: 10 }}>Username</div>
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
              Account created — router sync is pending, it should work within a minute.
            </div>
          )}
        </div>
      </Layout>
    );
  }

  const color = info?.branding?.primary_color || '#f59e0b';
  const sym = info?.currency_symbol || '৳';

  return (
    <Layout branding={info?.branding}>
      <div className="card">
        <div className="kicker" style={{ marginBottom: 4 }}>Prepaid</div>
        <h2 style={{ margin: '0 0 12px' }}>Redeem <em style={{ color }}>voucher code</em></h2>

        <form onSubmit={submit}>
          <div style={{ marginBottom: 12 }}>
            <label className="label">Voucher code</label>
            <input
              required
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="XXXX-XXXX-XXXX"
              style={{ fontFamily: 'ui-monospace, Menlo, monospace', letterSpacing: '2px', fontSize: 18 }}
              autoFocus
            />
            <div className="muted" style={{ marginTop: 4 }}>From your printed slip or counter receipt.</div>
          </div>

          {preview && !preview.is_redeemed && (
            <div style={{ marginBottom: 12, padding: 12, background: '#0e0e11', border: `1px solid ${color}55`, borderRadius: 8 }}>
              <div className="kicker" style={{ color }}>This code gives you</div>
              <div style={{ fontWeight: 700, fontSize: 16, marginTop: 4 }}>{preview.package.name}</div>
              <div className="muted" style={{ marginTop: 2 }}>
                {preview.package.rate_down_mbps} Mbps · {preview.package.duration_days} days · worth {sym}{Number(preview.package.price).toFixed(0)}
              </div>
            </div>
          )}
          {preview && preview.is_redeemed && (
            <div className="err" style={{ marginBottom: 12 }}>This code has already been used.</div>
          )}

          <div style={{ marginBottom: 12 }}>
            <label className="label">Your name (optional)</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Rahim Uddin" />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label className="label">Your phone (optional)</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01XXXXXXXXX" />
          </div>

          {err && <div className="err">{err}</div>}
          <button type="submit" className="btn" disabled={busy || !code} style={{ marginTop: 8 }}>
            {busy ? 'Redeeming…' : 'Redeem & get credentials →'}
          </button>
        </form>

        <div style={{ marginTop: 16 }}>
          <Link to="/portal" className="btn btn-ghost">← Back to packages</Link>
        </div>
      </div>
    </Layout>
  );
}

// ===================================================================
// Page: Returning-customer login — /portal/login
// ===================================================================
function CustomerLogin() {
  const [mode, setMode] = useState('otp'); // 'otp' | 'order'
  const [phone, setPhone] = useState('');
  const [orderCode, setOrderCode] = useState('');
  const [code, setCode] = useState('');
  const [otpSent, setOtpSent] = useState(null);  // { channel, ttl_seconds }
  const [cooldown, setCooldown] = useState(0);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const info = useBranding();
  const color = info?.branding?.primary_color || '#f59e0b';

  // Count down the re-send cooldown.
  useEffect(() => {
    if (!cooldown) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const { data } = await api.post('/customer/login', {
        phone: phone.trim(),
        order_code: orderCode.trim(),
      });
      setData(data);
    } catch (ex) {
      setErr(ex?.response?.data?.error || ex.message);
    } finally { setBusy(false); }
  };

  const requestOtp = async (e) => {
    e?.preventDefault();
    setErr(''); setBusy(true);
    try {
      const { data } = await api.post('/otp/request', { phone: phone.trim() });
      setOtpSent(data);
      setCooldown(30);
    } catch (ex) {
      setErr(ex?.response?.data?.error || ex.message);
    } finally { setBusy(false); }
  };

  const verifyOtp = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const { data } = await api.post('/otp/verify', {
        phone: phone.trim(),
        code: code.trim(),
      });
      setData(data);
    } catch (ex) {
      setErr(ex?.response?.data?.error || ex.message);
    } finally { setBusy(false); }
  };

  if (data) {
    return (
      <Layout branding={info?.branding}>
        <div className="card">
          <div className="kicker">Welcome back</div>
          <h2 style={{ margin: '4px 0 0' }}>
            {data.customer?.full_name || 'Customer'}
            <span className="muted" style={{ marginLeft: 8, fontSize: 14 }}>{data.customer?.customer_code}</span>
          </h2>

          <h3 style={{ marginTop: 20 }}>Your subscriptions</h3>
          {(data.subscriptions || []).length === 0 ? (
            <div className="muted">No subscriptions yet.</div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {data.subscriptions.map((s) => {
                const active = s.status === 'active' && new Date(s.expires_at) > new Date();
                return (
                  <div key={s.id} style={{ padding: 12, background: '#0e0e11', border: `1px solid ${active ? color : '#2a2a30'}`, borderRadius: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{s.package_name}</div>
                        <div className="muted">{s.rate_down_mbps} Mbps · {s.duration_days} days</div>
                      </div>
                      <span className="tag" style={{ color: active ? color : '#78787e' }}>{active ? 'active' : s.status}</span>
                    </div>
                    <div style={{ marginTop: 10, fontSize: 13 }}>
                      <div className="muted">Username / Password</div>
                      <div style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>
                        <b>{s.login_username}</b> / <b>{s.login_password}</b>
                      </div>
                      <div className="muted" style={{ marginTop: 8 }}>Expires</div>
                      <div>{new Date(s.expires_at).toLocaleString()}</div>
                    </div>
                    {s.mac_address && (
                      <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                        {s.bind_to_mac ? '🔒 MAC-locked: ' : 'Last seen MAC: '}
                        <code>{s.mac_address}</code>
                      </div>
                    )}
                    <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {data.order?.order_code && (
                        <Link
                          to={`/portal/renew?sub=${s.id}&phone=${encodeURIComponent(phone.trim())}&code=${encodeURIComponent(data.order.order_code)}`}
                          className="btn"
                          style={{ background: color }}
                        >↻ Renew</Link>
                      )}
                      {data.order?.order_code && (
                        <a
                          className="btn btn-ghost"
                          target="_blank" rel="noopener noreferrer"
                          href={`/api/portal/orders/${encodeURIComponent(data.order.order_code)}/invoice?phone=${encodeURIComponent(phone.trim())}`}
                        >📄 Invoice</a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <button onClick={() => { setData(null); setOrderCode(''); }} className="btn btn-ghost">Log out</button>
            <Link to="/portal" className="btn btn-ghost">← Packages</Link>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout branding={info?.branding}>
      <div className="card">
        <div className="kicker">Returning customer</div>
        <h2 style={{ margin: '4px 0 12px' }}>Log in</h2>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button
            type="button"
            onClick={() => { setMode('otp'); setErr(''); }}
            className="btn btn-ghost"
            style={mode === 'otp' ? { borderColor: color, color } : {}}
          >📲 OTP (phone)</button>
          <button
            type="button"
            onClick={() => { setMode('order'); setErr(''); setOtpSent(null); }}
            className="btn btn-ghost"
            style={mode === 'order' ? { borderColor: color, color } : {}}
          >🎫 Order code</button>
        </div>

        {mode === 'otp' ? (
          !otpSent ? (
            <form onSubmit={requestOtp}>
              <p className="muted" style={{ marginTop: 0, marginBottom: 12 }}>
                We'll send a one-time code to your phone (Telegram if you registered there, otherwise SMS).
              </p>
              <div style={{ marginBottom: 12 }}>
                <label className="label">Mobile number</label>
                <input required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01XXXXXXXXX" inputMode="tel" autoFocus />
              </div>
              {err && <div className="err">{err}</div>}
              <button type="submit" className="btn" disabled={busy || !phone} style={{ marginTop: 8 }}>
                {busy ? 'Sending…' : 'Send OTP →'}
              </button>
            </form>
          ) : (
            <form onSubmit={verifyOtp}>
              <div className="muted" style={{ marginBottom: 12 }}>
                OTP sent via <b>{otpSent.channel}</b> to <code>{phone}</code>.
                Valid for {Math.round((otpSent.ttl_seconds || 300) / 60)} minutes.
              </div>
              <div style={{ marginBottom: 12 }}>
                <label className="label">Enter OTP</label>
                <input
                  required inputMode="numeric" pattern="\d{4,8}"
                  value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456" autoFocus
                  style={{ fontFamily: 'ui-monospace, Menlo, monospace', letterSpacing: '4px', fontSize: 20, textAlign: 'center' }}
                />
              </div>
              {err && <div className="err">{err}</div>}
              <button type="submit" className="btn" disabled={busy || !code} style={{ marginTop: 8 }}>
                {busy ? 'Verifying…' : 'Verify & log in'}
              </button>
              <button
                type="button"
                onClick={requestOtp}
                disabled={cooldown > 0 || busy}
                className="btn btn-ghost"
                style={{ marginLeft: 8 }}
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend OTP'}
              </button>
              <div style={{ marginTop: 8 }}>
                <button type="button" onClick={() => { setOtpSent(null); setCode(''); setErr(''); }} className="btn btn-ghost">
                  ← Use different number
                </button>
              </div>
            </form>
          )
        ) : (
          <form onSubmit={submit}>
            <p className="muted" style={{ marginTop: 0, marginBottom: 12 }}>
              Use the phone you gave when you bought your WiFi and the ORD code we showed you.
            </p>
            <div style={{ marginBottom: 12 }}>
              <label className="label">Mobile number</label>
              <input required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01XXXXXXXXX" inputMode="tel" />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label className="label">Order code</label>
              <input required value={orderCode} onChange={(e) => setOrderCode(e.target.value.toUpperCase())} placeholder="ORD-YYYYMMDD-XXXXXX" />
            </div>
            {err && <div className="err">{err}</div>}
            <button type="submit" className="btn" disabled={busy} style={{ marginTop: 8 }}>
              {busy ? '…' : 'Log in'}
            </button>
          </form>
        )}

        <div style={{ marginTop: 16 }}>
          <Link to="/portal" className="btn btn-ghost">← Back to packages</Link>
        </div>
      </div>
    </Layout>
  );
}

// ===================================================================
// Page: Renew flow — /portal/renew?sub=X&phone=...&code=ORD-...
//
// Flow:
//   1. User picks a package (defaults to their current one).
//   2. We POST /portal/renewals — server creates an ORD- for the
//      renewal linked to the existing subscription.
//   3. We hand the created order to the shared PaymentStep.
//   4. WaitStep polls until admin approves; CredsStep shows the
//      extended expiry.
// ===================================================================
function Renew() {
  const [params] = useSearchParams();
  const subId = Number(params.get('sub'));
  const phone = params.get('phone') || '';
  const code = params.get('code') || '';
  const info = useBranding();

  const [step, setStep] = useState(1);
  const [pkgCode, setPkgCode] = useState('');
  const [order, setOrder] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (!info) return <Layout><div className="muted" style={{ textAlign: 'center' }}>Loading…</div></Layout>;

  const pkgs = info.packages || [];
  const sym = info.currency_symbol || '৳';
  const color = info.branding?.primary_color || '#f59e0b';

  if (!subId || !phone || !code) {
    return (
      <Layout branding={info.branding}>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="muted">Missing renewal context. Please log in first.</div>
          <Link to="/portal/login" className="btn btn-ghost" style={{ marginTop: 12 }}>← Customer login</Link>
        </div>
      </Layout>
    );
  }

  const startRenewal = async () => {
    setErr(''); setBusy(true);
    try {
      const { data } = await api.post('/renewals', {
        subscription_id: subId,
        phone,
        order_code: code,
        package_code: pkgCode,
      });
      if (data.already_pending) {
        // Jump to the wait step for the existing renewal order.
        const { data: existing } = await api.get(`/orders/${data.order_code}`);
        setOrder({ ...existing, order_code: data.order_code });
        setStep(existing.status === 'payment_submitted' ? 3 : 2);
      } else {
        setOrder(data);
        setStep(2);
      }
    } catch (ex) {
      setErr(ex?.response?.data?.error || ex.message);
    } finally { setBusy(false); }
  };

  return (
    <Layout branding={info.branding}>
      <div className="card">
        <div className="kicker">Renew subscription</div>
        <h2 style={{ margin: '4px 0 16px' }}>
          Extend your <em style={{ color }}>WiFi plan</em>
        </h2>

        <div className="step-dots">
          <span className={step >= 1 ? 'on' : ''} />
          <span className={step >= 2 ? 'on' : ''} />
          <span className={step >= 3 ? 'on' : ''} />
          <span className={step >= 4 ? 'on' : ''} />
        </div>

        {step === 1 && (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              Pick the package you want. Your current credentials stay the same — only the expiry gets extended.
            </p>
            <div className="grid" style={{ marginTop: 8 }}>
              {pkgs.map((p) => (
                <button
                  key={p.code}
                  onClick={() => setPkgCode(p.code)}
                  className={`pkg ${pkgCode === p.code ? 'sel' : ''}`}
                  style={{ textAlign: 'left', color: 'inherit', font: 'inherit' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span className={`tag tag-${p.service_type}`}>{p.service_type}</span>
                    <span style={{ fontWeight: 700, color }}>{sym}{Number(p.price).toFixed(0)}</span>
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{p.name}</div>
                  <div className="muted">{Number(p.rate_down_mbps)} Mbps · {Number(p.duration_days)} days</div>
                </button>
              ))}
            </div>
            {err && <div className="err">{err}</div>}
            <button
              onClick={startRenewal}
              className="btn"
              disabled={busy || !pkgCode}
              style={{ marginTop: 16 }}
            >
              {busy ? 'Creating…' : 'Continue to payment →'}
            </button>
          </>
        )}

        {step === 2 && order && (
          <PaymentStep
            order={order}
            branding={info.branding}
            sym={sym}
            onSubmitted={() => setStep(3)}
          />
        )}

        {step === 3 && order && (
          <WaitStep orderCode={order.order_code} onApproved={() => setStep(4)} onDone={setOrder} />
        )}

        {step === 4 && order?.subscription && (
          <CredsStep order={order} />
        )}

        <div style={{ marginTop: 16 }}>
          <Link to={`/portal/login`} className="btn btn-ghost">← Back to my account</Link>
        </div>
      </div>
    </Layout>
  );
}

// ===================================================================
// Root component — owns its own BrowserRouter so it can be mounted
// completely outside the admin app.
// ===================================================================
// ===================================================================
// Page: Help & guide — /portal/help
// ===================================================================
function Help() {
  const info = useBranding();
  const color = info?.branding?.primary_color || '#f59e0b';
  const content = info?.content || {};
  const support = info?.support || {};

  return (
    <Layout branding={info?.branding} support={support}>
      <div style={{ marginBottom: 16 }}>
        <Link to="/portal" style={{ color, fontSize: 13 }}>← Back to packages</Link>
      </div>

      {content.intro_title && (
        <div className="card" style={{
          marginBottom: 16,
          background: `linear-gradient(135deg, ${color}11, transparent)`,
          border: `1px solid ${color}33`,
        }}>
          <div className="kicker">About us</div>
          <div style={{ fontWeight: 700, fontSize: 18, margin: '4px 0 8px' }}>
            {content.intro_title}
          </div>
          {content.intro_html && (
            <div style={{ fontSize: 13.5, color: '#cbd5e1', whiteSpace: 'pre-line' }}>
              {content.intro_html}
            </div>
          )}
        </div>
      )}

      {content.guide_html && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="kicker">User guide</div>
          <h3 style={{ margin: '6px 0 10px' }}>📘 How to get started</h3>
          <div style={{ fontSize: 13.5, color: '#cbd5e1', whiteSpace: 'pre-line' }}>
            {content.guide_html}
          </div>
        </div>
      )}

      {content.troubleshoot_html && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="kicker">Troubleshooting</div>
          <h3 style={{ margin: '6px 0 10px' }}>🔧 Connection problems?</h3>
          <div style={{ fontSize: 13.5, color: '#cbd5e1', whiteSpace: 'pre-line' }}>
            {content.troubleshoot_html}
          </div>
        </div>
      )}

      {content.rules_html && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="kicker">Rules & warnings</div>
          <h3 style={{ margin: '6px 0 10px' }}>⚠️ Fair-use policy</h3>
          <div style={{ fontSize: 13.5, color: '#cbd5e1', whiteSpace: 'pre-line' }}>
            {content.rules_html}
          </div>
        </div>
      )}

      <div className="card">
        <div className="kicker">Contact support</div>
        <h3 style={{ margin: '6px 0 10px' }}>💬 Need a real person?</h3>
        <div style={{ fontSize: 13, color: '#cbd5e1', marginBottom: 12 }}>
          {content.support_hours || 'Our team is just a tap away.'}
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          {support.whatsapp && (
            <a className="btn btn-ghost" href={`https://wa.me/${String(support.whatsapp).replace(/[^\d]/g, '')}`} target="_blank" rel="noopener noreferrer">💬 WhatsApp — {support.whatsapp}</a>
          )}
          {support.telegram && (
            <a className="btn btn-ghost" href={support.telegram.startsWith('http') ? support.telegram : `https://t.me/${support.telegram.replace(/^@/, '')}`} target="_blank" rel="noopener noreferrer">📨 Telegram — {support.telegram}</a>
          )}
          {support.messenger && (
            <a className="btn btn-ghost" href={support.messenger} target="_blank" rel="noopener noreferrer">💬 Messenger</a>
          )}
          {support.email && (
            <a className="btn btn-ghost" href={`mailto:${support.email}`}>✉️ {support.email}</a>
          )}
          {!support.whatsapp && !support.telegram && !support.messenger && !support.email && (
            <div className="muted" style={{ fontSize: 12 }}>
              Support channels haven't been configured yet. Please check back soon.
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

// ===================================================================
// Page: Free trial — /portal/trial
// ===================================================================
function TrialClaim() {
  const info = useBranding();
  const color = info?.branding?.primary_color || '#f59e0b';
  const [params] = useSearchParams();
  const mac = params.get('mac') || '';

  const [phone, setPhone] = useState('');
  const [fullName, setFullName] = useState('');
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [trial, setTrial] = useState(null);

  // Check trial eligibility as the user enters their phone.
  useEffect(() => {
    if (!phone || phone.length < 11) { setStatus(null); return; }
    let cancelled = false;
    api.get('/trial/status', { params: { phone: phone.trim() } })
      .then((r) => { if (!cancelled) setStatus(r.data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [phone]);

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const { data } = await api.post('/trial', {
        full_name: fullName.trim(),
        phone: phone.trim(),
        mac: mac || undefined,
      });
      setTrial(data.trial);
    } catch (ex) {
      setErr(ex?.response?.data?.error || ex.message);
    } finally { setBusy(false); }
  };

  if (trial) {
    return (
      <Layout branding={info?.branding}>
        <div className="card">
          <div className="kicker">🎉 You're in</div>
          <h2 style={{ margin: '4px 0 0' }}>
            Free trial · <em style={{ color }}>{trial.duration_days} days</em>
          </h2>
          <p className="muted" style={{ marginTop: 6 }}>
            {trial.package.name} · {Number(trial.package.rate_down_mbps)} Mbps · {trial.package.service_type.toUpperCase()}
          </p>
          <div style={{
            marginTop: 16, background: '#0b0f19', border: '1px solid #1f2937',
            padding: 16, borderRadius: 8, fontFamily: 'ui-monospace, Menlo, monospace',
          }}>
            <div><span className="muted">Username:</span> <b>{trial.login_username}</b></div>
            <div><span className="muted">Password:</span> <b>{trial.login_password}</b></div>
            <div><span className="muted">Expires: </span> {new Date(trial.expires_at).toLocaleString()}</div>
          </div>
          <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link to="/portal" className="btn btn-ghost">← Home</Link>
            <Link to="/portal/login" className="btn" style={{ background: color }}>My account →</Link>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout branding={info?.branding}>
      <div className="card">
        <div className="kicker">Free trial</div>
        <h2 style={{ margin: '4px 0 0' }}>7 days on us — <em style={{ color }}>one per phone</em></h2>
        <p className="muted" style={{ marginTop: 6 }}>
          Enter your details below. We'll activate a trial subscription immediately.
        </p>

        <form onSubmit={submit} style={{ marginTop: 16 }}>
          <div style={{ marginBottom: 12 }}>
            <label className="label">Full name</label>
            <input required value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your name" />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label className="label">Mobile number</label>
            <input
              required value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="01XXXXXXXXX" inputMode="tel"
            />
            {status && status.already_used && (
              <div className="err" style={{ marginTop: 6 }}>
                This number has already used the trial. Pick a plan instead.
              </div>
            )}
            {status && !status.enabled && (
              <div className="err" style={{ marginTop: 6 }}>
                The free trial isn't currently available.
              </div>
            )}
          </div>
          {err && <div className="err">{err}</div>}
          <button
            type="submit" className="btn"
            style={{ background: color }}
            disabled={busy || (status && (status.already_used || !status.enabled))}
          >
            {busy ? 'Activating…' : 'Claim my free trial'}
          </button>
        </form>
      </div>
    </Layout>
  );
}

// ===================================================================
// Page: Account signup / login / dashboard — /portal/account
// ===================================================================
function AccountShell() {
  const info = useBranding();
  const [token, setToken] = useState(() => localStorage.getItem('skynity_acc_token') || null);
  const color = info?.branding?.primary_color || '#f59e0b';

  useEffect(() => {
    if (token) localStorage.setItem('skynity_acc_token', token);
    else localStorage.removeItem('skynity_acc_token');
  }, [token]);

  if (!token) return <AccountAuth onToken={setToken} color={color} branding={info?.branding} />;
  return <AccountDashboard token={token} onLogout={() => setToken(null)} branding={info?.branding} color={color} />;
}

function AccountAuth({ onToken, color, branding }) {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setOk(''); setBusy(true);
    try {
      if (mode === 'signup') {
        await api.post('/account/signup', {
          full_name: fullName.trim(),
          phone: phone.trim(),
          email: email.trim() || undefined,
          password,
        });
        setOk('Signup received — an admin will review your account shortly. You\'ll get a message once approved.');
        setMode('login');
      } else {
        const { data } = await api.post('/account/login', {
          phone: phone.trim(),
          password,
        });
        onToken(data.token);
      }
    } catch (ex) {
      setErr(ex?.response?.data?.error || ex.message);
    } finally { setBusy(false); }
  };

  return (
    <Layout branding={branding}>
      <div className="card">
        <div className="kicker">Customer portal</div>
        <h2 style={{ margin: '4px 0 12px' }}>
          {mode === 'signup' ? 'Create your account' : 'Welcome back'}
        </h2>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button type="button" onClick={() => setMode('login')}
            className="btn btn-ghost" style={mode === 'login' ? { borderColor: color, color } : {}}>
            Log in
          </button>
          <button type="button" onClick={() => setMode('signup')}
            className="btn btn-ghost" style={mode === 'signup' ? { borderColor: color, color } : {}}>
            Sign up
          </button>
        </div>

        <form onSubmit={submit}>
          {mode === 'signup' && (
            <div style={{ marginBottom: 12 }}>
              <label className="label">Full name</label>
              <input required value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
          )}
          <div style={{ marginBottom: 12 }}>
            <label className="label">Mobile number</label>
            <input required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01XXXXXXXXX" inputMode="tel" />
          </div>
          {mode === 'signup' && (
            <div style={{ marginBottom: 12 }}>
              <label className="label">Email (optional)</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          )}
          <div style={{ marginBottom: 12 }}>
            <label className="label">Password</label>
            <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} />
          </div>
          {err && <div className="err">{err}</div>}
          {ok && <div style={{ color: '#10b981', marginBottom: 10 }}>{ok}</div>}
          <button type="submit" className="btn" style={{ background: color }} disabled={busy}>
            {busy ? '…' : mode === 'signup' ? 'Create account' : 'Log in'}
          </button>
        </form>

        <div style={{ marginTop: 16 }}>
          <Link to="/portal" className="btn btn-ghost">← Back to packages</Link>
        </div>
      </div>
    </Layout>
  );
}

function AccountDashboard({ token, onLogout, branding, color }) {
  const [data, setData]   = useState(null);
  const [err, setErr]     = useState('');
  const [info, setInfo]   = useState(null);

  const authApi = useMemo(() => {
    const inst = axiosClone();
    inst.defaults.headers.Authorization = `Bearer ${token}`;
    return inst;
  }, [token]);

  const load = async () => {
    try { setData((await authApi.get('/account/me')).data); }
    catch (ex) {
      if (ex?.response?.status === 401) onLogout();
      setErr(ex?.response?.data?.error || ex.message);
    }
  };

  // Live "you're getting X Mbps right now" view, refreshed every
  // 30 s while the page is open.
  const [share, setShare] = useState(null);
  useEffect(() => { load(); api.get('/packages').then((r) => setInfo(r.data)).catch(() => {}); }, []);  // eslint-disable-line
  useEffect(() => {
    let t = null;
    const tick = async () => {
      try { setShare((await authApi.get('/account/share')).data); } catch { /* silent */ }
    };
    tick();
    t = setInterval(tick, 30_000);
    return () => { if (t) clearInterval(t); };
  }, [authApi]);

  // Register for push notifications once the customer is logged
  // in. Ignored on older browsers / when push is disabled. The
  // user sees the native permission prompt only on first login.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    import('../services/push.js')
      .then(({ registerPush }) => { if (!cancelled) return registerPush(); })
      .catch(() => null);
    return () => { cancelled = true; };
  }, [token]);

  if (!data) return <Layout branding={branding}><div className="muted" style={{ textAlign: 'center' }}>{err || 'Loading…'}</div></Layout>;

  const acc = data.account;
  const subs = data.subscriptions || [];

  return (
    <Layout branding={branding}>
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div className="kicker">My account</div>
            <h2 style={{ margin: '2px 0 0' }}>Hi, {acc.full_name}</h2>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              {acc.phone}{acc.email ? ` · ${acc.email}` : ''}
            </div>
          </div>
          <button onClick={onLogout} className="btn btn-ghost">Log out</button>
        </div>
      </div>

      {!data.customer && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="kicker">Link your order</div>
          <h3 style={{ margin: '4px 0' }}>Connect this account to your existing service</h3>
          <p className="muted" style={{ fontSize: 12 }}>
            Enter an order code (ORD-…) you received when placing an order with the same phone number.
          </p>
          <LinkOrderForm api={authApi} onDone={load} color={color} />
        </div>
      )}

      {share?.enabled && share.hasSub && share.fair_share_mbps != null && (
        <ShareBanner share={share} color={color} />
      )}

      {subs.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="kicker">Subscriptions</div>
          <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
            {subs.map((s) => (
              <SubscriptionBlock key={s.id} sub={s} color={color} packages={info?.packages || []} api={authApi} onDone={load} />
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Link to="/portal" className="btn btn-ghost">← Browse packages</Link>
      </div>
    </Layout>
  );
}

// ============================================================
// "Right now you're getting X Mbps" — shown on the customer
// dashboard when the admin has configured uplink capacity.
// Explains bandwidth sharing in the customer's language.
// ============================================================
function ShareBanner({ share, color }) {
  const pkg   = Number(share.package_rate_mbps) || 0;
  const fair  = Number(share.fair_share_mbps)   || 0;
  const bonus = Number(share.bonus_mbps)        || 0;
  const hasBonus = bonus > 0.5;

  return (
    <div
      className="card"
      style={{
        marginTop: 12,
        background: hasBonus
          ? 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(96,165,250,0.08))'
          : undefined,
        borderColor: hasBonus ? 'rgba(16,185,129,0.4)' : undefined,
      }}
    >
      <div className="kicker">
        {hasBonus ? '⚡ Speed bonus right now' : 'Live speed'}
      </div>
      <h3 style={{ margin: '4px 0' }}>
        {hasBonus
          ? <>You're getting about <span style={{ color }}>{fair.toFixed(1)} Mbps</span> — {bonus.toFixed(1)} Mbps bonus!</>
          : <>Your plan: <span style={{ color }}>{pkg} Mbps</span></>
        }
      </h3>
      <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
        {hasBonus
          ? `Only ${share.users_online} neighbor${share.users_online === 1 ? '' : 's'} online right now, so the network gives you their idle share on top of your ${pkg} Mbps plan.`
          : `${share.users_online} user${share.users_online === 1 ? '' : 's'} online. When the network is busy you always get at least your plan speed of ${pkg} Mbps.`}
      </p>
      <div
        className="muted"
        style={{ fontSize: 11, marginTop: 6, fontFamily: 'monospace' }}
      >
        uplink: {share.capacity_mbps} Mbps · fair share: {fair.toFixed(1)} Mbps · plan floor: {pkg} Mbps
      </div>
    </div>
  );
}

function LinkOrderForm({ api: authApi, onDone, color }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      await authApi.post('/account/link', { order_code: code.trim().toUpperCase() });
      onDone();
    } catch (ex) {
      setErr(ex?.response?.data?.error || ex.message);
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ORD-YYYYMMDD-XXXXXX" required />
        <button className="btn" style={{ background: color }} disabled={busy || !code}>{busy ? '…' : 'Link'}</button>
      </div>
      {err && <div className="err" style={{ marginTop: 6 }}>{err}</div>}
    </form>
  );
}

function SubscriptionBlock({ sub, color, packages, api: authApi, onDone }) {
  const [changing, setChanging] = useState(false);
  const [target, setTarget] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showUsage, setShowUsage] = useState(false);

  const expires = new Date(sub.expires_at);
  const daysLeft = Math.ceil((expires - new Date()) / 86400000);
  const expired = daysLeft <= 0;

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const { data } = await authApi.post('/account/change-package', {
        subscription_id: sub.id,
        new_package_code: target,
      });
      setOk(data);
      setChanging(false);
    } catch (ex) {
      setErr(ex?.response?.data?.error || ex.message);
    } finally { setBusy(false); }
  };

  return (
    <div style={{ border: '1px solid #1f2937', borderRadius: 8, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className={`tag tag-${sub.service_type}`}>{sub.service_type}</span>
        <div style={{ fontWeight: 600 }}>{sub.package_name}</div>
        <div style={{ marginLeft: 'auto', fontSize: 12 }} className="muted">
          {expired ? <span style={{ color: '#ef4444' }}>expired</span>
                   : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`}
        </div>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 6, fontFamily: 'ui-monospace, Menlo, monospace' }}>
        <div>user: <b>{sub.login_username}</b> · pass: <b>{sub.login_password}</b></div>
        <div>expires: {expires.toLocaleString()}</div>
        {sub.mac_address && (
          <div>{sub.bind_to_mac ? '🔒 MAC-locked: ' : 'Last MAC: '}<code>{sub.mac_address}</code></div>
        )}
      </div>
      {!changing && !ok && (
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setChanging(true)} className="btn btn-ghost">🔁 Change package</button>
          <button onClick={() => setShowUsage((v) => !v)} className="btn btn-ghost">
            📊 {showUsage ? 'Hide usage' : 'Show usage'}
          </button>
        </div>
      )}
      {showUsage && (
        <div style={{ marginTop: 10 }}>
          <PortalBandwidthChart api={authApi} subscriptionId={sub.id} color={color} />
        </div>
      )}
      {changing && (
        <form onSubmit={submit} style={{ marginTop: 10 }}>
          <label className="label">New package</label>
          <select required value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Select…</option>
            {packages.filter((p) => p.code !== sub.package_code).map((p) => (
              <option key={p.code} value={p.code}>
                {p.name} · {Number(p.rate_down_mbps)}M · {p.duration_days}d
              </option>
            ))}
          </select>
          {err && <div className="err" style={{ marginTop: 6 }}>{err}</div>}
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button type="submit" className="btn" style={{ background: color }} disabled={busy || !target}>
              {busy ? '…' : 'Request change'}
            </button>
            <button type="button" onClick={() => setChanging(false)} className="btn btn-ghost">Cancel</button>
          </div>
        </form>
      )}
      {ok && (
        <div style={{
          marginTop: 10, padding: 10, borderRadius: 6,
          background: '#0b3d2e', color: '#d1fae5', fontSize: 12,
        }}>
          ✅ Change request created. Order code: <b>{ok.order_code}</b> — {ok.amount}.
          Pay it from <Link to={`/portal/status/${ok.order_code}`} style={{ color: '#86efac' }}>here</Link>.
        </div>
      )}
    </div>
  );
}

// Separate axios instance for authenticated calls — avoids cross-pollution
// with the main anonymous `api` used by everything else on this page.
function axiosClone() {
  return axios.create({ baseURL: '/api/portal', timeout: 20000 });
}

function fmtBytes(n) {
  n = Number(n) || 0;
  if (n < 1024)       return `${n} B`;
  if (n < 1024 ** 2)  return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3)  return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n < 1024 ** 4)  return `${(n / 1024 ** 3).toFixed(2)} GB`;
  return                      `${(n / 1024 ** 4).toFixed(2)} TB`;
}

// ===================================================================
// Per-subscription bandwidth chart for the customer dashboard.
// Fetches daily totals via the authenticated portal API and draws
// a small stacked-bar chart in inline SVG (no extra deps).
// ===================================================================
function PortalBandwidthChart({ api: authApi, subscriptionId, color }) {
  const [days, setDays] = useState(14);
  const [rows, setRows] = useState(null);
  const [err,  setErr]  = useState('');

  useEffect(() => {
    let cancelled = false;
    setErr(''); setRows(null);
    authApi.get(`/account/subscriptions/${subscriptionId}/bandwidth`, { params: { days } })
      .then((r) => { if (!cancelled) setRows(r.data.days); })
      .catch((e) => { if (!cancelled) setErr(e?.response?.data?.error || e.message); });
    return () => { cancelled = true; };
  }, [authApi, subscriptionId, days]);

  const totals = useMemo(() => {
    if (!rows) return { inB: 0, outB: 0, max: 0 };
    let inB = 0, outB = 0, max = 0;
    for (const r of rows) {
      inB  += Number(r.bytes_in)  || 0;
      outB += Number(r.bytes_out) || 0;
      const t = (Number(r.bytes_in) || 0) + (Number(r.bytes_out) || 0);
      if (t > max) max = t;
    }
    return { inB, outB, max };
  }, [rows]);

  return (
    <div style={{
      background: '#0e0e11', border: '1px solid #2a2a30',
      borderRadius: 8, padding: 12,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.15em' }}>
          Daily usage · last {days}d
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              style={{
                fontSize: 10, padding: '2px 6px', border: 0, cursor: 'pointer',
                background: days === d ? color : 'transparent',
                color:      days === d ? '#0b0b0d' : '#cbd5e1',
                borderRadius: 3,
              }}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {err ? (
        <div style={{ color: '#ff6b6b', fontSize: 12, padding: '12px 0' }}>{err}</div>
      ) : !rows ? (
        <div style={{ height: 60, background: '#16161a', borderRadius: 4 }} />
      ) : totals.max === 0 ? (
        <div className="muted" style={{ fontSize: 12, textAlign: 'center', padding: '16px 0', fontStyle: 'italic' }}>
          No traffic recorded yet.
        </div>
      ) : (
        <>
          <div style={{ height: 70, display: 'flex', gap: 2, alignItems: 'flex-end' }}>
            {rows.map((r) => {
              const total = (Number(r.bytes_in) + Number(r.bytes_out)) || 0;
              const inH  = totals.max ? (Number(r.bytes_in)  / totals.max) * 100 : 0;
              const outH = totals.max ? (Number(r.bytes_out) / totals.max) * 100 : 0;
              return (
                <div
                  key={r.day}
                  title={`${r.day}\n↓ ${fmtBytes(r.bytes_in)}\n↑ ${fmtBytes(r.bytes_out)}\ntotal ${fmtBytes(total)}`}
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 1, minWidth: 4 }}
                >
                  <div style={{ height: `${outH}%`, background: '#06b6d4', borderRadius: '2px 2px 0 0' }} />
                  <div style={{ height: `${inH}%`,  background: color }} />
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, background: color, borderRadius: 2 }} />
              <span className="muted">Download</span>
              <span style={{ marginLeft: 'auto', fontFamily: 'ui-monospace, Menlo, monospace' }}>
                {fmtBytes(totals.inB)}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, background: '#06b6d4', borderRadius: 2 }} />
              <span className="muted">Upload</span>
              <span style={{ marginLeft: 'auto', fontFamily: 'ui-monospace, Menlo, monospace' }}>
                {fmtBytes(totals.outB)}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function PublicPortal() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/order" element={<OrderFlow />} />
      <Route path="/redeem" element={<Redeem />} />
      <Route path="/renew" element={<Renew />} />
      <Route path="/trial" element={<TrialClaim />} />
      <Route path="/help" element={<Help />} />
      <Route path="/login" element={<CustomerLogin />} />
      <Route path="/account" element={<AccountShell />} />
      <Route path="/status" element={<StatusLookup />} />
      <Route path="/status/:code" element={<StatusLookup />} />
      <Route path="*" element={<Navigate to="/portal" replace />} />
    </Routes>
  );
}
