-- ============================================================
-- Skynity ISP — Phase 11
--   * Router queue history (Simple + Tree queues).
--     RouterOS exposes per-queue byte & packet counters; we
--     sample them on the monitoring tick and store deltas so
--     admins can see "how much traffic went through queue X in
--     the last 24 hours".
--   * System setting to throttle the expensive /queue/tree poll.
-- ============================================================

SET NAMES utf8mb4;
SET time_zone = '+06:00';

-- ------------------------------------------------------------
-- router_queue_metrics — one row per router / queue / tick.
-- `kind` distinguishes simple queues from queue tree nodes.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS router_queue_metrics (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  router_id   INT UNSIGNED    NOT NULL,
  kind        ENUM('simple','tree') NOT NULL DEFAULT 'simple',
  queue_name  VARCHAR(128)    NOT NULL,
  target      VARCHAR(255)    NULL,            -- simple queue "target" (IP/iface)
  parent      VARCHAR(128)    NULL,            -- queue tree parent
  taken_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rx_bps      BIGINT UNSIGNED NULL,            -- bits/sec (download, from target)
  tx_bps      BIGINT UNSIGNED NULL,            -- bits/sec (upload, to target)
  rx_bytes    BIGINT UNSIGNED NULL,            -- cumulative bytes
  tx_bytes    BIGINT UNSIGNED NULL,
  packets_in  BIGINT UNSIGNED NULL,
  packets_out BIGINT UNSIGNED NULL,
  dropped_in  BIGINT UNSIGNED NULL,
  dropped_out BIGINT UNSIGNED NULL,
  disabled    TINYINT(1)      NULL,
  PRIMARY KEY (id),
  KEY idx_rq_router_queue_time (router_id, queue_name, taken_at),
  CONSTRAINT fk_rq_router FOREIGN KEY (router_id) REFERENCES mikrotik_routers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Settings
-- ------------------------------------------------------------
INSERT INTO system_settings (setting_key, setting_value, value_type, description, is_secret) VALUES
  ('monitoring.queue_poll_enabled', 'true', 'boolean',
    'Sample /queue/simple and /queue/tree counters during the monitoring tick.', 0),
  ('monitoring.queue_poll_limit', '50', 'number',
    'Maximum number of queues per router to record each tick (top-N by traffic). Keeps the table lean on busy routers.', 0),
  ('monitoring.queue_retention_days', '14', 'number',
    'How many days of queue counter history to retain.', 0)
ON DUPLICATE KEY UPDATE setting_key = setting_key;
