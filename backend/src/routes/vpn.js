// ============================================================
// /api/vpn — tunnels, peers, client-config export
// ============================================================

import { Router } from 'express';
import db from '../database/pool.js';
import { requireAdmin, requireRole } from '../middleware/auth.js';
import * as svc from '../services/vpnTunnels.js';

const router = Router();

// ---------- tunnels ----------
router.get('/tunnels', requireAdmin, async (req, res) => {
  const routerId = req.query.router_id ? Number(req.query.router_id) : undefined;
  const kind = req.query.kind || undefined;
  res.json({ tunnels: await svc.listTunnels({ routerId, kind }) });
});

router.get('/tunnels/:id', requireAdmin, async (req, res) => {
  const t = await svc.getTunnel(Number(req.params.id));
  if (!t) return res.status(404).json({ error: 'not found' });
  // strip encrypted blobs
  delete t.private_key_enc;
  delete t.preshared_key_enc;
  delete t.secret_enc;
  res.json(t);
});

router.post('/tunnels', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    const b = req.body || {};
    const id = await svc.createTunnel({
      routerId: Number(b.router_id),
      kind: b.kind,
      name: b.name,
      listenPort: b.listen_port,
      localAddress: b.local_address,
      remoteAddress: b.remote_address,
      publicKey: b.public_key,
      privateKey: b.private_key,
      presharedKey: b.preshared_key,
      allowedIps: b.allowed_ips,
      persistentKeepalive: b.persistent_keepalive,
      mtu: b.mtu,
      secret: b.secret,
      authMethod: b.auth_method,
      dhGroup: b.dh_group,
      encryption: b.encryption,
      note: b.note,
    });
    await db.query(
      `INSERT INTO activity_log (actor_type, actor_id, action, entity_type, entity_id, meta)
       VALUES ('admin', ?, 'vpn_tunnel_created', 'vpn_tunnel', ?, ?)`,
      [String(req.admin.id), String(id), JSON.stringify({ kind: b.kind, name: b.name })]
    );
    res.json({ id });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/tunnels/:id/sync', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  try { res.json(await svc.syncTunnelToRouter(Number(req.params.id))); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/tunnels/:id/toggle', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  try { await svc.toggleTunnel(Number(req.params.id), !!req.body?.enabled); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/tunnels/:id', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  try { await svc.deleteTunnel(Number(req.params.id)); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------- peers (wireguard) ----------
router.get('/tunnels/:id/peers', requireAdmin, async (req, res) => {
  res.json({ peers: await svc.listPeers(Number(req.params.id)) });
});

router.post('/tunnels/:id/peers', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    const b = req.body || {};
    const id = await svc.createPeer({
      tunnelId: Number(req.params.id),
      name: b.name,
      customerId: b.customer_id,
      allowedAddress: b.allowed_address,
      endpoint: b.endpoint,
      persistentKeepalive: b.persistent_keepalive,
    });
    res.json({ id });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/peers/:id/sync', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  try { res.json(await svc.syncPeerToRouter(Number(req.params.id))); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/peers/:id', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  try { await svc.deletePeer(Number(req.params.id)); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/peers/:id/config', requireAdmin, async (req, res) => {
  try {
    const conf = await svc.exportPeerConfig(Number(req.params.id), {
      endpointOverride: req.query.endpoint,
      dns: req.query.dns,
    });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(conf);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
