-- ============================================================
-- 022: Store per-router RADIUS shared secret encrypted in DB
-- ------------------------------------------------------------
-- Plaintext remains in radius_secret_plain until migrated by
-- backend/src/scripts/encrypt-radius-secrets.js (one-shot).
-- FreeRADIUS still reads plaintext from nas.secret (decrypt on sync).
-- ============================================================
SET NAMES utf8mb4;

ALTER TABLE mikrotik_routers
  CHANGE COLUMN radius_secret radius_secret_plain VARCHAR(128) NULL,
  ADD COLUMN radius_secret_enc TEXT NULL AFTER radius_secret_plain;
