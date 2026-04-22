-- ============================================================
-- 021: Admin 2FA (TOTP) + forced password rotation flag
-- ============================================================
SET NAMES utf8mb4;

ALTER TABLE admins
  ADD COLUMN totp_secret        VARCHAR(64)  NULL,
  ADD COLUMN totp_enabled       TINYINT(1)   NOT NULL DEFAULT 0,
  ADD COLUMN totp_enrolled_at   DATETIME     NULL,
  ADD COLUMN totp_backup_codes  TEXT         NULL COMMENT 'JSON array of hashed one-time backup codes',
  ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0;

UPDATE admins SET must_change_password = 1
  WHERE username = 'admin' AND password_hash IS NOT NULL;
