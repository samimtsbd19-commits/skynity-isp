-- ============================================================
-- Skynity ISP — Phase 16
--   Monthly data quota per package
--   * packages.monthly_quota_gb  — NULL = unlimited
--   * subscriptions: quota tracking columns
-- ============================================================

SET NAMES utf8mb4;

-- Add quota cap to packages (NULL = unlimited)
ALTER TABLE packages
  ADD COLUMN monthly_quota_gb INT UNSIGNED NULL DEFAULT NULL
  COMMENT 'Monthly data cap in GB. NULL = unlimited. After quota exceeded, subscriber throttled to 1 Mbps.';

-- Add quota tracking to subscriptions
ALTER TABLE subscriptions
  ADD COLUMN quota_used_gb   DECIMAL(12,3) NOT NULL DEFAULT 0
    COMMENT 'GB consumed this billing month',
  ADD COLUMN quota_reset_at  DATETIME NULL
    COMMENT 'Next quota reset date (1st of each month)',
  ADD COLUMN quota_throttled TINYINT(1)    NOT NULL DEFAULT 0
    COMMENT '1 = currently throttled due to quota exceeded',
  ADD COLUMN mikrotik_profile_original VARCHAR(80) NULL
    COMMENT 'Original MikroTik profile saved before quota throttle was applied';

-- Index for fast cron lookup
ALTER TABLE subscriptions
  ADD INDEX idx_quota_throttled (quota_throttled),
  ADD INDEX idx_quota_reset     (quota_reset_at);
