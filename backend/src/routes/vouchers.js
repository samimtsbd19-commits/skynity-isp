// ============================================================
// /api/vouchers — admin-only CRUD for prepaid voucher codes
// ============================================================
import { Router } from 'express';
import db from '../database/pool.js';
import { requireAdmin, requireRole } from '../middleware/auth.js';
import vouchers from '../services/vouchers.js';
import logger from '../utils/logger.js';
import * as settings from '../services/settings.js';
import config from '../config/index.js';

const router = Router();

// ------------------------------------------------------------
// GET /api/vouchers/batches
// ------------------------------------------------------------
router.get('/batches', requireAdmin, async (_req, res) => {
  try {
    const batches = await vouchers.listBatches();
    res.json({ batches });
  } catch (err) {
    logger.error({ err }, 'list voucher batches failed');
    res.status(500).json({ error: 'internal error' });
  }
});

// ------------------------------------------------------------
// GET /api/vouchers
//   ?batchId=..&redeemed=true|false&limit&offset
// ------------------------------------------------------------
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { batchId, redeemed, limit, offset } = req.query;
    const rows = await vouchers.listVouchers({
      batchId, redeemed,
      limit: Math.min(Number(limit) || 200, 500),
      offset: Math.max(Number(offset) || 0, 0),
    });
    res.json({ vouchers: rows });
  } catch (err) {
    logger.error({ err }, 'list vouchers failed');
    res.status(500).json({ error: 'internal error' });
  }
});

// ------------------------------------------------------------
// POST /api/vouchers/batch
//   body: { package_id, count, name?, expires_at?, note? }
// ------------------------------------------------------------
router.post('/batch', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    const { package_id, count, name, expires_at, note } = req.body || {};
    if (!package_id) return res.status(400).json({ error: 'package_id required' });
    if (!count || Number(count) < 1) return res.status(400).json({ error: 'count required' });

    const result = await vouchers.createBatch({
      packageId: Number(package_id),
      count: Number(count),
      name,
      expiresAt: expires_at || null,
      adminId: req.admin.id,
      note,
    });

    await db.query(
      `INSERT INTO activity_log (actor_type, actor_id, action, entity_type, entity_id, meta)
       VALUES ('admin', ?, 'voucher_batch_created', 'voucher_batch', ?, ?)`,
      [String(req.admin.id), result.batchId, JSON.stringify({ count: result.count, package_id })]
    );

    res.json(result);
  } catch (err) {
    logger.error({ err, body: req.body }, 'create voucher batch failed');
    res.status(400).json({ error: err.message || 'internal error' });
  }
});

// ------------------------------------------------------------
// DELETE /api/vouchers/batches/:id
//   Deletes unredeemed vouchers in the batch. Keeps the ones
//   that were already used so subscriptions stay auditable.
// ------------------------------------------------------------
router.delete('/batches/:id', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    const result = await vouchers.deleteBatch(req.params.id);
    await db.query(
      `INSERT INTO activity_log (actor_type, actor_id, action, entity_type, entity_id, meta)
       VALUES ('admin', ?, 'voucher_batch_deleted', 'voucher_batch', ?, ?)`,
      [String(req.admin.id), req.params.id, JSON.stringify(result)]
    );
    res.json(result);
  } catch (err) {
    logger.error({ err }, 'delete voucher batch failed');
    res.status(400).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// DELETE /api/vouchers/:id   (single unredeemed voucher)
// ------------------------------------------------------------
router.delete('/:id', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    const v = await db.queryOne('SELECT is_redeemed FROM vouchers WHERE id = ?', [req.params.id]);
    if (!v) return res.status(404).json({ error: 'not found' });
    if (v.is_redeemed) return res.status(400).json({ error: 'cannot delete a redeemed voucher' });
    await db.query('DELETE FROM vouchers WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// GET /api/vouchers/batches/:id/print
//   Printable HTML sheet — open, press Ctrl+P, cut.
// ------------------------------------------------------------
router.get('/batches/:id/print', requireAdmin, async (req, res) => {
  try {
    const batchId = req.params.id;
    const batch = await db.queryOne(
      `SELECT b.*, p.name AS package_name, p.code AS package_code, p.price,
              p.rate_down_mbps, p.rate_up_mbps, p.duration_days, p.service_type
         FROM voucher_batches b JOIN packages p ON p.id = b.package_id
         WHERE b.id = ?`,
      [batchId]
    );
    if (!batch) return res.status(404).send('batch not found');

    const rows = await db.query(
      `SELECT code FROM vouchers WHERE batch_id = ? ORDER BY id ASC`,
      [batchId]
    );

    const [brand, logo, color, portalUrl, currencySymbol] = await Promise.all([
      settings.getSetting('site.name'),
      settings.getSetting('branding.logo_url'),
      settings.getSetting('branding.primary_color'),
      settings.getSetting('site.public_base_url'),
      settings.getSetting('site.currency_symbol'),
    ]);

    const brandName   = brand || config.APP_NAME || 'Skynity ISP';
    const primary     = color || '#f59e0b';
    const logoUrl     = logo || '';
    const portal      = (portalUrl || config.PUBLIC_BASE_URL || '').replace(/\/$/, '') + '/portal/redeem';
    const symbol      = currencySymbol || config.CURRENCY_SYMBOL || '৳';

    const speed = `${batch.rate_down_mbps}↓ / ${batch.rate_up_mbps}↑ Mbps`;
    const durationTxt = `${batch.duration_days} day${batch.duration_days > 1 ? 's' : ''}`;
    const expiryTxt = batch.expires_at ? `Use by ${new Date(batch.expires_at).toLocaleDateString()}` : '';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html>
<html><head>
<meta charset="utf-8"/>
<title>Voucher batch — ${escapeHtml(batch.name)}</title>
<style>
  :root { --primary: ${primary}; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; background:#f4f4f4; margin:0; padding:24px;}
  .sheet { max-width: 780px; margin: 0 auto; }
  .header { display:flex; align-items:center; gap:12px; margin-bottom:16px; }
  .header img { height:40px; }
  .header h1 { margin:0; font-size:20px; color:#222; }
  .meta { color:#555; font-size:13px; margin-bottom:16px; }
  .grid { display:grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap:10px; }
  .v {
    border: 2px dashed var(--primary);
    border-radius: 10px;
    padding: 12px 14px;
    background:#fff;
    break-inside: avoid;
  }
  .v .top { display:flex; justify-content:space-between; align-items:center; font-size:11px; color:#666; margin-bottom:6px;}
  .v .brand { font-weight:700; color: var(--primary); }
  .v .code  { font-family: ui-monospace, Menlo, monospace; font-size:22px; font-weight:700; letter-spacing:2px; text-align:center; margin:6px 0 4px; color:#111;}
  .v .pkg   { text-align:center; font-size:12px; color:#333; }
  .v .instr { margin-top:8px; border-top:1px solid #eee; padding-top:6px; font-size:10px; color:#555; text-align:center; line-height:1.35;}
  .controls { margin-bottom:16px;}
  .controls button {
    background:var(--primary); color:#111; border:0; padding:8px 14px; border-radius:6px; cursor:pointer; font-weight:600;
  }
  @media print {
    body { background:#fff; padding:0; }
    .controls { display:none; }
    .v { border-color:#000 !important; }
    .grid { gap: 6px; }
    @page { margin: 10mm; }
  }
</style>
</head><body>
<div class="sheet">
  <div class="controls"><button onclick="window.print()">🖨 Print</button></div>
  <div class="header">
    ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="logo">` : ''}
    <div>
      <h1>${escapeHtml(brandName)} — Voucher sheet</h1>
      <div class="meta">
        ${escapeHtml(batch.name)} · ${rows.length} codes · ${escapeHtml(batch.package_name)} · ${escapeHtml(speed)} · ${escapeHtml(durationTxt)} · ${symbol}${batch.price}
        ${expiryTxt ? ` · ${escapeHtml(expiryTxt)}` : ''}
      </div>
    </div>
  </div>
  <div class="grid">
    ${rows.map(r => `
      <div class="v">
        <div class="top"><span class="brand">${escapeHtml(brandName)}</span><span>${escapeHtml(batch.package_code)}</span></div>
        <div class="code">${escapeHtml(r.code)}</div>
        <div class="pkg">${escapeHtml(batch.package_name)} · ${escapeHtml(speed)} · ${escapeHtml(durationTxt)}</div>
        <div class="instr">
          Go to <b>${escapeHtml(portal)}</b><br>
          Enter this code to get WiFi credentials.
        </div>
      </div>
    `).join('')}
  </div>
</div>
</body></html>`);
  } catch (err) {
    logger.error({ err }, 'voucher print failed');
    res.status(500).send('error');
  }
});

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export default router;
