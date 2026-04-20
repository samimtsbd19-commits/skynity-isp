-- ============================================================
-- Skynity ISP — Phase 5: Vouchers (prepaid codes) + branding
-- ============================================================
--
-- Why vouchers?
--   For ISP shops/cafes: admin prints a stack of unique codes,
--   hands them over at the counter, customer types the code on
--   /portal/redeem and gets WiFi credentials instantly — no
--   bKash/Nagad flow needed.
--
-- Why a branding / invoicing pair of tables?
--   ISPMan-style portals expect the ISP's logo + accent colour
--   on every user-facing page, and every paid order to produce
--   a downloadable invoice. We already store arbitrary settings
--   in `system_settings`, so we just seed the right keys here.
-- ============================================================

SET NAMES utf8mb4;
SET time_zone = '+06:00';

-- ----------- Vouchers ----------------------------------------
CREATE TABLE IF NOT EXISTS vouchers (
  id                       INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code                     VARCHAR(40) NOT NULL,
  package_id               INT UNSIGNED NOT NULL,
  batch_id                 VARCHAR(40) NULL,              -- group codes printed together
  is_redeemed              TINYINT(1) NOT NULL DEFAULT 0,
  redeemed_by_customer_id  INT UNSIGNED NULL,
  redeemed_by_subscription_id INT UNSIGNED NULL,
  redeemed_at              DATETIME NULL,
  redeemed_by_phone        VARCHAR(20) NULL,               -- phone at redemption time (may be new customer)
  expires_at               DATETIME NULL,                  -- voucher validity window (nullable = forever)
  created_by               INT UNSIGNED NULL,
  note                     TEXT NULL,
  created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_voucher_code (code),
  KEY idx_voucher_batch (batch_id),
  KEY idx_voucher_state (is_redeemed, expires_at),
  CONSTRAINT fk_voucher_package      FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE CASCADE,
  CONSTRAINT fk_voucher_customer     FOREIGN KEY (redeemed_by_customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  CONSTRAINT fk_voucher_subscription FOREIGN KEY (redeemed_by_subscription_id) REFERENCES subscriptions(id) ON DELETE SET NULL,
  CONSTRAINT fk_voucher_admin        FOREIGN KEY (created_by) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------- Voucher batch registry --------------------------
-- A lightweight table so we can label / delete entire batches.
CREATE TABLE IF NOT EXISTS voucher_batches (
  id          VARCHAR(40) NOT NULL,          -- matches vouchers.batch_id
  name        VARCHAR(120) NOT NULL,
  package_id  INT UNSIGNED NOT NULL,
  count       INT UNSIGNED NOT NULL,
  expires_at  DATETIME NULL,
  created_by  INT UNSIGNED NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_vbatch_package (package_id),
  CONSTRAINT fk_vbatch_package FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE CASCADE,
  CONSTRAINT fk_vbatch_admin   FOREIGN KEY (created_by) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------- Branding defaults -------------------------------
-- These live in the existing system_settings table; we just
-- seed the keys so the UI has something to render.
INSERT INTO system_settings (setting_key, setting_value, value_type, description, is_secret) VALUES
('site.public_base_url',     '', 'string', 'Public URL of the portal (e.g. https://wifi.skynity.org). Used on the captive portal / vouchers / invoices.', 0),
('branding.logo_url',        '',        'string', 'Public logo URL (shown on /portal and MikroTik login page)',        0),
('branding.primary_color',   '#f59e0b', 'string', 'Accent colour used across admin + portal',                            0),
('branding.tagline',         'Fast, simple WiFi access.', 'string', 'One-liner shown under the logo on the public portal', 0),
('payment.bkash_number',     '',        'string', 'Public bKash number for customer payments',                            0),
('payment.bkash_type',       'personal','string', 'Personal / Merchant',                                                  0),
('payment.nagad_number',     '',        'string', 'Public Nagad number for customer payments',                            0),
('payment.nagad_type',       'personal','string', 'Personal / Merchant',                                                  0),
('invoice.company_name',     'Skynity ISP', 'string', 'Company name printed on invoices',                                  0),
('invoice.company_address',  '',        'string', 'Address printed on invoices',                                           0),
('invoice.company_vat',      '',        'string', 'VAT / BIN number printed on invoices',                                  0),
('invoice.footer_note',      'Thank you for choosing us!', 'string', 'Footer line on invoices',                            0)
ON DUPLICATE KEY UPDATE setting_key = setting_key;
