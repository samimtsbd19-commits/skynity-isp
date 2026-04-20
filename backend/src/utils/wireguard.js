// ============================================================
// WireGuard key generation (Curve25519)
// ------------------------------------------------------------
// Produces the 32-byte private/public keys expected by both
// MikroTik and the wg-quick client config format. Uses Node's
// built-in crypto (no wg binary required).
// ============================================================

import crypto from 'node:crypto';

function clampScalar(bytes) {
  bytes[0] &= 248;
  bytes[31] &= 127;
  bytes[31] |= 64;
  return bytes;
}

export function generateWireguardKeypair() {
  const priv = clampScalar(crypto.randomBytes(32));
  const kp = crypto.createECDH('prime256v1'); // placeholder; we use x25519 below
  // Node >=14 supports x25519 via generateKeyPairSync
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });
  // DER wrappers: last 32 bytes of the encoded keys are the raw keys.
  const privRaw = privateKey.subarray(privateKey.length - 32);
  const pubRaw = publicKey.subarray(publicKey.length - 32);
  return {
    privateKey: privRaw.toString('base64'),
    publicKey: pubRaw.toString('base64'),
    presharedKey: crypto.randomBytes(32).toString('base64'),
  };
}

/**
 * Build a wg-quick client config string from tunnel + peer rows.
 */
export function buildClientConfig({ peerPrivateKey, peerAddress, dns, serverPublicKey, presharedKey, endpoint, allowedIps = '0.0.0.0/0, ::/0', keepalive = 25 }) {
  const lines = [
    '[Interface]',
    `PrivateKey = ${peerPrivateKey}`,
    `Address = ${peerAddress}`,
  ];
  if (dns) lines.push(`DNS = ${dns}`);
  lines.push('');
  lines.push('[Peer]');
  lines.push(`PublicKey = ${serverPublicKey}`);
  if (presharedKey) lines.push(`PresharedKey = ${presharedKey}`);
  lines.push(`AllowedIPs = ${allowedIps}`);
  lines.push(`Endpoint = ${endpoint}`);
  if (keepalive) lines.push(`PersistentKeepalive = ${keepalive}`);
  return lines.join('\n') + '\n';
}

export default { generateWireguardKeypair, buildClientConfig };
