-- ============================================================
-- Skynity ISP — Phase 9
--   * Per-subscription bandwidth usage snapshots (for graphs)
--   * Admin-editable public-portal content
-- ============================================================

SET NAMES utf8mb4;
SET time_zone = '+06:00';

-- ----------- Usage snapshots -------------------------------
-- Every polling tick we INSERT a row per active subscription
-- with:
--   * `cum_in` / `cum_out`   — raw cumulative counters from
--     MikroTik for the *current* session. These reset to zero
--     whenever the user reconnects.
--   * `delta_in` / `delta_out` — bytes transferred since the
--     previous snapshot of the same subscription. If the
--     cumulative counter dropped (session reset) we write the
--     raw cumulative value so nothing is lost.
-- Aggregation is then just `SUM(delta_*) GROUP BY DATE(taken_at)`.
CREATE TABLE IF NOT EXISTS usage_snapshots (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  subscription_id INT UNSIGNED NOT NULL,
  router_id       INT UNSIGNED NULL,
  service_type    ENUM('hotspot','pppoe') NOT NULL,
  taken_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cum_in          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  cum_out         BIGINT UNSIGNED NOT NULL DEFAULT 0,
  delta_in        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  delta_out       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_snap_sub_time (subscription_id, taken_at),
  KEY idx_snap_day      (taken_at),
  CONSTRAINT fk_snap_sub    FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE,
  CONSTRAINT fk_snap_router FOREIGN KEY (router_id)       REFERENCES mikrotik_routers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Seed admin-editable public-portal content. Everything here is
-- rendered as plain text (with \n → <br>) to keep things safe
-- for non-technical admins editing from the Settings page.
-- ============================================================
INSERT INTO system_settings (setting_key, setting_value, value_type, description, is_secret) VALUES

-- ---------- About / marketing copy ----------
('portal.intro_title',
  'Premium internet, powered by Starlink 🛰️',
  'string',
  'Headline shown above the package list on /portal.', 0),

('portal.intro_html',
  'We run your connection over Starlink''s low-earth-orbit satellite network, so you get the fastest available speeds in the area — even where cable and fibre don''t reach. Every package includes our local WiFi, 24/7 uptime monitoring and quick support on WhatsApp.',
  'string',
  'Marketing paragraph under the headline. Plain text, line breaks OK.', 0),

-- ---------- Rules of use ----------
('portal.rules_html',
  '• One package = one device by default (ask for multi-device add-on if needed).\n• Please don''t share your username/password — sessions are locked to the device that first logs in.\n• Heavy torrenting or re-selling the connection is not allowed.\n• We reserve the right to suspend service if fair-use limits are abused.\n• Payments are non-refundable once a subscription is active.',
  'string',
  'Rules / warnings for users — shown as a bulleted list.', 0),

-- ---------- Quick user guide ----------
('portal.guide_html',
  '1) Choose a plan from this page and tap it.\n2) Enter your name + mobile number and confirm.\n3) Pay via bKash or Nagad (send money → enter transaction ID).\n4) Our admin approves the order — usually within a few minutes.\n5) You''ll get a username + password. Use them to log in from the WiFi page.\n6) Keep your order code safe — you''ll need it to renew or check status.',
  'string',
  'Six-step quick start guide shown on the portal.', 0),

-- ---------- Troubleshooting / support ----------
('portal.troubleshoot_html',
  'Not connecting? Try this in order:\n• Turn WiFi off on your phone, wait 5 seconds, turn it back on.\n• Forget the WiFi network, then rejoin it.\n• Reboot your phone / laptop.\n• Check that you''re typing the username/password exactly as sent (no spaces).\n• If a page won''t open, type 10.5.50.1 into your browser to re-open the login screen.\n• Still stuck? Tap the "Chat with support" button below — we usually reply within a few minutes.',
  'string',
  'Troubleshooting tips shown on the portal.', 0),

-- ---------- Support contacts ----------
('portal.support_whatsapp', '',   'string', 'Support WhatsApp number (international format, e.g. 8801XXXXXXXXX). Leave blank to hide.', 0),
('portal.support_telegram', '',   'string', 'Support Telegram username or link (e.g. @skynity or https://t.me/skynity).', 0),
('portal.support_messenger','',   'string', 'Support Facebook Messenger link (e.g. https://m.me/skynity).', 0),
('portal.support_email',    '',   'string', 'Support email address.', 0),
('portal.support_hours',    '24/7 support — we usually reply within a few minutes.', 'string',
                                  'Short line describing support availability.', 0),

-- Social / marketing
('portal.facebook_url',     '',   'string', 'Facebook page URL (shown on the portal footer). Leave blank to hide.', 0),
('portal.youtube_url',      '',   'string', 'YouTube channel URL.', 0),
('portal.website_url',      '',   'string', 'Company website URL (if different from this portal).', 0)

ON DUPLICATE KEY UPDATE setting_key = setting_key;
