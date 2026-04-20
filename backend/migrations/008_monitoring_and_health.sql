-- ============================================================
-- Skynity ISP — Phase 10
--   * MikroTik router monitoring suite (CPU/RAM/temp history,
--     SFP Tx/Rx, queues, ping, neighbors, device info).
--   * System-wide health / issue detector ("events").
--   * i18n default language setting.
-- ============================================================

SET NAMES utf8mb4;
SET time_zone = '+06:00';

-- ----------- Router resource / health history ----------------
CREATE TABLE IF NOT EXISTS router_metrics (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  router_id   INT UNSIGNED NOT NULL,
  taken_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cpu_load    TINYINT  UNSIGNED NULL,         -- 0-100 %
  mem_used    BIGINT   UNSIGNED NULL,         -- bytes
  mem_total   BIGINT   UNSIGNED NULL,         -- bytes
  hdd_used    BIGINT   UNSIGNED NULL,
  hdd_total   BIGINT   UNSIGNED NULL,
  temperature DECIMAL(5,1) NULL,              -- °C
  voltage     DECIMAL(5,2) NULL,              -- V
  uptime_sec  BIGINT   UNSIGNED NULL,
  active_ppp  INT      UNSIGNED NULL,
  active_hs   INT      UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY idx_rm_router_time (router_id, taken_at),
  CONSTRAINT fk_rm_router FOREIGN KEY (router_id) REFERENCES mikrotik_routers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------- Per-interface bandwidth + SFP data --------------
CREATE TABLE IF NOT EXISTS router_interface_metrics (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  router_id       INT UNSIGNED NOT NULL,
  interface_name  VARCHAR(64) NOT NULL,
  taken_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rx_bps          BIGINT UNSIGNED NULL,
  tx_bps          BIGINT UNSIGNED NULL,
  rx_total        BIGINT UNSIGNED NULL,
  tx_total        BIGINT UNSIGNED NULL,
  link_ok         TINYINT(1) NULL,
  sfp_rx_power    DECIMAL(6,2) NULL,         -- dBm
  sfp_tx_power    DECIMAL(6,2) NULL,
  sfp_temp        DECIMAL(5,1) NULL,         -- °C
  sfp_wavelength  INT NULL,                  -- nm
  PRIMARY KEY (id),
  KEY idx_rim_router_iface_time (router_id, interface_name, taken_at),
  CONSTRAINT fk_rim_router FOREIGN KEY (router_id) REFERENCES mikrotik_routers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------- Ping / latency to admin-defined targets ---------
CREATE TABLE IF NOT EXISTS router_ping_targets (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  router_id   INT UNSIGNED NOT NULL,
  host        VARCHAR(100) NOT NULL,        -- IP or hostname
  label       VARCHAR(100) NULL,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ping_router_host (router_id, host),
  CONSTRAINT fk_pt_router FOREIGN KEY (router_id) REFERENCES mikrotik_routers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS router_ping_metrics (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  router_id      INT UNSIGNED NOT NULL,
  target_id      INT UNSIGNED NOT NULL,
  taken_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rtt_avg_ms     DECIMAL(7,2) NULL,
  rtt_min_ms     DECIMAL(7,2) NULL,
  rtt_max_ms     DECIMAL(7,2) NULL,
  packet_loss    TINYINT UNSIGNED NULL,       -- 0-100 %
  PRIMARY KEY (id),
  KEY idx_pm_target_time (target_id, taken_at),
  CONSTRAINT fk_pm_router FOREIGN KEY (router_id) REFERENCES mikrotik_routers(id) ON DELETE CASCADE,
  CONSTRAINT fk_pm_target FOREIGN KEY (target_id) REFERENCES router_ping_targets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------- Last-known neighbors (LLDP/CDP via /ip/neighbor) -
CREATE TABLE IF NOT EXISTS router_neighbors (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  router_id       INT UNSIGNED NOT NULL,
  mac_address     VARCHAR(17) NULL,
  identity        VARCHAR(128) NULL,
  platform        VARCHAR(64)  NULL,
  board           VARCHAR(64)  NULL,
  version         VARCHAR(64)  NULL,
  interface_name  VARCHAR(64)  NULL,
  address         VARCHAR(64)  NULL,
  age_seconds     INT UNSIGNED NULL,
  last_seen_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_n_router_mac (router_id, mac_address),
  CONSTRAINT fk_n_router FOREIGN KEY (router_id) REFERENCES mikrotik_routers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------- Router static info (refreshed daily) ------------
CREATE TABLE IF NOT EXISTS router_device_info (
  router_id         INT UNSIGNED NOT NULL,
  identity          VARCHAR(128) NULL,
  board_name        VARCHAR(128) NULL,
  model             VARCHAR(128) NULL,
  serial_number     VARCHAR(128) NULL,
  routeros_version  VARCHAR(64)  NULL,
  firmware_current  VARCHAR(64)  NULL,
  firmware_upgrade  VARCHAR(64)  NULL,
  license_level     VARCHAR(32)  NULL,
  architecture      VARCHAR(32)  NULL,
  last_checked_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (router_id),
  CONSTRAINT fk_di_router FOREIGN KEY (router_id) REFERENCES mikrotik_routers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------- System events / alerts --------------------------
-- The issue detector writes rows here; the UI lists them with
-- severity + a suggested fix. `code` is stable so we can resolve
-- the *same* event when the condition clears instead of spamming
-- a new row every 5 min.
CREATE TABLE IF NOT EXISTS system_events (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code         VARCHAR(64) NOT NULL,
  severity     ENUM('info','warning','error','critical') NOT NULL DEFAULT 'warning',
  source       VARCHAR(32) NOT NULL,          -- 'vps', 'router', 'security', 'payment', 'db', ...
  source_ref   VARCHAR(64) NULL,              -- e.g. router_id, admin_id, subscription_id
  title        VARCHAR(200) NOT NULL,
  message      TEXT NULL,
  suggestion   TEXT NULL,                     -- markdown-ish fix instructions
  meta         JSON NULL,
  first_seen   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  occurrences  INT UNSIGNED NOT NULL DEFAULT 1,
  resolved_at  DATETIME NULL,
  resolved_by  INT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_evt_code_ref_open (code, source_ref, resolved_at),
  KEY idx_evt_open (resolved_at, severity),
  CONSTRAINT fk_evt_admin FOREIGN KEY (resolved_by) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------- Settings ----------------------------------------
INSERT INTO system_settings (setting_key, setting_value, value_type, description, is_secret) VALUES
  ('site.default_language',    'bn',   'string',  'Default language for the public portal and admin UI (bn or en).', 0),
  ('site.available_languages', 'bn,en','string',  'Comma-separated list of enabled language codes.', 0),

  ('monitoring.enabled',       'true', 'boolean', 'Poll MikroTik routers for CPU/RAM/interface/ping metrics.', 0),
  ('monitoring.interval_min',  '5',    'number',  'Minutes between resource polls.', 0),
  ('monitoring.ping_default_targets', '8.8.8.8,1.1.1.1', 'string',
                                        'If a router has no custom ping targets, these hosts are pinged instead.', 0),
  ('monitoring.retention_days','30',   'number',  'How many days of monitoring history to keep.', 0),

  ('health.router_cpu_warn',   '75',   'number',  'CPU % threshold that opens a warning event.', 0),
  ('health.router_cpu_crit',   '90',   'number',  'CPU % threshold that opens a critical event.', 0),
  ('health.router_mem_warn',   '80',   'number',  'Memory-use % warning threshold.', 0),
  ('health.router_temp_warn',  '60',   'number',  'Router temperature °C warning threshold.', 0),
  ('health.router_temp_crit',  '75',   'number',  'Router temperature °C critical threshold.', 0),
  ('health.ping_loss_warn',    '20',   'number',  'Packet-loss %% warning threshold for ping targets.', 0),
  ('health.ping_rtt_warn',     '200',  'number',  'Ping RTT ms warning threshold.', 0),
  ('health.auth_fail_window',  '60',   'number',  'Failed-admin-login window in minutes.', 0),
  ('health.auth_fail_threshold','10',  'number',  'Failed logins within window that triggers an event.', 0)
ON DUPLICATE KEY UPDATE setting_key = setting_key;
