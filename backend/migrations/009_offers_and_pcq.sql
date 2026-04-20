-- ============================================================
-- Skynity ISP — Phase 11
--   * Marketing offers (admin-created, push-to-customers)
--   * PCQ bandwidth-sharing settings (for auto-generated .rsc)
-- ============================================================

SET NAMES utf8mb4;
SET time_zone = '+06:00';

-- ------------------------------------------------------------
-- OFFERS — an admin writes a title/description, optionally
-- attaches a featured package (highlighted on the portal) and
-- a start/end window. `broadcast_at` + `broadcast_channels`
-- track the most recent push, so we don't accidentally spam
-- the same offer twice.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS offers (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code                VARCHAR(40)  NOT NULL,
  title               VARCHAR(120) NOT NULL,
  description         TEXT NULL,
  discount_label      VARCHAR(60)  NULL,           -- free-form, e.g. "20% off", "-100 BDT"
  featured_package_id INT UNSIGNED NULL,
  starts_at           DATETIME NULL,
  ends_at             DATETIME NULL,
  is_active           TINYINT(1) NOT NULL DEFAULT 1,
  audience            ENUM('all', 'customers', 'new') NOT NULL DEFAULT 'all',
  created_by          INT UNSIGNED NULL,
  broadcast_at        DATETIME NULL,
  broadcast_channels  VARCHAR(80)  NULL,           -- comma-separated e.g. "telegram,sms"
  broadcast_count     INT UNSIGNED NOT NULL DEFAULT 0,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_offer_code (code),
  KEY idx_offer_active_window (is_active, starts_at, ends_at),
  CONSTRAINT fk_offer_pkg   FOREIGN KEY (featured_package_id) REFERENCES packages(id) ON DELETE SET NULL,
  CONSTRAINT fk_offer_admin FOREIGN KEY (created_by)          REFERENCES admins(id)   ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Track which customers have seen/dismissed each offer on the
-- portal so we can optionally hide it after 1st view.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS offer_views (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  offer_id    INT UNSIGNED NOT NULL,
  customer_id INT UNSIGNED NULL,
  phone       VARCHAR(20)  NULL,
  ip_address  VARCHAR(60)  NULL,
  seen_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_offer_views (offer_id, seen_at),
  CONSTRAINT fk_ov_offer    FOREIGN KEY (offer_id)    REFERENCES offers(id)    ON DELETE CASCADE,
  CONSTRAINT fk_ov_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- PCQ sharing settings — drive generator in services/configGenerator.js
-- ------------------------------------------------------------
INSERT INTO system_settings (setting_key, setting_value, value_type, description, is_secret) VALUES
  ('provisioning.pcq_enabled',         'true',            'boolean',
    'Include a PCQ (shared) queue tree in the generated .rsc so idle users'' bandwidth is shared fairly.', 0),
  ('provisioning.pcq_total_download',  '100',             'number',
    'Total download bandwidth (Mbps) available to all hotspot+PPPoE users combined.', 0),
  ('provisioning.pcq_total_upload',    '30',              'number',
    'Total upload bandwidth (Mbps) available to all users combined.', 0),
  ('provisioning.pcq_parent_download', 'global',          'string',
    'RouterOS parent for the downstream tree — "global" is the simplest and works everywhere.', 0),
  ('provisioning.pcq_parent_upload',   'global',          'string',
    'RouterOS parent for the upstream tree.', 0),
  ('provisioning.pcq_mode',            'per_user_equal',  'string',
    'How to share bandwidth: "per_user_equal" (pcq-rate=0 → evenly divided) or "per_package" (each package gets its own PCQ bucket).', 0),
  ('feature.offers_portal',            'true',            'boolean',
    'Show active offers on the public portal (banner + featured package).', 0)
ON DUPLICATE KEY UPDATE setting_key = setting_key;
