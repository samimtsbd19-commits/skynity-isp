// ============================================================
// Quick shortcuts — one-line user creation from Telegram
// ------------------------------------------------------------
//   /huser <speed> <duration>   — hotspot user (e.g. /huser 5M 30d)
//   /puser <speed> <duration>   — PPPoE user
//   /vgen  <count> <speed> <duration>  — generate voucher batch
// Returns auto-generated username + password to the admin.
// ============================================================

import { getMikrotikClient } from '../mikrotik/client.js';
import db from '../database/pool.js';
import logger from '../utils/logger.js';

// ── parsers ─────────────────────────────────────────────────
// "5M"  → { bps: 5_000_000, str: '5M' }
// "512K"→ { bps: 512_000,   str: '512K' }
// "1G"  → { bps: 1_000_000_000, str: '1G' }
function parseSpeed(s) {
  if (!s) return null;
  const m = String(s).trim().toUpperCase().match(/^(\d+)\s*([KMG])?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] || 'M';
  const mult = unit === 'K' ? 1000 : unit === 'M' ? 1_000_000 : 1_000_000_000;
  return { bps: n * mult, str: `${n}${unit}` };
}

// "30d" → { days: 30 } ; "24h" → { hours: 24 } ; "60m" → { minutes: 60 }
function parseDuration(s) {
  if (!s) return null;
  const m = String(s).trim().toLowerCase().match(/^(\d+)\s*([dhm])?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] || 'd';
  const ms = unit === 'd' ? n * 86400_000 : unit === 'h' ? n * 3600_000 : n * 60_000;
  return { ms, n, unit, str: `${n}${unit}` };
}

function calcExpiry(dur) {
  return new Date(Date.now() + dur.ms);
}

// Character set avoids ambiguous chars (O/0, I/l/1)
const SAFE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
function randomStr(len, pool = SAFE_CHARS) {
  let s = '';
  for (let i = 0; i < len; i++) s += pool[Math.floor(Math.random() * pool.length)];
  return s;
}

const HELP_TEXT =
  '*Quick user creation*\n\n' +
  '`/huser <speed> <duration>` — Hotspot user\n' +
  '`/puser <speed> <duration>` — PPPoE user\n' +
  '`/vgen <count> <speed> <duration>` — Voucher batch\n\n' +
  '*Examples:*\n' +
  '`/huser 5M 30d` — 5 Mbps for 30 days\n' +
  '`/huser 2M 7d` — 2 Mbps for 7 days\n' +
  '`/huser 512K 24h` — 512 Kbps for 24 hours\n' +
  '`/puser 10M 30d` — PPPoE 10 Mbps, 30 days\n' +
  '`/vgen 20 5M 7d` — 20 vouchers, 5M/7d each\n\n' +
  '*Speed units:* K, M, G · *Duration:* d, h, m';

// ═════════════════════════════════════════════════════════════
export function registerQuickCommands(bot, { isAdmin }) {

  // ── /huser help ──────────────────────────────────────────
  bot.onText(/^\/huser$/i, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    await bot.sendMessage(msg.chat.id, HELP_TEXT, { parse_mode: 'Markdown' });
  });

  // ── /huser 5M 30d ────────────────────────────────────────
  bot.onText(/^\/huser\s+(\S+)\s+(\S+)$/i, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return;
    const speed = parseSpeed(match[1]);
    const dur = parseDuration(match[2]);
    if (!speed || !dur) {
      return bot.sendMessage(msg.chat.id, '❌ Invalid format.\nTry: `/huser 5M 30d`', { parse_mode: 'Markdown' });
    }
    try {
      const username = `h-${randomStr(5)}`;
      const password = randomStr(8);
      const expiry = calcExpiry(dur);
      const expStr = expiry.toISOString().slice(0, 16).replace('T', ' ');

      const client = await getMikrotikClient();
      // Create the user first (with default profile)
      await client.createHotspotUser({
        name: username,
        password,
        profile: 'default',
        comment: `quick ${speed.str}/${dur.str} exp:${expiry.toISOString().slice(0, 10)} by:tg:${msg.from.id}`,
      });

      // Then patch in the rate-limit (per-user override works)
      const list = await client.get('/ip/hotspot/user');
      const created = list.find((u) => u.name === username);
      if (created) {
        await client.patch(`/ip/hotspot/user/${encodeURIComponent(created['.id'])}`, {
          'rate-limit': `${speed.str}/${speed.str}`,
        });
      }

      // Try to extract hotspot server URL (if portal URL in settings)
      let portalUrl = '';
      try {
        const row = await db.queryOne(`SELECT setting_value FROM system_settings WHERE setting_key='site.public_base_url' LIMIT 1`);
        if (row?.setting_value) portalUrl = `\n🌐 Portal: ${row.setting_value}/portal`;
      } catch { /* ignore */ }

      await bot.sendMessage(
        msg.chat.id,
        `✅ *Hotspot user created*\n\n` +
          `👤 Username: \`${username}\`\n` +
          `🔑 Password: \`${password}\`\n` +
          `⚡ Speed: *${speed.str}/${speed.str}*\n` +
          `⏱ Valid: *${dur.str}*\n` +
          `📅 Expires: *${expStr}*` +
          portalUrl +
          `\n\n_Copy credentials for the customer. Rate-limit is active immediately on MikroTik._`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      logger.error({ err: err.message }, 'huser quick create failed');
      await bot.sendMessage(msg.chat.id, `❌ ${err.message}`);
    }
  });

  // ── /puser help ──────────────────────────────────────────
  bot.onText(/^\/puser$/i, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    await bot.sendMessage(msg.chat.id,
      '*Quick PPPoE user*\n\n`/puser <speed> <duration>`\n\nExample: `/puser 10M 30d`',
      { parse_mode: 'Markdown' });
  });

  // ── /puser 10M 30d ───────────────────────────────────────
  bot.onText(/^\/puser\s+(\S+)\s+(\S+)$/i, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return;
    const speed = parseSpeed(match[1]);
    const dur = parseDuration(match[2]);
    if (!speed || !dur) {
      return bot.sendMessage(msg.chat.id, '❌ Invalid format.\nTry: `/puser 10M 30d`', { parse_mode: 'Markdown' });
    }
    try {
      const username = `p-${randomStr(5)}`;
      const password = randomStr(8);
      const expiry = calcExpiry(dur);
      const expStr = expiry.toISOString().slice(0, 16).replace('T', ' ');

      const client = await getMikrotikClient();
      await client.createPppSecret({
        name: username,
        password,
        profile: 'default',
        service: 'pppoe',
        comment: `quick ${speed.str}/${dur.str} exp:${expiry.toISOString().slice(0, 10)} by:tg:${msg.from.id}`,
      });

      // PPPoE rate-limit goes on the secret itself
      const list = await client.listPppSecrets();
      const created = list.find((s) => s.name === username);
      if (created) {
        await client.patch(`/ppp/secret/${encodeURIComponent(created['.id'])}`, {
          'rate-limit': `${speed.str}/${speed.str}`,
        });
      }

      await bot.sendMessage(
        msg.chat.id,
        `✅ *PPPoE user created*\n\n` +
          `👤 Username: \`${username}\`\n` +
          `🔑 Password: \`${password}\`\n` +
          `⚡ Speed: *${speed.str}/${speed.str}*\n` +
          `⏱ Valid: *${dur.str}*\n` +
          `📅 Expires: *${expStr}*\n\n` +
          `_Configure on customer's router:_\n` +
          `_Interface → PPPoE Client → Username + Password above_`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      logger.error({ err: err.message }, 'puser quick create failed');
      await bot.sendMessage(msg.chat.id, `❌ ${err.message}`);
    }
  });

  // ── /vgen 20 5M 7d ───────────────────────────────────────
  bot.onText(/^\/vgen(?:\s+(\d+)\s+(\S+)\s+(\S+))?$/i, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return;
    if (!match[1]) {
      return bot.sendMessage(msg.chat.id,
        '*Quick voucher batch*\n\n`/vgen <count> <speed> <duration>`\n\nExample: `/vgen 20 5M 7d`',
        { parse_mode: 'Markdown' });
    }
    const count = Math.min(100, Math.max(1, Number(match[1])));
    const speed = parseSpeed(match[2]);
    const dur = parseDuration(match[3]);
    if (!speed || !dur) {
      return bot.sendMessage(msg.chat.id, '❌ Invalid format.\nTry: `/vgen 20 5M 7d`', { parse_mode: 'Markdown' });
    }
    try {
      const client = await getMikrotikClient();
      const created = [];
      const expiry = calcExpiry(dur);
      const expStamp = expiry.toISOString().slice(0, 10);

      for (let i = 0; i < count; i++) {
        const code = randomStr(8).toUpperCase();
        try {
          await client.createHotspotUser({
            name: code,
            password: code, // same as username for voucher-style
            profile: 'default',
            comment: `voucher ${speed.str}/${dur.str} exp:${expStamp} by:tg:${msg.from.id}`,
          });
          const list = await client.get('/ip/hotspot/user');
          const justMade = list.find((u) => u.name === code);
          if (justMade) {
            await client.patch(`/ip/hotspot/user/${encodeURIComponent(justMade['.id'])}`, {
              'rate-limit': `${speed.str}/${speed.str}`,
            });
          }
          created.push(code);
        } catch (err) {
          logger.warn({ err: err.message, code }, 'vgen: skipping voucher');
        }
      }

      const list = created.map((c, i) => `${String(i + 1).padStart(2, ' ')}. \`${c}\``).join('\n');
      await bot.sendMessage(
        msg.chat.id,
        `✅ *${created.length} voucher${created.length !== 1 ? 's' : ''} created*\n` +
          `⚡ Each: *${speed.str}/${speed.str}* for *${dur.str}*\n` +
          `📅 Expires: *${expStamp}*\n\n${list}\n\n` +
          `_Username = Password = code. Share with customers._`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      logger.error({ err: err.message }, 'vgen quick create failed');
      await bot.sendMessage(msg.chat.id, `❌ ${err.message}`);
    }
  });

  // ── Master help ──────────────────────────────────────────
  bot.onText(/^\/quick$|^\/shortcuts$/i, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    await bot.sendMessage(msg.chat.id, HELP_TEXT, { parse_mode: 'Markdown' });
  });
}
