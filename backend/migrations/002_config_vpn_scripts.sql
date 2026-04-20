-- ============================================================
-- Skynity ISP — Phase 4: Config files, VPN tunnels, Scripts,
-- Updates, System settings
-- ============================================================

SET NAMES utf8mb4;
SET time_zone = '+06:00';

-- ----------- Config Files (stored on VPS) --------------------
-- A config file is a MikroTik .rsc / .backup / .conf artifact
-- uploaded to the VPS. Admins can download it, or push it to
-- a specific router via the REST API (/file + /import).
CREATE TABLE IF NOT EXISTS config_files (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name           VARCHAR(150) NOT NULL,
  description    TEXT NULL,
  file_type      ENUM('rsc','backup','conf','script','other') NOT NULL DEFAULT 'rsc',
  file_path      VARCHAR(500) NOT NULL,          -- path on VPS disk
  file_size      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  checksum_sha256 CHAR(64) NULL,
  uploaded_by    INT UNSIGNED NULL,
  tags           VARCHAR(255) NULL,
  is_public      TINYINT(1) NOT NULL DEFAULT 0,  -- if 1, downloadable without auth (via signed URL)
  download_token VARCHAR(80) NULL,                -- optional share token
  download_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_cfg_type (file_type),
  KEY idx_cfg_token (download_token),
  CONSTRAINT fk_cfg_uploader FOREIGN KEY (uploaded_by) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------- Config push history -----------------------------
CREATE TABLE IF NOT EXISTS config_pushes (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  config_id      INT UNSIGNED NOT NULL,
  router_id      INT UNSIGNED NOT NULL,
  pushed_by      INT UNSIGNED NULL,
  status         ENUM('pending','uploading','importing','success','failed') NOT NULL DEFAULT 'pending',
  remote_path    VARCHAR(255) NULL,              -- path on router
  log_output     TEXT NULL,
  error_message  TEXT NULL,
  started_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at    DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_push_config (config_id),
  KEY idx_push_router (router_id),
  KEY idx_push_status (status, started_at),
  CONSTRAINT fk_push_config FOREIGN KEY (config_id) REFERENCES config_files(id) ON DELETE CASCADE,
  CONSTRAINT fk_push_router FOREIGN KEY (router_id) REFERENCES mikrotik_routers(id) ON DELETE CASCADE,
  CONSTRAINT fk_push_admin  FOREIGN KEY (pushed_by) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------- VPN Tunnels -------------------------------------
-- Unified registry for VPN tunnels: WireGuard, IPsec, PPTP,
-- L2TP, OpenVPN, SSTP. The "kind" column discriminates.
CREATE TABLE IF NOT EXISTS vpn_tunnels (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  router_id      INT UNSIGNED NOT NULL,
  kind           ENUM('wireguard','ipsec','pptp','l2tp','ovpn','sstp') NOT NULL,
  name           VARCHAR(100) NOT NULL,
  is_enabled     TINYINT(1) NOT NULL DEFAULT 1,
  listen_port    INT NULL,
  local_address  VARCHAR(64) NULL,                -- local tunnel IP (CIDR or plain)
  remote_address VARCHAR(128) NULL,               -- peer endpoint host:port
  -- WireGuard
  public_key     VARCHAR(255) NULL,
  private_key_enc TEXT NULL,                      -- encrypted
  preshared_key_enc TEXT NULL,                    -- encrypted
  allowed_ips    VARCHAR(255) NULL,
  persistent_keepalive INT NULL,
  mtu            INT NULL,
  -- IPsec/PPTP/L2TP
  secret_enc     TEXT NULL,                       -- encrypted
  auth_method    VARCHAR(50) NULL,                -- psk/cert/xauth
  dh_group       VARCHAR(50) NULL,
  encryption     VARCHAR(50) NULL,
  -- Status
  mt_id          VARCHAR(32) NULL,                -- MikroTik .id after provisioning
  mt_synced      TINYINT(1) NOT NULL DEFAULT 0,
  mt_last_sync_at DATETIME NULL,
  mt_error       TEXT NULL,
  last_handshake_at DATETIME NULL,
  rx_bytes       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  tx_bytes       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  note           TEXT NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tunnel_name (router_id, kind, name),
  KEY idx_tunnel_kind (kind, is_enabled),
  CONSTRAINT fk_tunnel_router FOREIGN KEY (router_id) REFERENCES mikrotik_routers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------- VPN Peers ---------------------------------------
-- For WireGuard interfaces: individual peer clients
CREATE TABLE IF NOT EXISTS vpn_peers (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tunnel_id      INT UNSIGNED NOT NULL,
  name           VARCHAR(100) NOT NULL,
  customer_id    INT UNSIGNED NULL,
  public_key     VARCHAR(255) NULL,
  private_key_enc TEXT NULL,
  preshared_key_enc TEXT NULL,
  endpoint       VARCHAR(128) NULL,
  allowed_address VARCHAR(255) NULL,
  persistent_keepalive INT NULL,
  is_enabled     TINYINT(1) NOT NULL DEFAULT 1,
  mt_id          VARCHAR(32) NULL,
  mt_synced      TINYINT(1) NOT NULL DEFAULT 0,
  mt_error       TEXT NULL,
  last_handshake_at DATETIME NULL,
  rx_bytes       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  tx_bytes       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  qr_cached      MEDIUMTEXT NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_peer (tunnel_id, name),
  KEY idx_peer_customer (customer_id),
  CONSTRAINT fk_peer_tunnel FOREIGN KEY (tunnel_id) REFERENCES vpn_tunnels(id) ON DELETE CASCADE,
  CONSTRAINT fk_peer_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------- Router Scripts ----------------------------------
-- Reusable scripts that can be pushed to /system/script and
-- executed on demand or on a schedule.
CREATE TABLE IF NOT EXISTS router_scripts (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name           VARCHAR(150) NOT NULL,
  description    TEXT NULL,
  source         MEDIUMTEXT NOT NULL,            -- the RouterOS script
  policy         VARCHAR(100) NOT NULL DEFAULT 'read,write,policy,test',
  tags           VARCHAR(255) NULL,
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  created_by     INT UNSIGNED NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_script_name (name),
  CONSTRAINT fk_script_admin FOREIGN KEY (created_by) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------- Script executions -------------------------------
CREATE TABLE IF NOT EXISTS script_executions (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  script_id      INT UNSIGNED NULL,
  router_id      INT UNSIGNED NOT NULL,
  executed_by    INT UNSIGNED NULL,
  status         ENUM('queued','running','success','failed') NOT NULL DEFAULT 'queued',
  source_preview VARCHAR(500) NULL,
  output         MEDIUMTEXT NULL,
  error_message  TEXT NULL,
  started_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at    DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_exec_router (router_id, started_at),
  KEY idx_exec_status (status),
  CONSTRAINT fk_exec_script FOREIGN KEY (script_id) REFERENCES router_scripts(id) ON DELETE SET NULL,
  CONSTRAINT fk_exec_router FOREIGN KEY (router_id) REFERENCES mikrotik_routers(id) ON DELETE CASCADE,
  CONSTRAINT fk_exec_admin  FOREIGN KEY (executed_by) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------- Update tasks (RouterOS / packages) --------------
CREATE TABLE IF NOT EXISTS update_tasks (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  router_id      INT UNSIGNED NOT NULL,
  action         ENUM('check','download','install','reboot','package_install','package_uninstall') NOT NULL,
  channel        ENUM('stable','long-term','testing','development') NULL,
  package_name   VARCHAR(100) NULL,
  installed_version VARCHAR(50) NULL,
  latest_version VARCHAR(50) NULL,
  status         ENUM('queued','running','success','failed') NOT NULL DEFAULT 'queued',
  output         TEXT NULL,
  error_message  TEXT NULL,
  requested_by   INT UNSIGNED NULL,
  started_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at    DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_update_router (router_id, started_at),
  CONSTRAINT fk_update_router FOREIGN KEY (router_id) REFERENCES mikrotik_routers(id) ON DELETE CASCADE,
  CONSTRAINT fk_update_admin  FOREIGN KEY (requested_by) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------- System settings (admin-panel tunables) ----------
CREATE TABLE IF NOT EXISTS system_settings (
  setting_key    VARCHAR(100) NOT NULL,
  setting_value  TEXT NULL,
  value_type     ENUM('string','number','boolean','json') NOT NULL DEFAULT 'string',
  description    VARCHAR(255) NULL,
  is_secret      TINYINT(1) NOT NULL DEFAULT 0,
  updated_by     INT UNSIGNED NULL,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key),
  CONSTRAINT fk_setting_admin FOREIGN KEY (updated_by) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------- Seed default settings ---------------------------
INSERT INTO system_settings (setting_key, setting_value, value_type, description, is_secret) VALUES
('site.name',          'Skynity ISP',                   'string', 'Brand name shown in UI',                 0),
('site.support_phone', '',                              'string', 'Support phone number displayed in UI',   0),
('site.support_email', '',                              'string', 'Support email displayed in UI',          0),
('site.timezone',      'Asia/Dhaka',                    'string', 'Default timezone',                       0),
('site.currency',      'BDT',                           'string', 'ISO currency code',                      0),
('site.currency_symbol','৳',                            'string', 'Currency symbol',                        0),
('provisioning.auto_approve', 'false',                  'boolean','Auto-approve verified payments',         0),
('provisioning.default_router_id','',                   'string', 'Default router id for new orders',       0),
('telegram.notify_admins', 'true',                      'boolean','Send Telegram alerts to admins',         0),
('security.session_timeout_minutes','10080',            'number', 'JWT session lifetime in minutes (7 days)',0),
('security.max_login_attempts','5',                     'number', 'Max failed logins per hour',             0),
('vpn.wireguard_default_port','51820',                  'number', 'Default WireGuard listen port',          0),
('vpn.wireguard_default_subnet','10.88.0.0/24',         'string', 'Default WG peer subnet',                 0),
('updates.auto_check_hours','24',                       'number', 'Hours between RouterOS update checks',   0),
('branding.primary_color','#f59e0b',                    'string', 'UI accent colour',                       0),
('branding.logo_url',    '',                            'string', 'Optional external logo URL',             0)
ON DUPLICATE KEY UPDATE setting_key = setting_key;
