-- ============================================================
-- Skynity ISP — Phase 14
--   1. Per-subscription VPN tunnel routing (route a specific
--      customer / office PC through a WireGuard / L2TP tunnel).
--   2. Push notification tokens for the native mobile app.
-- ============================================================

SET NAMES utf8mb4;
SET time_zone = '+06:00';

-- ------------------------------------------------------------
-- subscriptions.tunnel_id  — when set, the subscription's traffic
-- is mark-routed via the referenced vpn_tunnel on MikroTik.
--
-- We also store the mt rule ids we created so we can clean up
-- without scanning the router each time.
-- ------------------------------------------------------------
ALTER TABLE subscriptions
  ADD COLUMN tunnel_id        INT UNSIGNED NULL        AFTER suspension_id,
  ADD COLUMN tunnel_mt_mangle VARCHAR(40)  NULL        AFTER tunnel_id,
  ADD COLUMN tunnel_mt_route  VARCHAR(40)  NULL        AFTER tunnel_mt_mangle,
  ADD CONSTRAINT fk_sub_tunnel
    FOREIGN KEY (tunnel_id) REFERENCES vpn_tunnels(id) ON DELETE SET NULL,
  ADD KEY idx_sub_tunnel (tunnel_id);

-- ------------------------------------------------------------
-- Client-side subnet + a routing-mark name we prefer on the
-- tunnel. If null, we derive one from the tunnel name.
-- ------------------------------------------------------------
ALTER TABLE vpn_tunnels
  ADD COLUMN routing_mark     VARCHAR(64)  NULL AFTER encryption,
  ADD COLUMN client_gateway   VARCHAR(45)  NULL AFTER routing_mark;

-- ------------------------------------------------------------
-- Mobile app push tokens.
-- Each row is one device × one platform (android / ios / web).
-- customer_id may be NULL if the user hasn't linked yet (the
-- device still registers on first launch so we can send
-- promotional pushes once they log in).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS push_tokens (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id     INT UNSIGNED NULL,
  account_id      INT UNSIGNED NULL,
  platform        ENUM('android','ios','web') NOT NULL,
  token           VARCHAR(512) NOT NULL,
  app_version     VARCHAR(32)  NULL,
  device_model    VARCHAR(64)  NULL,
  locale          VARCHAR(16)  NULL,
  last_seen_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  disabled        TINYINT(1)   NOT NULL DEFAULT 0,
  disabled_reason VARCHAR(100) NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_push_token (token),
  KEY idx_push_customer (customer_id),
  KEY idx_push_account  (account_id),
  CONSTRAINT fk_push_customer FOREIGN KEY (customer_id) REFERENCES customers(id)         ON DELETE SET NULL,
  CONSTRAINT fk_push_account  FOREIGN KEY (account_id)  REFERENCES customer_accounts(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Settings
-- ------------------------------------------------------------
INSERT INTO system_settings (setting_key, setting_value, value_type, description, is_secret) VALUES
  ('push.enabled',             'false', 'boolean',
    'Master switch for push notifications.', 0),
  ('push.fcm_server_key',      '', 'string',
    'Firebase Cloud Messaging legacy server key. Leave blank to disable FCM (Android + web push).', 1),
  ('push.fcm_project_id',      '', 'string',
    'Firebase project id (used for the mobile client; the backend only needs the server key).', 0)
ON DUPLICATE KEY UPDATE setting_key = setting_key;
