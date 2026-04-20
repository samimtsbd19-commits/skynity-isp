import snmp from 'net-snmp';
import config from '../config/index.js';
import db from '../database/pool.js';

const OID_IF_NAME = '1.3.6.1.2.1.31.1.1.1.1';
const OID_IF_TYPE = '1.3.6.1.2.1.2.2.1.3';
const OID_IF_OPER = '1.3.6.1.2.1.2.2.1.8';
const OID_IF_HC_IN = '1.3.6.1.2.1.31.1.1.1.6';
const OID_IF_HC_OUT = '1.3.6.1.2.1.31.1.1.1.10';

const TYPE_ETHERNET = 6;
const OPER_UP = 1;

function parseIndex(oid) {
  const i = oid.lastIndexOf('.');
  if (i < 0) return null;
  const n = Number(oid.slice(i + 1));
  return Number.isFinite(n) ? n : null;
}

function varbindValue(vb) {
  if (!vb || snmp.isVarbindError(vb)) return null;
  if (typeof vb.value === 'bigint') return vb.value;
  if (Buffer.isBuffer(vb.value)) {
    try {
      return BigInt(`0x${vb.value.toString('hex')}`);
    } catch {
      return null;
    }
  }
  if (typeof vb.value === 'number') return BigInt(vb.value);
  if (typeof vb.value === 'string') return vb.value;
  return vb.value ?? null;
}

function walkColumn(session, baseOid) {
  return new Promise((resolve, reject) => {
    const out = new Map();
    session.subtree(
      baseOid,
      (vb) => {
        if (snmp.isVarbindError(vb)) return;
        const idx = parseIndex(vb.oid);
        if (idx == null) return;
        out.set(idx, varbindValue(vb));
      },
      (err) => {
        if (err) reject(err);
        else resolve(out);
      }
    );
  });
}

async function getSnmpHost(routerId) {
  if (!routerId) return config.MIKROTIK_HOST;
  const row = await db.queryOne(
    'SELECT host FROM mikrotik_routers WHERE id = ? AND is_active = 1',
    [routerId]
  );
  return row?.host || config.MIKROTIK_HOST;
}

function toSafeNumber(v) {
  if (v == null) return 0;
  if (typeof v === 'bigint') {
    // byte counters fit safely for practical ranges; clamp if needed
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER;
    if (v < 0n) return 0;
    return Number(v);
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

export async function getInterfaceCountersBySnmp(routerId = null) {
  if (!config.SNMP_ENABLED) throw new Error('SNMP disabled');

  const host = await getSnmpHost(routerId);
  const options = {
    port: config.SNMP_PORT,
    retries: 0,
    timeout: config.SNMP_TIMEOUT_MS,
    transport: 'udp4',
    version: config.SNMP_VERSION === '1' ? snmp.Version1 : snmp.Version2c,
  };
  const session = snmp.createSession(host, config.SNMP_COMMUNITY, options);

  try {
    const [names, types, opers, inOctets, outOctets] = await Promise.all([
      walkColumn(session, OID_IF_NAME),
      walkColumn(session, OID_IF_TYPE),
      walkColumn(session, OID_IF_OPER),
      walkColumn(session, OID_IF_HC_IN),
      walkColumn(session, OID_IF_HC_OUT),
    ]);

    const rows = [];
    for (const [idx, name] of names.entries()) {
      const type = Number(types.get(idx) ?? 0);
      if (type !== TYPE_ETHERNET) continue;
      const rx = toSafeNumber(inOctets.get(idx));
      const tx = toSafeNumber(outOctets.get(idx));
      rows.push({
        id: `snmp:${idx}`,
        name: String(name || `if${idx}`),
        rxByte: rx,
        txByte: tx,
        running: Number(opers.get(idx) ?? 0) === OPER_UP,
      });
    }
    return rows;
  } finally {
    session.close();
  }
}
