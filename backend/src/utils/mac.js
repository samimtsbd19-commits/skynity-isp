// ============================================================
// Small helpers for MAC address handling
// ============================================================

/**
 * Normalise a MAC string to the RouterOS canonical form
 * "AA:BB:CC:DD:EE:FF". Returns null if the input is missing
 * or cannot be parsed.
 *
 * Accepts:  aa-bb-cc-dd-ee-ff, aabbccddeeff, aa.bb.cc.dd.ee.ff,
 *           AA:BB:CC:DD:EE:FF (idempotent).
 */
export function normaliseMac(raw) {
  if (!raw) return null;
  const clean = String(raw).replace(/[^0-9a-fA-F]/g, '');
  if (clean.length !== 12) return null;
  return clean.toUpperCase().match(/.{2}/g).join(':');
}

/** Validate without converting — for form inputs. */
export function isValidMac(raw) {
  return normaliseMac(raw) !== null;
}
