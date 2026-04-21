-- ============================================================
-- Skynity ISP — Phase 13
--   * Per-router uplink interface + capacity fields so the
--     Bandwidth dashboard can compute oversubscription, utilisation
--     and the current "idle-share" benefit.
-- ============================================================

SET NAMES utf8mb4;
SET time_zone = '+06:00';

-- ------------------------------------------------------------
-- mikrotik_routers: which interface is the WAN / uplink and how
-- many Mbps the admin's ISP actually delivers on it.
-- ------------------------------------------------------------
ALTER TABLE mikrotik_routers
  ADD COLUMN uplink_interface VARCHAR(64) NULL AFTER note,
  ADD COLUMN uplink_down_mbps INT UNSIGNED NOT NULL DEFAULT 0 AFTER uplink_interface,
  ADD COLUMN uplink_up_mbps   INT UNSIGNED NOT NULL DEFAULT 0 AFTER uplink_down_mbps;

-- ------------------------------------------------------------
-- Settings
-- ------------------------------------------------------------
INSERT INTO system_settings (setting_key, setting_value, value_type, description, is_secret) VALUES
  ('bandwidth.oversub_warn_ratio', '2.5',  'number',
    'Committed / uplink ratio above which the Bandwidth dashboard shows a warning.', 0),
  ('bandwidth.oversub_crit_ratio', '4.0',  'number',
    'Committed / uplink ratio above which the Bandwidth dashboard shows a critical state.', 0),
  ('bandwidth.show_customer_share', 'true', 'boolean',
    'Show the real-time "idle-share bonus" banner on the customer portal and dashboard.', 0)
ON DUPLICATE KEY UPDATE setting_key = setting_key;
