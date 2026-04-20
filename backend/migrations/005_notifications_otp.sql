-- ============================================================
-- Skynity ISP — Phase 7: Notifications + OTP login
-- ============================================================
--
-- 1. `customer_otps`    — short-lived OTP codes, used by the
--                         customer portal's "login via OTP" flow.
--                         One code per (phone, purpose) at a time.
--
-- 2. `notification_log` — every outbound message we send goes
--                         here (channel, provider, target, status,
--                         error). Gives admins an audit trail and
--                         lets us dedupe / rate-limit.
--
-- 3. A pile of `system_settings` rows for notification channels.
--    All of them default to OFF — the admin enables what they
--    actually use from the Settings → Notifications page.
--
--    Supported channels:
--      - telegram        (free, uses existing bot)
--      - whatsapp        (Meta Cloud API  OR  generic HTTP)
--      - sms             (pluggable provider — BulkSMSBD,
--                         SSLWireless, AlphaSMS, MIM SMS, or a
--                         fully-custom HTTP URL template)
-- ============================================================

SET NAMES utf8mb4;
SET time_zone = '+06:00';

-- ----------- OTP codes -----------------------------------
CREATE TABLE IF NOT EXISTS customer_otps (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  phone         VARCHAR(20)  NOT NULL,
  code          VARCHAR(10)  NOT NULL,
  channel       VARCHAR(24)  NOT NULL,              -- telegram | whatsapp | sms | manual
  purpose       VARCHAR(32)  NOT NULL DEFAULT 'login',
  attempts      TINYINT UNSIGNED NOT NULL DEFAULT 0, -- failed verify attempts
  expires_at    DATETIME     NOT NULL,
  used_at       DATETIME     NULL,
  ip_address    VARCHAR(64)  NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_otp_phone    (phone, purpose, created_at),
  KEY idx_otp_expires  (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------- Notification log ----------------------------
CREATE TABLE IF NOT EXISTS notification_log (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  channel       VARCHAR(24)  NOT NULL,  -- telegram | whatsapp | sms | email
  provider      VARCHAR(40)  NULL,      -- bulksmsbd | sslwireless | telegram_bot | ...
  target        VARCHAR(120) NOT NULL,  -- phone number or telegram_id
  purpose       VARCHAR(32)  NOT NULL,  -- otp | credentials | order_code | expiry | custom
  message       TEXT         NULL,
  status        ENUM('queued','sent','failed') NOT NULL DEFAULT 'queued',
  error         TEXT         NULL,
  meta          JSON         NULL,
  triggered_by  INT UNSIGNED NULL,      -- admin id if manual send
  related_order_id  INT UNSIGNED NULL,
  related_subscription_id INT UNSIGNED NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notify_target  (target, created_at),
  KEY idx_notify_channel (channel, status, created_at),
  CONSTRAINT fk_notify_admin FOREIGN KEY (triggered_by) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Settings: notification channels
-- ============================================================
INSERT INTO system_settings (setting_key, setting_value, value_type, description, is_secret) VALUES

-- ---------- Global flags ----------
('notify.otp.enabled',              'true',  'boolean', 'Allow customers to log into the portal with an OTP sent to their phone.', 0),
('notify.otp.ttl_seconds',          '300',   'number',  'How long a generated OTP stays valid, in seconds.',                         0),
('notify.otp.length',               '6',     'number',  'Length of the OTP code (4–8).',                                             0),
('notify.otp.max_attempts',         '5',     'number',  'Failed verify attempts per OTP before it is burned.',                       0),

-- ---------- Telegram ----------
('notify.telegram.enabled',         'true',  'boolean', 'Send notifications through the main Telegram bot (uses TELEGRAM_BOT_TOKEN).', 0),
('notify.telegram.prefer_for_otp',  'true',  'boolean', 'If the customer has a telegram_id, prefer Telegram over SMS for OTP.',       0),

-- ---------- WhatsApp (Meta Cloud API template) ----------
('notify.whatsapp.enabled',         'false', 'boolean', 'Send notifications over WhatsApp (Meta Cloud API).',                         0),
('notify.whatsapp.phone_number_id', '',      'string',  'WhatsApp Business phone number ID (Meta Cloud API).',                        0),
('notify.whatsapp.token',           '',      'string',  'Permanent access token for the WhatsApp Business app.',                      1),
('notify.whatsapp.template_name',   '',      'string',  'Approved template name to use for OTP messages (leave blank to use text).',  0),
('notify.whatsapp.language',        'en',    'string',  'Template language code (e.g. en, bn).',                                      0),

-- ---------- SMS (pluggable provider) ----------
('notify.sms.enabled',              'false', 'boolean', 'Send notifications over SMS.',                                               0),
('notify.sms.provider',             'custom','string',  'Which SMS gateway to use: bulksmsbd | sslwireless | alphasms | mimsms | custom.', 0),
('notify.sms.sender_id',            '',      'string',  'Brand / sender ID registered with your SMS provider.',                       0),

-- BulkSMSBD
('notify.sms.bulksmsbd.api_key',    '',      'string',  'BulkSMSBD API key.',                                                         1),
-- SSL Wireless
('notify.sms.sslwireless.api_token','',      'string',  'SSL Wireless API token.',                                                    1),
('notify.sms.sslwireless.sid',      '',      'string',  'SSL Wireless SID.',                                                          0),
-- Alpha SMS
('notify.sms.alphasms.api_key',     '',      'string',  'Alpha SMS API key.',                                                         1),
-- MIM SMS
('notify.sms.mimsms.api_key',       '',      'string',  'MIM SMS API key.',                                                           1),

-- Custom / generic HTTP gateway — admin provides URL template
('notify.sms.custom.url_template',  '',      'string',  'Full URL template for GET-based SMS gateways. Placeholders: {phone} {message} {sender}.', 0),
('notify.sms.custom.method',        'GET',   'string',  'HTTP method: GET or POST.',                                                  0),
('notify.sms.custom.success_regex', '',      'string',  'Optional regex that must match the response body for success.',              0)

ON DUPLICATE KEY UPDATE setting_key = setting_key;
