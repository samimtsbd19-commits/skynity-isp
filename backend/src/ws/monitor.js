import { WebSocketServer } from 'ws';
import logger from '../utils/logger.js';
import { getAdminFromToken } from '../middleware/auth.js';
import { getMikrotikClient } from '../mikrotik/client.js';
import config from '../config/index.js';
import { getInterfaceCountersBySnmp } from '../services/snmp.js';

/**
 * Real-time bandwidth samples via WebSocket.
 * Source selection: SNMP (if enabled) -> REST fallback.
 */
export function attachMonitorWebSocket(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    let pathname;
    try {
      pathname = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== '/api/ws/monitor') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', async (ws, request) => {
    let searchParams;
    try {
      searchParams = new URL(request.url, `http://${request.headers.host || 'localhost'}`).searchParams;
    } catch {
      ws.close(4400, 'bad request');
      return;
    }

    const token = searchParams.get('token');
    const admin = await getAdminFromToken(token);
    if (!admin) {
      ws.close(4401, 'unauthorized');
      return;
    }

    const routerIdParam = searchParams.get('routerId');
    let routerId = null;
    if (routerIdParam != null && routerIdParam !== '') {
      const n = Number(routerIdParam);
      if (Number.isFinite(n) && n > 0) routerId = n;
    }

    const lastByIface = new Map();
    let timer = null;
    let closed = false;

    async function getInterfacesViaRest() {
      const mt = await getMikrotikClient(routerId);
      const list = await mt.interfaces();
      const arr = Array.isArray(list) ? list : [];
      return arr
        .filter((i) => i.type === 'ether')
        .map((iface) => ({
          id: iface['.id'],
          name: iface.name,
          rxByte: Number(iface['rx-byte'] || 0),
          txByte: Number(iface['tx-byte'] || 0),
          running: iface.running === 'true',
        }));
    }

    const tick = async () => {
      if (closed || ws.readyState !== ws.OPEN) return;
      try {
        let source = 'rest';
        let ether = [];
        if (config.SNMP_ENABLED) {
          try {
            ether = await getInterfaceCountersBySnmp(routerId);
            source = 'snmp';
          } catch (snmpErr) {
            logger.warn({ err: snmpErr.message, routerId }, 'snmp poll failed, falling back to rest');
            ether = await getInterfacesViaRest();
            source = 'rest-fallback';
          }
        } else {
          ether = await getInterfacesViaRest();
        }

        const now = Date.now();
        const interfaces = [];

        for (const iface of ether) {
          const id = iface.id;
          const rx = Number(iface.rxByte || 0);
          const tx = Number(iface.txByte || 0);
          const prev = lastByIface.get(id);
          let rxBps = 0;
          let txBps = 0;
          if (prev) {
            const dt = (now - prev.t) / 1000;
            if (dt > 0) {
              rxBps = Math.max(0, (rx - prev.rx) / dt);
              txBps = Math.max(0, (tx - prev.tx) / dt);
            }
          }
          lastByIface.set(id, { rx, tx, t: now });
          interfaces.push({
            id,
            name: iface.name,
            rxByte: rx,
            txByte: tx,
            rxBps,
            txBps,
            running: !!iface.running,
          });
        }

        ws.send(JSON.stringify({
          type: 'bandwidth',
          ts: now,
          routerId: routerId ?? null,
          source,
          interfaces,
        }));
      } catch (err) {
        logger.warn({ err: err.message, routerId }, 'ws monitor tick failed');
        try {
          ws.send(JSON.stringify({ type: 'error', message: err.message }));
        } catch { /* ignore */ }
      }
    };

    await tick();
    timer = setInterval(tick, 2000);

    ws.on('close', () => {
      closed = true;
      if (timer) clearInterval(timer);
    });
    ws.on('error', () => {
      closed = true;
      if (timer) clearInterval(timer);
    });
  });

  return wss;
}
