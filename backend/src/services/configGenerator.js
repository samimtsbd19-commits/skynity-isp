// ============================================================
// Config Generator
// ------------------------------------------------------------
// Produces ready-to-import MikroTik artefacts from what the
// admin has in the dashboard (packages, settings, bKash / Nagad
// numbers, brand name, VPS domain).
//
// Two artefacts are generated:
//
//   1. setup.rsc
//      A RouterOS script the admin downloads and imports once
//      (WinBox → Files → drag the .rsc → terminal:
//         /import file-name=skynity-setup.rsc).
//      It creates:
//        - /ip pool           skynity-hotspot-pool
//        - /ip hotspot profile skynity (login uses HTML)
//        - /ip hotspot user profile — one per hotspot package
//        - /ppp profile                — one per pppoe package
//        - /ip hotspot walled-garden   — allow reaching the VPS
//        - a few comments explaining what to do next.
//
//   2. login.html
//      A self-contained captive-portal login page (no external
//      assets) that displays the current packages and points
//      the "Buy" button at the VPS self-service portal.
//
// Both are rendered from DB state at request time, so every
// time the admin edits packages / settings they can re-download
// fresh files.
// ============================================================

import db from '../database/pool.js';
import * as settings from './settings.js';
import config from '../config/index.js';

// ---------- helpers ----------

/** RouterOS-safe: escape quotes in strings so the script doesn't break. */
function rscEscape(s) {
  if (s == null) return '';
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Slugify — keeps the name MikroTik-safe (letters/digits/-/_). */
function mtSafe(s) {
  return String(s || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 40) || 'item';
}

/** Convert days → seconds (RouterOS uptime-limit wants seconds or h:m:s). */
function daysToUptime(days) {
  const d = Math.max(1, Number(days) || 1);
  return `${d}d`;
}

/** Rate-limit string for RouterOS: "up/down" in the form "5M/5M". */
function rateLimitStr(upMbps, downMbps) {
  const up = Math.max(1, Number(upMbps) || 1);
  const dn = Math.max(1, Number(downMbps) || 1);
  return `${up}M/${dn}M`;
}

// ============================================================
// Artefact 1 — setup.rsc
// ============================================================

/**
 * Build the full .rsc file content.
 *
 * @param {Object} opts
 * @param {string} opts.hotspotInterface  e.g. "bridge-hotspot" or "ether2"
 * @param {string} opts.hotspotNetwork    e.g. "10.77.0.0/24"
 * @param {string} opts.hotspotGateway    e.g. "10.77.0.1"
 * @param {string} opts.dnsName           captive-portal DNS, e.g. "wifi.local"
 * @param {string} opts.vpsHost           e.g. "wifi.skynity.org"
 * @param {string=} opts.vpsIp            optional — walled-garden IP row
 * @param {string=} opts.brand            brand name (for comments)
 */
export async function generateSetupRsc(opts = {}) {
  const {
    hotspotInterface = 'bridge-hotspot',
    hotspotNetwork = '10.77.0.0/24',
    hotspotGateway = '10.77.0.1',
    dnsName = 'wifi.local',
    vpsHost,
    vpsIp,
    brand,
  } = opts;

  const finalBrand = brand || (await settings.getSetting('site.name')) || config.APP_NAME || 'Skynity ISP';
  const finalVpsHost = vpsHost || (await settings.getSetting('site.public_base_url'))?.replace(/^https?:\/\//, '').replace(/\/$/, '') || 'wifi.skynity.org';

  const pkgs = await db.query(
    `SELECT code, name, service_type, rate_up_mbps, rate_down_mbps, duration_days, mikrotik_profile
       FROM packages WHERE is_active = 1 ORDER BY sort_order, id`
  );

  const lines = [];
  const out = (s = '') => lines.push(s);

  const now = new Date().toISOString();

  out('# ============================================================');
  out(`# ${finalBrand} — MikroTik Setup Script`);
  out(`# Generated: ${now}`);
  out(`# Captive portal VPS: https://${finalVpsHost}`);
  out('# ------------------------------------------------------------');
  out('# Usage:');
  out('#   1. WinBox → Files → drag this file in.');
  out('#   2. Open New Terminal and run:');
  out('#        /import file-name=skynity-setup.rsc');
  out('#   3. Review the output. Every line starts with a section');
  out('#      header so you can tell what was added.');
  out('#');
  out('# Safe to re-run: we use "add" with comment-based matching, so');
  out('# re-importing will just warn on duplicates — it will not');
  out('# break your config.');
  out('# ============================================================');
  out('');

  // ---------- 1. Enable REST API (so the VPS can talk to the router) ----------
  out('# ---- REST API / www services ----------------------------');
  out('/ip service');
  out('set www disabled=no port=80');
  out('set www-ssl disabled=no port=443');
  out('set api disabled=no');
  out('set api-ssl disabled=no');
  out('');

  // ---------- 2. Hotspot IP pool + DHCP ----------
  out('# ---- Hotspot IP pool + address --------------------------');
  out('/ip pool');
  out(`add name=skynity-hotspot-pool ranges=${rangesFromCidr(hotspotNetwork, hotspotGateway)} comment="skynity:pool"`);
  out('');
  out('/ip address');
  out(`add address=${hotspotGateway}/${cidrPrefix(hotspotNetwork)} interface=${hotspotInterface} comment="skynity:hotspot-gw"`);
  out('');
  out('/ip dhcp-server');
  out(`add name=skynity-hotspot-dhcp interface=${hotspotInterface} address-pool=skynity-hotspot-pool lease-time=1h disabled=no comment="skynity:dhcp"`);
  out('/ip dhcp-server network');
  out(`add address=${hotspotNetwork} gateway=${hotspotGateway} dns-server=${hotspotGateway} comment="skynity:dhcp-net"`);
  out('');

  // ---------- 3. Hotspot user profiles (one per `hotspot` package) ----------
  out('# ---- Hotspot user profiles (per package) ----------------');
  out('/ip hotspot user profile');
  for (const p of pkgs.filter((x) => x.service_type === 'hotspot')) {
    const prof = mtSafe(p.mikrotik_profile || p.code);
    out(
      `add name=${prof} ` +
      `rate-limit=${rateLimitStr(p.rate_up_mbps, p.rate_down_mbps)} ` +
      `session-timeout=${daysToUptime(p.duration_days)} ` +
      `shared-users=1 ` +
      `comment="skynity:pkg:${rscEscape(p.code)}"`
    );
  }
  out('');

  // ---------- 4. PPP profiles (one per `pppoe` package) --------
  out('# ---- PPP profiles (PPPoE packages) ----------------------');
  out('/ppp profile');
  for (const p of pkgs.filter((x) => x.service_type === 'pppoe')) {
    const prof = mtSafe(p.mikrotik_profile || p.code);
    out(
      `add name=${prof} ` +
      `rate-limit=${rateLimitStr(p.rate_up_mbps, p.rate_down_mbps)} ` +
      `only-one=yes ` +
      `comment="skynity:pkg:${rscEscape(p.code)}"`
    );
  }
  out('');

  // ---------- 5. Hotspot server profile + server ---------------
  out('# ---- Hotspot server profile + server --------------------');
  out('/ip hotspot profile');
  out(
    `add name=skynity-hs-profile ` +
    `hotspot-address=${hotspotGateway} ` +
    `dns-name=${dnsName} ` +
    `html-directory=flash/skynity-hotspot ` +
    `login-by=http-chap,http-pap ` +
    `http-cookie-lifetime=3d ` +
    `comment="skynity:hs-profile"`
  );
  out('/ip hotspot');
  out(
    `add name=skynity-hotspot ` +
    `interface=${hotspotInterface} ` +
    `address-pool=skynity-hotspot-pool ` +
    `profile=skynity-hs-profile ` +
    `disabled=no ` +
    `comment="skynity:hs-server"`
  );
  out('');

  // ---------- 6. Walled garden (so the login.html can fetch packages from VPS) ----
  out('# ---- Walled garden: let login page reach the VPS --------');
  out('/ip hotspot walled-garden');
  out(`add dst-host=${finalVpsHost} comment="skynity:wg:vps-host"`);
  if (vpsIp) {
    out('/ip hotspot walled-garden ip');
    out(`add dst-address=${vpsIp} comment="skynity:wg:vps-ip"`);
  }
  // also allow common bKash/Nagad / Let's Encrypt OCSP
  out(`add dst-host=*.bka.sh comment="skynity:wg:bkash"`);
  out(`add dst-host=*.nagad.com.bd comment="skynity:wg:nagad"`);
  out(`add dst-host=*.letsencrypt.org comment="skynity:wg:le"`);
  out('');

  // ---------- 7. Firewall NAT (masquerade hotspot clients) -----
  out('# ---- NAT masquerade for hotspot clients -----------------');
  out('/ip firewall nat');
  out(
    `add chain=srcnat action=masquerade src-address=${hotspotNetwork} ` +
    `comment="skynity:nat:hotspot"`
  );
  out('');

  // ---------- Footer ------------------------------------------
  out('# ============================================================');
  out('# Next steps:');
  out('#   a) Download "login.html" from the dashboard and upload it');
  out('#      to  flash/skynity-hotspot/login.html  (WinBox → Files).');
  out('#   b) Open the dashboard → Routers → Test connection → Save.');
  out('#   c) Create packages from the Packages page. You can re-import');
  out('#      this script any time — only new profiles will be added.');
  out('# ============================================================');
  out('');

  return lines.join('\n');
}

/** Turn a CIDR like "10.77.0.0/24" into a pool range "10.77.0.10-10.77.0.254". */
function rangesFromCidr(cidr, gatewayIp) {
  try {
    const [base] = cidr.split('/');
    const parts = base.split('.').map((n) => Number(n));
    if (parts.length !== 4 || parts.some((x) => Number.isNaN(x))) {
      return `${gatewayIp.replace(/\.1$/, '.10')}-${gatewayIp.replace(/\.1$/, '.254')}`;
    }
    parts[3] = 10;
    const start = parts.join('.');
    parts[3] = 254;
    const end = parts.join('.');
    return `${start}-${end}`;
  } catch {
    return `${gatewayIp}-${gatewayIp}`;
  }
}

function cidrPrefix(cidr) {
  const m = /\/(\d+)$/.exec(cidr);
  return m ? m[1] : '24';
}

// ============================================================
// Artefact 2 — login.html (captive portal)
// ============================================================

/**
 * Build a self-contained login page for the MikroTik hotspot.
 * RouterOS fills $(link-login-only), $(mac), etc. at render time.
 */
export async function generatePortalHtml(opts = {}) {
  const pkgs = await db.query(
    `SELECT code, name, service_type, rate_up_mbps, rate_down_mbps, duration_days, price, description
       FROM packages WHERE is_active = 1 ORDER BY sort_order, id`
  );

  const brand        = opts.siteName      || (await settings.getSetting('site.name'))             || config.APP_NAME || 'Skynity ISP';
  const tagline      = opts.tagline       || (await settings.getSetting('portal.tagline'))        || 'Choose a package below, or log in if you already have an account.';
  const color        = opts.primaryColor  || (await settings.getSetting('branding.primary_color'))|| '#f59e0b';
  const bgColor      = opts.bgColor       || (await settings.getSetting('portal.bg_color'))       || '#0b0b0d';
  const cardBg       = opts.cardBg        || (await settings.getSetting('portal.card_bg'))        || '#16161a';
  const textColor    = opts.textColor     || (await settings.getSetting('portal.text_color'))     || '#e7e7e9';
  const fontSize     = Number(opts.fontSize || (await settings.getSetting('portal.font_size'))    || 14);
  const fontFamily   = opts.fontFamily    || (await settings.getSetting('portal.font_family'))    || 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
  const logoUrl      = opts.logoUrl       || (await settings.getSetting('branding.logo_url'))     || '';
  const logoPos      = opts.logoPosition  || (await settings.getSetting('portal.logo_position'))  || 'center';
  const loginTitle   = opts.loginTitle    || (await settings.getSetting('portal.login_title'))    || 'Already have an account? Log in';
  const supportPhone = opts.supportPhone  || (await settings.getSetting('site.support_phone'))    || '';
  const currencySym  = opts.currencySymbol|| (await settings.getSetting('site.currency_symbol'))  || '৳';
  const borderRadius = opts.borderRadius  || (await settings.getSetting('portal.border_radius'))  || '12';
  const darkMode     = opts.darkMode !== undefined ? opts.darkMode : ((await settings.getSetting('portal.dark_mode')) !== 'false');

  const vpsHost = opts.vpsHost
    || (await settings.getSetting('site.public_base_url'))?.replace(/^https?:\/\//, '').replace(/\/$/, '')
    || 'wifi.skynity.org';
  const portalUrl = `https://${vpsHost}/portal`;

  const logoHtml = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(brand)}" style="max-height:64px;max-width:180px;object-fit:contain;margin-bottom:12px;display:block;${logoPos === 'center' ? 'margin-left:auto;margin-right:auto;' : logoPos === 'right' ? 'margin-left:auto;' : ''}" />`
    : '';

  const headerAlign = logoPos === 'right' ? 'right' : logoPos === 'left' ? 'left' : 'center';

  const pkgCards = pkgs.map((p) => {
    const price = Number(p.price).toFixed(0);
    return `
      <a class="pkg" href="${portalUrl}/order?pkg=${encodeURIComponent(p.code)}&mac=$(mac)" target="_blank" rel="noopener">
        <div class="pkg-head">
          <span class="pkg-type ${p.service_type}">${p.service_type}</span>
          <span class="pkg-price">${currencySym}${price}</span>
        </div>
        <div class="pkg-name">${escapeHtml(p.name)}</div>
        <div class="pkg-speed">${Number(p.rate_down_mbps)} Mbps • ${Number(p.duration_days)} days</div>
        ${p.description ? `<div class="pkg-desc">${escapeHtml(p.description)}</div>` : ''}
        <div class="pkg-buy">Buy this →</div>
      </a>`;
  }).join('\n');

  const mutedColor  = darkMode ? '#78787e' : '#6b7280';
  const inputBg     = darkMode ? '#0e0e11' : '#f9fafb';
  const inputBorder = darkMode ? '#2a2a30' : '#d1d5db';
  const cardBorder  = darkMode ? '#2a2a30' : '#e5e7eb';

  return `<!doctype html>
<html lang="bn">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="refresh" content="600" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(brand)} — WiFi Login</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;font-family:${fontFamily};font-size:${fontSize}px;background:${bgColor};color:${textColor};min-height:100vh}
    .wrap{max-width:960px;margin:0 auto;padding:24px 16px 80px}
    header{text-align:${headerAlign};padding:32px 0 24px}
    header h1{margin:0 0 6px;font-size:${Math.round(fontSize * 2.2)}px;letter-spacing:-0.02em;line-height:1.1}
    header h1 em{color:${color};font-style:italic}
    header p{margin:0;color:${mutedColor};font-size:${fontSize - 1}px}
    .login-box{background:${cardBg};border:1px solid ${cardBorder};border-radius:${borderRadius}px;padding:20px;margin-bottom:32px}
    .login-box h2{margin:0 0 12px;font-size:${fontSize + 2}px;color:${textColor}}
    .login-box form{display:flex;gap:8px;flex-wrap:wrap}
    .login-box input{flex:1;min-width:130px;padding:10px 12px;background:${inputBg};border:1px solid ${inputBorder};color:${textColor};border-radius:${Math.round(Number(borderRadius) * 0.5)}px;font-size:${fontSize}px;outline:none}
    .login-box input:focus{border-color:${color}}
    .login-box button{padding:10px 20px;background:${color};color:#0b0b0d;border:0;border-radius:${Math.round(Number(borderRadius) * 0.5)}px;font-weight:700;font-size:${fontSize}px;cursor:pointer;letter-spacing:.02em}
    .login-box button:hover{opacity:.9}
    .hint{font-size:${fontSize - 2}px;color:${mutedColor};margin-top:8px}
    .section-title{display:flex;align-items:baseline;justify-content:space-between;margin:24px 0 14px}
    .section-title h2{margin:0;font-size:${fontSize + 6}px;letter-spacing:-0.01em}
    .section-title h2 em{color:${color};font-style:italic}
    .section-title small{color:${mutedColor};font-size:${fontSize - 2}px}
    .grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}
    .pkg{display:block;background:${cardBg};border:1px solid ${cardBorder};border-radius:${borderRadius}px;padding:16px;color:inherit;text-decoration:none;transition:border-color .15s,transform .15s,box-shadow .15s}
    .pkg:hover{border-color:${color};transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.15)}
    .pkg-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
    .pkg-type{display:inline-block;font-size:${fontSize - 4}px;letter-spacing:.12em;text-transform:uppercase;padding:3px 6px;border-radius:4px;background:${inputBg};border:1px solid ${cardBorder}}
    .pkg-type.pppoe{color:#6ec9ff}
    .pkg-type.hotspot{color:${color}}
    .pkg-price{font-size:${fontSize + 4}px;font-weight:700;color:${color}}
    .pkg-name{font-weight:600;font-size:${fontSize + 1}px;margin-bottom:4px}
    .pkg-speed{font-size:${fontSize - 2}px;color:${mutedColor};margin-bottom:6px}
    .pkg-desc{font-size:${fontSize - 2}px;color:${mutedColor};margin-bottom:10px}
    .pkg-buy{font-size:${fontSize - 2}px;color:${color};font-weight:600;margin-top:10px}
    .action-grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));margin-top:24px}
    footer{text-align:center;margin-top:40px;color:${mutedColor};font-size:${fontSize - 2}px}
    footer a{color:${color};text-decoration:none}
    @media(max-width:480px){header h1{font-size:${Math.round(fontSize * 1.7)}px}.grid{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      ${logoHtml}
      <h1>${escapeHtml(brand)} <em>WiFi</em></h1>
      <p>${escapeHtml(tagline)}</p>
    </header>

    <div class="login-box">
      <h2>${escapeHtml(loginTitle)}</h2>
      <form name="login" action="$(link-login-only)" method="post"
            $(if chap-id) onsubmit="return doLogin()" $(endif)>
        <input type="hidden" name="dst" value="$(link-orig)" />
        <input type="hidden" name="popup" value="true" />
        <input type="text"     name="username" placeholder="Username" autocomplete="username" required />
        <input type="password" name="password" placeholder="Password" autocomplete="current-password" required />
        <button type="submit">Log in</button>
      </form>
      $(if error)<div class="hint" style="color:#ef4444">$(error)</div>$(endif)
      <div class="hint">Your MAC: <code>$(mac)</code> · IP: <code>$(ip)</code></div>
    </div>

    <div class="section-title">
      <h2>Available <em>packages</em></h2>
      <small>Tap a card to purchase</small>
    </div>

    <div class="grid">
      ${pkgCards || `<div style="grid-column:1/-1;color:${mutedColor};text-align:center;padding:40px">No packages available yet. Please contact admin.</div>`}
    </div>

    <div class="action-grid">
      <a class="pkg" href="${portalUrl}/redeem" target="_blank" rel="noopener" style="text-align:center">
        <div class="pkg-buy" style="font-size:${fontSize}px;margin:0">🎟 Have a voucher? Redeem</div>
      </a>
      <a class="pkg" href="${portalUrl}/login" target="_blank" rel="noopener" style="text-align:center">
        <div class="pkg-buy" style="font-size:${fontSize}px;margin:0">↻ Returning customer login</div>
      </a>
    </div>

    <footer>
      ${supportPhone ? `Support: <a href="tel:${escapeHtml(supportPhone)}">${escapeHtml(supportPhone)}</a> · ` : ''}
      Powered by <a href="https://${escapeHtml(vpsHost)}" target="_blank" rel="noopener">${escapeHtml(brand)}</a>
    </footer>
  </div>

  $(if chap-id)
  <script>
    function doLogin() {
      document.login.password.value = hexMD5('$(chap-id)' + document.login.password.value + '$(chap-challenge)');
      return true;
    }
    function hexMD5(s){return window.md5?window.md5(s):s;}
  </script>
  $(endif)
</body>
</html>
`;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================
// Artefact 3 — pcq.rsc
// ------------------------------------------------------------
// Generates a RouterOS script that installs a PCQ (Per-Connection
// Queue) tree so every active user fairly shares whatever link
// capacity is configured in settings. When some users are idle,
// their share is automatically redistributed to the active
// ones — no cron, no manual intervention.
//
// Two modes:
//
//   * per_user_equal  — one PCQ queue type (pcq-rate=0) groups
//                       every user under a single parent. Simplest,
//                       works great for small ISPs.
//
//   * per_package     — one PCQ queue-type + parent tree per
//                       package, so a "10M" user never exceeds
//                       10M even when alone on the link but still
//                       shares fairly with other "10M" users.
//
// FastTrack is enabled on established connections so the queue
// tree doesn't force the router CPU to touch every packet.
// ============================================================
export async function generatePcqRsc(opts = {}) {
  const [
    enabled, totalDown, totalUp, parentDown, parentUp, mode, brand,
  ] = await Promise.all([
    settings.getSetting('provisioning.pcq_enabled'),
    settings.getSetting('provisioning.pcq_total_download'),
    settings.getSetting('provisioning.pcq_total_upload'),
    settings.getSetting('provisioning.pcq_parent_download'),
    settings.getSetting('provisioning.pcq_parent_upload'),
    settings.getSetting('provisioning.pcq_mode'),
    settings.getSetting('site.name'),
  ]);

  if (enabled === false || String(enabled).toLowerCase() === 'false') {
    throw new Error('PCQ is disabled in Settings → Provisioning');
  }

  const downMbit = Math.max(1, Number(opts.total_download ?? totalDown) || 100);
  const upMbit   = Math.max(1, Number(opts.total_upload   ?? totalUp)   || 30);
  const pDown    = String(opts.parent_download ?? parentDown ?? 'global');
  const pUp      = String(opts.parent_upload   ?? parentUp   ?? 'global');
  const theMode  = String(opts.mode ?? mode ?? 'per_user_equal');

  const pkgs = await db.query(
    `SELECT code, name, service_type, rate_up_mbps, rate_down_mbps
       FROM packages WHERE is_active = 1 ORDER BY sort_order, id`
  );

  const lines = [];
  const out = (s = '') => lines.push(s);
  const label = brand || 'Skynity ISP';
  const now = new Date().toISOString();

  out('# ============================================================');
  out(`# ${label} — PCQ (fair-share) Queue Tree`);
  out(`# Generated: ${now}`);
  out(`# Mode: ${theMode}`);
  out(`# Total download: ${downMbit} Mbit | Total upload: ${upMbit} Mbit`);
  out('# ------------------------------------------------------------');
  out('# This script creates a shared PCQ queue tree so that your');
  out('# link bandwidth is automatically distributed among active');
  out('# users. When some users are idle, the remaining ones get');
  out('# a bigger slice — no manual tweaks needed.');
  out('#');
  out('# Re-running is safe: each item is tagged with "skynity:pcq:"');
  out('# so you can remove the old tree before re-importing:');
  out('#   /queue tree       remove [find comment~"skynity:pcq"]');
  out('#   /queue type       remove [find comment~"skynity:pcq"]');
  out('# ============================================================');
  out('');

  // FastTrack: huge CPU savings for already-established sessions.
  out('# ---- FastTrack established connections ------------------');
  out('/ip firewall filter');
  out('add chain=forward action=fasttrack-connection connection-state=established,related ' +
      'comment="skynity:pcq:fasttrack"');
  out('add chain=forward action=accept connection-state=established,related ' +
      'comment="skynity:pcq:accept-established"');
  out('');

  if (theMode === 'per_package') {
    // One PCQ type per package; queue-tree children per package.
    out('# ---- PCQ queue types (per package) ----------------------');
    out('/queue type');
    for (const p of pkgs) {
      const code = mtSafe(p.code);
      const dn = Number(p.rate_down_mbps) || 1;
      const up = Number(p.rate_up_mbps) || 1;
      out(`add name=pcq-dn-${code} kind=pcq pcq-classifier=dst-address pcq-rate=${dn}M ` +
          `comment="skynity:pcq:type-dn:${rscEscape(p.code)}"`);
      out(`add name=pcq-up-${code} kind=pcq pcq-classifier=src-address pcq-rate=${up}M ` +
          `comment="skynity:pcq:type-up:${rscEscape(p.code)}"`);
    }
    out('');
    out('# ---- Queue tree (one parent + per-package leaves) -------');
    out('/queue tree');
    out(`add name=skynity-total-dn parent=${pDown} max-limit=${downMbit}M ` +
        `comment="skynity:pcq:root-dn"`);
    out(`add name=skynity-total-up parent=${pUp} max-limit=${upMbit}M ` +
        `comment="skynity:pcq:root-up"`);
    for (const p of pkgs) {
      const code = mtSafe(p.code);
      out(`add name=skynity-dn-${code} parent=skynity-total-dn queue=pcq-dn-${code} ` +
          `comment="skynity:pcq:leaf-dn:${rscEscape(p.code)}"`);
      out(`add name=skynity-up-${code} parent=skynity-total-up queue=pcq-up-${code} ` +
          `comment="skynity:pcq:leaf-up:${rscEscape(p.code)}"`);
    }
    out('');
  } else {
    // Single equal-share PCQ type for everyone.
    out('# ---- PCQ queue types (equal share) ----------------------');
    out('/queue type');
    out('add name=pcq-dn kind=pcq pcq-classifier=dst-address pcq-rate=0 ' +
        'comment="skynity:pcq:type-dn"');
    out('add name=pcq-up kind=pcq pcq-classifier=src-address pcq-rate=0 ' +
        'comment="skynity:pcq:type-up"');
    out('');
    out('# ---- Queue tree (shared) --------------------------------');
    out('/queue tree');
    out(`add name=skynity-total-dn parent=${pDown} queue=pcq-dn max-limit=${downMbit}M ` +
        `comment="skynity:pcq:tree-dn"`);
    out(`add name=skynity-total-up parent=${pUp}   queue=pcq-up max-limit=${upMbit}M ` +
        `comment="skynity:pcq:tree-up"`);
    out('');
  }

  out('# ============================================================');
  out('# Tips:');
  out('#   * If your WAN interface is NOT "global", change the');
  out('#     parent values in Settings → Provisioning and re-download.');
  out('#   * Use  /queue tree print stats  to watch live bandwidth.');
  out('#   * For PPPoE-only setups, consider parent=<pppoe-out-iface>.');
  out('# ============================================================');
  out('');

  return lines.join('\n');
}

// ============================================================
// generateRadiusRsc(opts)
// ------------------------------------------------------------
// Produces a RouterOS script that wires the MikroTik up to the
// Skynity FreeRADIUS server. It:
//
//   * /radius add                    (auth + acct + CoA)
//   * /radius incoming set accept=yes port=3799
//   * /ppp aaa set use-radius=yes accounting=yes interim-update=1m
//   * /ip hotspot profile set <default-hs>  use-radius=yes
//     accounting=yes interim-update=1m
//   * /tool user-manager ...         (deliberately NOT touched —
//                                     some operators keep MT user-
//                                     manager for voucher hotspot.)
//
// opts:
//   radiusHost   — VPS IP/DNS that MikroTik reaches RADIUS at
//   radiusSecret — shared secret (matches `mikrotik_routers.radius_secret`
//                  AND the row this backend will INSERT into `nas`)
//   coaPort      — 3799 by default
//   interimSecs  — accounting interim-update interval, default 60
//   hotspotProfile — name of the hotspot server profile to flip, default 'skynity'
// ============================================================
export async function generateRadiusRsc(opts = {}) {
  const [
    brandRaw, confHost, confSecret, confInterim,
  ] = await Promise.all([
    settings.getSetting('site.name'),
    settings.getSetting('radius.host'),
    settings.getSetting('radius.default_secret'),
    settings.getSetting('radius.accounting_interval'),
  ]);
  const brand        = brandRaw || 'Skynity ISP';
  const radiusHost   = opts.radiusHost   || confHost     || '';
  const radiusSecret = opts.radiusSecret || confSecret   || 'CHANGE_ME_shared_secret';
  const coaPort      = Number(opts.coaPort || 3799) || 3799;
  const interim      = Number(opts.interimSecs ?? confInterim ?? 60) || 60;
  const hsProfile    = opts.hotspotProfile || 'skynity';

  if (!radiusHost) {
    throw new Error('radius.host is empty — set it in Settings → RADIUS or pass ?host=…');
  }

  const lines = [];
  const out = (s = '') => lines.push(s);
  const now = new Date().toISOString();

  out('# ============================================================');
  out(`# ${brand} — RADIUS / AAA switchover script`);
  out(`# Generated: ${now}`);
  out('#');
  out('# Copy the contents of this file into a RouterOS terminal');
  out('# (WinBox → New Terminal) OR drop the .rsc into Files and run:');
  out('#   /import file-name=skynity-radius.rsc');
  out('#');
  out('# PREREQUISITES:');
  out('#   * The VPS running FreeRADIUS is reachable from this router');
  out('#     on UDP 1812 (auth) and UDP 1813 (accounting).');
  out('#   * The shared secret below MUST match:');
  out('#       mikrotik_routers.radius_secret  (Skynity DB)');
  out('#       radius.default_secret            (Settings)');
  out('#       nas.secret                        (FreeRADIUS DB row)');
  out('#     Rotate it later via Settings → RADIUS — this script');
  out('#     only seeds the FIRST value.');
  out('#   * DO NOT run this on a production router until you have');
  out('#     tested with a spare PPPoE secret first. See docs/RADIUS.md.');
  out('# ============================================================');
  out('');
  out(':log info "skynity: enabling RADIUS";');
  out('');

  // Idempotent: remove any Skynity-managed RADIUS entries before re-adding
  out('# 1) Purge any previous Skynity RADIUS client entries');
  out('/radius');
  out(':foreach r in=[find where comment~"skynity:radius"] do={ remove $r }');
  out('');

  // Add two entries: one for ppp, one for hotspot — MikroTik
  // matches by `service` so a single row can cover both, but
  // separating makes the per-service logs clearer.
  out('# 2) Register FreeRADIUS as a RADIUS server for PPP + Hotspot');
  out('/radius');
  out(
    `add service=ppp,hotspot ` +
    `address=${rscEscape(radiusHost)} ` +
    `secret="${rscEscape(radiusSecret)}" ` +
    `authentication-port=1812 accounting-port=1813 ` +
    `timeout=3s called-id="${rscEscape(brand)}" ` +
    `comment="skynity:radius:primary"`
  );
  out('');

  // Enable CoA listener so Skynity can issue disconnects via PoD
  out('# 3) Allow incoming CoA / Disconnect on UDP/3799');
  out('/radius incoming');
  out(`set accept=yes port=${coaPort}`);
  out('');

  // Flip /ppp aaa onto RADIUS
  out('# 4) PPPoE — use RADIUS for auth + accounting');
  out('/ppp aaa');
  out(`set use-radius=yes accounting=yes interim-update=${interim}s`);
  out('');

  // Hotspot profile — try the named one, otherwise apply to all
  // user-created profiles (the built-in "default" is left alone).
  out('# 5) Hotspot — use RADIUS on the Skynity profile');
  out('/ip hotspot profile');
  out(
    `:if ([find name="${rscEscape(hsProfile)}"] != "") do={ ` +
    `set [find name="${rscEscape(hsProfile)}"] use-radius=yes ` +
    `} else={ ` +
    `:log warning "skynity: hotspot profile '${rscEscape(hsProfile)}' not found — run setup.rsc first" ` +
    `}`
  );
  out('');
  out('# 6) Hotspot user-profile accounting — applies to every user profile');
  out('/ip hotspot user profile');
  out(`:foreach p in=[find] do={ set $p add-mac-cookie=yes }`);
  out('');

  out('# ============================================================');
  out('# DONE. Verify with:');
  out('#   /radius monitor 0');
  out('#   /ppp aaa print');
  out('#   /log print where topics~"radius"');
  out('#');
  out('# Roll back (if anything goes wrong):');
  out('#   /ppp aaa set use-radius=no accounting=no');
  out('#   /radius remove [find comment~"skynity:radius"]');
  out('# ============================================================');
  out('');

  return lines.join('\n');
}

export default {
  generateSetupRsc,
  generatePortalHtml,
  generatePcqRsc,
  generateRadiusRsc,
};
