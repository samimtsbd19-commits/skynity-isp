-- ============================================================
-- Skynity ISP — Phase 8
--   * Customer self-service accounts (signup → admin approve → login)
--   * Free trial tracking (1 phone, once)
--   * Expiry-reminder bookkeeping on subscriptions
--   * Feature flags + related settings
-- ============================================================

SET NAMES utf8mb4;
SET time_zone = '+06:00';

-- ----------- Customer accounts -----------------------------
-- A customer dashboard account. Logically 1-to-1 with a
-- `customers` row (same phone), but we keep them separate so
-- anonymous "walk-in" customers (created from an order without
-- ever registering online) don't need a password.
CREATE TABLE IF NOT EXISTS customer_accounts (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id    INT UNSIGNED NULL,              -- set when linked / approved
  full_name      VARCHAR(100) NOT NULL,
  phone          VARCHAR(20)  NOT NULL,
  email          VARCHAR(100) NULL,
  password_hash  VARCHAR(255) NOT NULL,
  status         ENUM('pending','approved','rejected','suspended') NOT NULL DEFAULT 'pending',
  approved_at    DATETIME NULL,
  approved_by    INT UNSIGNED NULL,
  last_login_at  DATETIME NULL,
  reject_reason  VARCHAR(255) NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_acc_phone (phone),
  KEY idx_acc_status (status),
  CONSTRAINT fk_acc_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  CONSTRAINT fk_acc_admin    FOREIGN KEY (approved_by) REFERENCES admins(id)    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------- Free-trial phone list -------------------------
-- One row per phone that has ever used the free-trial. Using
-- a table (instead of a flag on `customers`) means a phone can
-- be blocked from trying again even if we delete the customer.
CREATE TABLE IF NOT EXISTS trial_used_phones (
  phone            VARCHAR(20) NOT NULL,
  customer_id      INT UNSIGNED NULL,
  subscription_id  INT UNSIGNED NULL,
  ip_address       VARCHAR(64)  NULL,
  mac_address      VARCHAR(17)  NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (phone),
  KEY idx_trial_customer (customer_id),
  CONSTRAINT fk_trial_customer     FOREIGN KEY (customer_id)     REFERENCES customers(id)     ON DELETE SET NULL,
  CONSTRAINT fk_trial_subscription FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------- Expiry reminder bookkeeping -------------------
-- `last_expiry_notified_days` records which "days-before" step
-- we most recently sent a reminder for, so we never send the
-- same reminder twice. 3 → 1 → 0 over the lifetime of a sub.
ALTER TABLE subscriptions
  ADD COLUMN last_expiry_notified_days INT NULL AFTER last_seen_at,
  ADD COLUMN last_expiry_notified_at   DATETIME NULL AFTER last_expiry_notified_days;

-- ============================================================
-- Seed settings: feature flags + trial + expiry + lb
-- ============================================================
INSERT INTO system_settings (setting_key, setting_value, value_type, description, is_secret) VALUES

-- ---------- Feature flags (everything toggleable) ----------
('feature.otp_login',             'true',  'boolean', 'Show the OTP login tab on the customer portal.', 0),
('feature.free_trial',            'false', 'boolean', 'Allow first-time phones to claim a free trial package.', 0),
('feature.customer_accounts',     'true',  'boolean', 'Allow customers to sign up for a dashboard account (admin must approve).', 0),
('feature.expiry_reminders',      'true',  'boolean', 'Automatically remind customers before their subscription expires.', 0),
('feature.load_balance_routers',  'false', 'boolean', 'When multiple routers are active, pick the one with the fewest active subscriptions.', 0),
('feature.vouchers_portal',       'true',  'boolean', 'Show the "Redeem voucher" button on the public portal.', 0),
('feature.renewal_portal',        'true',  'boolean', 'Let customers self-renew from the returning-customer page.', 0),
('feature.public_mac_order',      'true',  'boolean', 'Capture the MAC address from the captive portal when placing an order.', 0),
('feature.pwa_install',           'true',  'boolean', 'Expose the "Install app" button on the public portal.', 0),
('feature.show_download_button',  'true',  'boolean', 'Show the "Download mobile app" button on the public portal landing.', 0),

-- ---------- Expiry reminders ----------
('notify.expiry.enabled',         'true',  'boolean', 'Send expiry reminders (uses the configured notification channels).', 0),
('notify.expiry.days_before',     '3,1,0', 'string',  'Days-before-expiry to remind, comma-separated. 0 = day-of.', 0),

-- ---------- Trial ----------
('trial.duration_days',           '7',     'number',  'How many days a free-trial subscription lasts.',                    0),
('trial.package_code',            '',      'string',  'Package code used for free-trial subscriptions (must be an active package).', 0),
('trial.require_mac',             'true',  'boolean', 'Only allow trial activation when a MAC address is provided (from the captive portal).', 0),

-- ---------- Load balancing ----------
('provisioning.load_balance',     'false', 'boolean', 'Pick the router with fewest active subs for each new customer.', 0),

-- ---------- Mobile app download targets ----------
('site.app_android_url',          '',      'string',  'Direct link to the Android APK or Play Store page.',  0),
('site.app_ios_url',              '',      'string',  'Direct link to the iOS App Store page.',              0)

ON DUPLICATE KEY UPDATE setting_key = setting_key;
