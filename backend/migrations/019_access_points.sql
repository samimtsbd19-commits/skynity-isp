-- ============================================================
-- 019: Access Point inventory (Cudy AX3000, etc)
-- ============================================================

CREATE TABLE IF NOT EXISTS access_points (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name             VARCHAR(100) NOT NULL,
  model            VARCHAR(60)  DEFAULT 'Cudy AX3000',
  mac_address      VARCHAR(17)  NULL,
  ip_address       VARCHAR(45)  NULL,
  location         VARCHAR(150) NULL,
  admin_url        VARCHAR(255) NULL,
  admin_username   VARCHAR(60)  NULL,
  admin_password   VARCHAR(255) NULL,
  router_id        INT UNSIGNED NULL,
  uplink_iface     VARCHAR(60)  NULL,
  status           ENUM('online','offline','unknown') NOT NULL DEFAULT 'unknown',
  last_seen_at     DATETIME     NULL,
  last_ping_ms     INT          NULL,
  firmware_version VARCHAR(60)  NULL,
  ssid_24          VARCHAR(80)  NULL,
  ssid_5           VARCHAR(80)  NULL,
  guest_enabled    TINYINT(1)   NOT NULL DEFAULT 0,
  client_count     INT          NOT NULL DEFAULT 0,
  notes            TEXT         NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_mac (mac_address),
  INDEX idx_status (status),
  INDEX idx_router (router_id),
  CONSTRAINT fk_ap_router FOREIGN KEY (router_id)
    REFERENCES mikrotik_routers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
