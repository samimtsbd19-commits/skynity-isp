// ============================================================
// Admin Telegram Commands
// ------------------------------------------------------------
// Rich admin-only commands for day-to-day ops:
//   /customers [search]      — list / search customers
//   /customer <code>         — customer detail + actions
//   /renew <code> <pkg>      — manual renewal
//   /suspend <login>         — suspend a subscription
//   /resume <login>          — re-enable
//   /packages                — list packages
//   /addpkg                  — add a package (guided)
//   /routers                 — list routers & health
//   /addrouter               — add a new router (guided)
//   /active                  — currently online users
//   /today                   — today's orders & revenue
//   /backup                  — trigger DB backup
// ============================================================

import db from '../database/pool.js';
import { getMikrotikClient } from '../mikrotik/client.js';
import { encrypt } from '../utils/crypto.js';
import { expireSubscription } from '../services/provisioning.js';
import logger from '../utils/logger.js';

export function registerAdminCommands(bot, { isAdmin, setSession, getSession, clearSession, CURRENCY_SYMBOL }) {

  // ============ /customers ============
  bot.onText(/^\/customers(?:\s+(.+))?$/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return;
    const q = match[1]?.trim();
    const where = q ? `WHERE full_name LIKE ? OR phone LIKE ? OR customer_code LIKE ?` : '';
    const params = q ? [`%${q}%`, `%${q}%`, `%${q}%`] : [];
    const rows = await db.query(
      `SELECT c.*, COUNT(s.id) AS sub_count,
              MAX(s.expires_at) AS latest_expires
       FROM customers c
       LEFT JOIN subscriptions s ON s.customer_id = c.id
       ${where}
       GROUP BY c.id
       ORDER BY c.created_at DESC LIMIT 20`,
      params
    );

    if (!rows.length) return bot.sendMessage(msg.chat.id, q ? `No customers match "${q}".` : 'No customers yet.');

    const lines = rows.map((c) => {
      const exp = c.latest_expires ? new Date(c.latest_expires).toLocaleDateString() : '-';
      return `\`${c.customer_code}\` · ${c.full_name} · ${c.phone} · subs:${c.sub_count} · exp:${exp}`;
    });
    await bot.sendMessage(
      msg.chat.id,
      `👥 *Customers${q ? ` matching "${q}"` : ''}* (${rows.length})\n\n` + lines.join('\n') +
      `\n\nUse \`/customer <code>\` for details.`,
      { parse_mode: 'Markdown' }
    );
  });

  // ============ /customer <code> ============
  bot.onText(/^\/customer\s+(\S+)$/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return;
    const code = match[1].trim();
    const customer = await db.queryOne('SELECT * FROM customers WHERE customer_code = ? OR phone = ?', [code, code]);
    if (!customer) return bot.sendMessage(msg.chat.id, `❌ Customer \`${code}\` not found.`, { parse_mode: 'Markdown' });

    const subs = await db.query(
      `SELECT s.*, p.name AS pkg_name
       FROM subscriptions s JOIN packages p ON p.id = s.package_id
       WHERE s.customer_id = ? ORDER BY s.created_at DESC LIMIT 5`,
      [customer.id]
    );

    let text = `👤 *${customer.full_name}*\n` +
      `🆔 ${customer.customer_code}\n` +
      `📱 ${customer.phone}\n` +
      `📊 Status: *${customer.status}*\n` +
      `📅 Joined: ${new Date(customer.created_at).toLocaleDateString()}\n\n`;

    if (subs.length) {
      text += `*Subscriptions:*\n`;
      for (const s of subs) {
        const exp = new Date(s.expires_at);
        const alive = exp > new Date() && s.status === 'active';
        text += `${alive ? '🟢' : '⏰'} ${s.pkg_name}\n` +
                `   login: \`${s.login_username}\` · pw: \`${s.login_password}\`\n` +
                `   ${s.status} · exp: ${exp.toLocaleDateString()} · sync:${s.mt_synced ? '✓' : '✗'}\n`;
      }
    } else {
      text += `_No subscriptions yet._`;
    }

    await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  });

  // ============ /suspend <login> ============
  bot.onText(/^\/suspend\s+(\S+)$/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return;
    const login = match[1].trim();
    const sub = await db.queryOne(
      `SELECT * FROM subscriptions WHERE login_username = ? ORDER BY created_at DESC LIMIT 1`,
      [login]
    );
    if (!sub) return bot.sendMessage(msg.chat.id, `❌ Login \`${login}\` not found.`, { parse_mode: 'Markdown' });

    try {
      const mt = await getMikrotikClient(sub.router_id);
      if (sub.service_type === 'pppoe') {
        const sec = await mt.findPppSecretByName(login);
        if (sec) await mt.disablePppSecret(sec['.id']);
        const active = await mt.listPppActive();
        const live = active.find((a) => a.name === login);
        if (live) await mt.disconnectPppActive(live['.id']);
      } else {
        const user = await mt.findHotspotUserByName(login);
        if (user) await mt.disableHotspotUser(user['.id']);
      }
      await db.query(`UPDATE subscriptions SET status = 'suspended' WHERE id = ?`, [sub.id]);
      bot.sendMessage(msg.chat.id, `⏸ Suspended \`${login}\``, { parse_mode: 'Markdown' });
    } catch (err) {
      bot.sendMessage(msg.chat.id, `❌ Suspend failed: ${err.message}`);
    }
  });

  // ============ /resume <login> ============
  bot.onText(/^\/resume\s+(\S+)$/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return;
    const login = match[1].trim();
    const sub = await db.queryOne(
      `SELECT * FROM subscriptions WHERE login_username = ? ORDER BY created_at DESC LIMIT 1`,
      [login]
    );
    if (!sub) return bot.sendMessage(msg.chat.id, `❌ Login \`${login}\` not found.`, { parse_mode: 'Markdown' });

    try {
      const mt = await getMikrotikClient(sub.router_id);
      if (sub.service_type === 'pppoe') {
        const sec = await mt.findPppSecretByName(login);
        if (sec) await mt.enablePppSecret(sec['.id']);
      } else {
        const user = await mt.findHotspotUserByName(login);
        if (user) await mt.enableHotspotUser(user['.id']);
      }
      await db.query(`UPDATE subscriptions SET status = 'active' WHERE id = ?`, [sub.id]);
      bot.sendMessage(msg.chat.id, `▶️ Resumed \`${login}\``, { parse_mode: 'Markdown' });
    } catch (err) {
      bot.sendMessage(msg.chat.id, `❌ Resume failed: ${err.message}`);
    }
  });

  // ============ /packages ============
  bot.onText(/^\/packages$/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const rows = await db.query(`SELECT * FROM packages ORDER BY service_type, sort_order`);
    if (!rows.length) return bot.sendMessage(msg.chat.id, 'No packages.');
    const lines = rows.map((p) =>
      `${p.is_active ? '✅' : '⏸'} \`${p.code}\` · ${p.name} · ${CURRENCY_SYMBOL}${Number(p.price).toFixed(0)} · profile=\`${p.mikrotik_profile}\``
    );
    bot.sendMessage(msg.chat.id, `📦 *Packages*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
  });

  // ============ /active ============
  bot.onText(/^\/active$/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    try {
      const mt = await getMikrotikClient();
      const [ppp, hs] = await Promise.all([
        mt.listPppActive().catch(() => []),
        mt.listHotspotActive().catch(() => []),
      ]);
      let text = `🟢 *Currently Online*\n\n`;
      text += `*PPPoE (${ppp.length}):*\n`;
      if (!ppp.length) text += '_none_\n';
      else for (const a of ppp.slice(0, 20)) text += `• ${a.name} · ${a.address || '-'} · up:${a.uptime || '-'}\n`;
      text += `\n*Hotspot (${hs.length}):*\n`;
      if (!hs.length) text += '_none_\n';
      else for (const a of hs.slice(0, 20)) text += `• ${a.user} · ${a.address || '-'} · ${a['mac-address'] || '-'}\n`;
      bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
    } catch (err) {
      bot.sendMessage(msg.chat.id, `❌ MikroTik: ${err.message}`);
    }
  });

  // ============ /today ============
  bot.onText(/^\/today$/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const [newOrders] = await db.query(`SELECT COUNT(*) AS c FROM orders WHERE DATE(created_at) = CURDATE()`);
    const [approved] = await db.query(`SELECT COUNT(*) AS c FROM orders WHERE status = 'approved' AND DATE(approved_at) = CURDATE()`);
    const [revenue] = await db.query(`SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE status = 'verified' AND DATE(verified_at) = CURDATE()`);
    const [newCustomers] = await db.query(`SELECT COUNT(*) AS c FROM customers WHERE DATE(created_at) = CURDATE()`);
    const [expiring] = await db.query(`SELECT COUNT(*) AS c FROM subscriptions WHERE status = 'active' AND expires_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 3 DAY)`);
    bot.sendMessage(
      msg.chat.id,
      `📅 *Today's Summary*\n\n` +
      `🆕 New orders: *${newOrders.c}*\n` +
      `✅ Approved: *${approved.c}*\n` +
      `💰 Revenue: *${CURRENCY_SYMBOL}${Number(revenue.s).toFixed(2)}*\n` +
      `👥 New customers: *${newCustomers.c}*\n` +
      `⚠️ Expiring in 3 days: *${expiring.c}*`,
      { parse_mode: 'Markdown' }
    );
  });

  // ============ /routers ============
  bot.onText(/^\/routers$/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const rows = await db.query(`SELECT * FROM mikrotik_routers ORDER BY is_default DESC, id ASC`);
    if (!rows.length) return bot.sendMessage(msg.chat.id, 'No routers configured.');

    for (const r of rows) {
      let health = '❓ unknown';
      try {
        const mt = await getMikrotikClient(r.is_default ? null : r.id);
        const info = await mt.ping();
        health = `✅ ${info.version} · up:${info.uptime}`;
        await db.query(`UPDATE mikrotik_routers SET last_seen_at = NOW() WHERE id = ?`, [r.id]);
      } catch (err) {
        health = `❌ ${err.message.slice(0, 60)}`;
      }
      bot.sendMessage(
        msg.chat.id,
        `🛰 *${r.name}* ${r.is_default ? '(default)' : ''}\n` +
          `Host: \`${r.host}:${r.port}\`\n` +
          `User: \`${r.username}\`\n` +
          `SSL: ${r.use_ssl ? 'yes' : 'no'} · Active: ${r.is_active ? 'yes' : 'no'}\n` +
          `Health: ${health}`,
        { parse_mode: 'Markdown' }
      );
    }
  });

  // ============ /addrouter (guided) ============
  bot.onText(/^\/addrouter$/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    await setSession(msg.from.id, 'addrouter_name', {});
    bot.sendMessage(msg.chat.id, 'Router setup — step 1/5\n\nEnter a *name* for this router (e.g. "HQ hEX"):', {
      parse_mode: 'Markdown',
    });
  });

  // ============ /addpkg (guided) ============
  bot.onText(/^\/addpkg$/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    await setSession(msg.from.id, 'addpkg_code', {});
    bot.sendMessage(msg.chat.id,
      'Add package — step 1/8\n\n' +
      'Enter a *unique code* (e.g. `PPPOE-50M-30D`):',
      { parse_mode: 'Markdown' });
  });

  // ============ /renew <customer_code> <package_code> ============
  bot.onText(/^\/renew\s+(\S+)\s+(\S+)$/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return;
    const [, custCode, pkgCode] = match;
    const customer = await db.queryOne('SELECT * FROM customers WHERE customer_code = ? OR phone = ?', [custCode, custCode]);
    const pkg = await db.queryOne('SELECT * FROM packages WHERE code = ?', [pkgCode]);
    if (!customer) return bot.sendMessage(msg.chat.id, `❌ Customer not found.`);
    if (!pkg) return bot.sendMessage(msg.chat.id, `❌ Package not found.`);

    // Find their latest subscription of the same service_type
    const latest = await db.queryOne(
      `SELECT * FROM subscriptions WHERE customer_id = ? AND service_type = ? ORDER BY expires_at DESC LIMIT 1`,
      [customer.id, pkg.service_type]
    );

    const now = new Date();
    let newStarts, newExpires;
    if (latest && new Date(latest.expires_at) > now) {
      // extend from old expiry
      newStarts = new Date(latest.starts_at);
      newExpires = new Date(new Date(latest.expires_at).getTime() + pkg.duration_days * 86400 * 1000);
      await db.query(`UPDATE subscriptions SET expires_at = ?, package_id = ?, status = 'active' WHERE id = ?`,
        [newExpires, pkg.id, latest.id]);
      bot.sendMessage(msg.chat.id,
        `🔄 Renewed \`${latest.login_username}\`\nPackage: ${pkg.name}\nNew expiry: ${newExpires.toLocaleString()}`,
        { parse_mode: 'Markdown' });
    } else {
      // create new via provisioning flow would be cleaner; for now just warn
      bot.sendMessage(msg.chat.id, `⚠️ No active subscription to extend. Use customer's Telegram to place a new order.`);
    }
  });

  // ============ help ============
  bot.onText(/^\/admin$/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    bot.sendMessage(msg.chat.id,
      `👑 *Admin Commands*\n\n` +
      `📋 Orders\n` +
      `/pending — pending approvals\n\n` +
      `👥 Customers\n` +
      `/customers [search] — list/search\n` +
      `/customer <code> — details\n` +
      `/renew <code> <pkg-code> — manual renewal\n\n` +
      `🔌 Sessions\n` +
      `/suspend <login> — disable user\n` +
      `/resume <login> — re-enable\n` +
      `/active — who's online now\n\n` +
      `📦 Packages\n` +
      `/packages — list all\n` +
      `/addpkg — add new (guided)\n\n` +
      `🛰 Routers\n` +
      `/routers — list & health\n` +
      `/addrouter — add (guided)\n\n` +
      `📊 Stats\n` +
      `/stats — quick counts\n` +
      `/today — today's summary`,
      { parse_mode: 'Markdown' });
  });
}

// ============================================================
// Multi-step guided flows handler — call from main message handler
// Returns true if the message was consumed.
// ============================================================
export async function handleAdminGuidedFlow(bot, msg, session, { isAdmin, setSession, clearSession, CURRENCY_SYMBOL }) {
  if (!isAdmin(msg.from.id)) return false;
  const tgId = msg.from.id;
  const chatId = msg.chat.id;
  const text = msg.text?.trim();
  if (!text) return false;

  try {
    // -------- add router --------
    if (session.state.startsWith('addrouter_')) {
      const d = session.data || {};
      switch (session.state) {
        case 'addrouter_name':
          d.name = text;
          await setSession(tgId, 'addrouter_host', d);
          bot.sendMessage(chatId, 'step 2/5: Enter *host* (IP or hostname, e.g. `10.88.0.2`):', { parse_mode: 'Markdown' });
          return true;
        case 'addrouter_host':
          d.host = text;
          await setSession(tgId, 'addrouter_port', d);
          bot.sendMessage(chatId, 'step 3/5: Enter *port* (default 443):', { parse_mode: 'Markdown' });
          return true;
        case 'addrouter_port':
          d.port = parseInt(text) || 443;
          await setSession(tgId, 'addrouter_user', d);
          bot.sendMessage(chatId, 'step 4/5: Enter *username*:', { parse_mode: 'Markdown' });
          return true;
        case 'addrouter_user':
          d.username = text;
          await setSession(tgId, 'addrouter_pass', d);
          bot.sendMessage(chatId, 'step 5/5: Enter *password* (will be encrypted):', { parse_mode: 'Markdown' });
          return true;
        case 'addrouter_pass':
          d.password = text;
          const enc = encrypt(d.password);
          const res = await db.query(
            `INSERT INTO mikrotik_routers (name, host, port, username, password_enc, use_ssl, is_default, is_active)
             VALUES (?, ?, ?, ?, ?, 1, 0, 1)`,
            [d.name, d.host, d.port, d.username, enc]
          );
          await clearSession(tgId);
          // try delete the password from chat (privacy)
          bot.deleteMessage(chatId, msg.message_id).catch(() => {});
          bot.sendMessage(chatId, `✅ Router *${d.name}* added (id ${res.insertId}). Test with /routers.`, { parse_mode: 'Markdown' });
          return true;
      }
    }

    // -------- add package --------
    if (session.state.startsWith('addpkg_')) {
      const d = session.data || {};
      switch (session.state) {
        case 'addpkg_code':
          d.code = text.toUpperCase();
          await setSession(tgId, 'addpkg_name', d);
          bot.sendMessage(chatId, 'step 2/8: Enter *display name* (e.g. "PPPoE 50Mbps — 30 Days"):', { parse_mode: 'Markdown' });
          return true;
        case 'addpkg_name':
          d.name = text;
          await setSession(tgId, 'addpkg_type', d);
          bot.sendMessage(chatId, 'step 3/8: *Service type*? Reply `pppoe` or `hotspot`:', { parse_mode: 'Markdown' });
          return true;
        case 'addpkg_type':
          if (!['pppoe', 'hotspot'].includes(text.toLowerCase())) {
            bot.sendMessage(chatId, 'Please reply `pppoe` or `hotspot`.', { parse_mode: 'Markdown' });
            return true;
          }
          d.service_type = text.toLowerCase();
          await setSession(tgId, 'addpkg_speed', d);
          bot.sendMessage(chatId, 'step 4/8: *Download speed* in Mbps (e.g. `10`):', { parse_mode: 'Markdown' });
          return true;
        case 'addpkg_speed':
          const sp = parseFloat(text);
          if (!sp || sp <= 0) { bot.sendMessage(chatId, 'Enter a valid number.'); return true; }
          d.speed = sp;
          await setSession(tgId, 'addpkg_duration', d);
          bot.sendMessage(chatId, 'step 5/8: *Duration* in days (e.g. `30`):', { parse_mode: 'Markdown' });
          return true;
        case 'addpkg_duration':
          const dur = parseInt(text);
          if (!dur || dur <= 0) { bot.sendMessage(chatId, 'Enter a valid number.'); return true; }
          d.duration = dur;
          await setSession(tgId, 'addpkg_price', d);
          bot.sendMessage(chatId, `step 6/8: *Price* in ${CURRENCY_SYMBOL} (e.g. \`500\`):`, { parse_mode: 'Markdown' });
          return true;
        case 'addpkg_price':
          const pr = parseFloat(text);
          if (!pr || pr <= 0) { bot.sendMessage(chatId, 'Enter a valid price.'); return true; }
          d.price = pr;
          await setSession(tgId, 'addpkg_profile', d);
          bot.sendMessage(chatId,
            `step 7/8: Enter MikroTik *profile name* (must exist on router).\n` +
            `For PPPoE: /ppp profile\nFor Hotspot: /ip hotspot user profile\n` +
            `Example: \`pppoe-50mb\``,
            { parse_mode: 'Markdown' });
          return true;
        case 'addpkg_profile':
          d.profile = text;
          await setSession(tgId, 'addpkg_confirm', d);
          bot.sendMessage(chatId,
            `*Review:*\n\n` +
            `Code: \`${d.code}\`\nName: ${d.name}\nType: ${d.service_type}\n` +
            `Speed: ${d.speed} Mbps\nDuration: ${d.duration} days\n` +
            `Price: ${CURRENCY_SYMBOL}${d.price}\nProfile: \`${d.profile}\`\n\n` +
            `Reply \`yes\` to save, anything else to cancel.`,
            { parse_mode: 'Markdown' });
          return true;
        case 'addpkg_confirm':
          if (text.toLowerCase() === 'yes') {
            await db.query(
              `INSERT INTO packages (code, name, service_type, rate_up_mbps, rate_down_mbps,
                                     duration_days, price, mikrotik_profile, is_active, sort_order)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 100)`,
              [d.code, d.name, d.service_type, d.speed, d.speed, d.duration, d.price, d.profile]
            );
            bot.sendMessage(chatId, `✅ Package *${d.code}* saved.`, { parse_mode: 'Markdown' });
          } else {
            bot.sendMessage(chatId, 'Cancelled.');
          }
          await clearSession(tgId);
          return true;
      }
    }
  } catch (err) {
    logger.error({ err }, 'admin guided flow error');
    bot.sendMessage(chatId, `❌ Error: ${err.message}`);
    await clearSession(tgId);
    return true;
  }

  return false;
}

export default { registerAdminCommands, handleAdminGuidedFlow };
