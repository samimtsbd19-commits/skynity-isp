-- ============================================================
-- Skynity ISP — Phase 12
--   * User suspensions (temporary / permanent account disable)
--   * Per-subscription static public IP assignment (PPPoE)
--   * MikroTik CPU/load guard settings
-- ============================================================

SET NAMES utf8mb4;
SET time_zone = '+06:00';

-- ------------------------------------------------------------
-- customer_suspensions — one row per suspension incident.
--
-- A customer is "currently suspended" if they have a row here
-- with `lifted_at IS NULL` AND (`ends_at IS NULL` OR `ends_at > NOW()`).
-- Permanent bans use `ends_at = NULL` + `is_permanent = 1`.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_suspensions (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id    INT UNSIGNED NOT NULL,
  reason         VARCHAR(100) NOT NULL,
  notes          TEXT NULL,
  -- Null ends_at + is_permanent=1 = permanent ban
  starts_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ends_at        DATETIME NULL,
  is_permanent   TINYINT(1) NOT NULL DEFAULT 0,
  -- Admin who created/lifted the suspension
  created_by     INT UNSIGNED NULL,
  lifted_at      DATETIME NULL,
  lifted_by      INT UNSIGNED NULL,
  lift_reason    VARCHAR(200) NULL,
  -- Did we successfully disable the subs on MikroTik?
  mt_applied     TINYINT(1) NOT NULL DEFAULT 0,
  mt_error       TEXT NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sus_customer (customer_id, lifted_at),
  KEY idx_sus_ends     (ends_at, lifted_at),
  CONSTRAINT fk_sus_customer   FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  CONSTRAINT fk_sus_created_by FOREIGN KEY (created_by)  REFERENCES admins(id)    ON DELETE SET NULL,
  CONSTRAINT fk_sus_lifted_by  FOREIGN KEY (lifted_by)   REFERENCES admins(id)    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Track which subscriptions were auto-disabled by a suspension,
-- so we can restore their previous status on lift.
-- ------------------------------------------------------------
ALTER TABLE subscriptions
  ADD COLUMN suspension_id INT UNSIGNED NULL AFTER status,
  ADD COLUMN status_before_suspension
    ENUM('active','expired','suspended','cancelled') NULL
    AFTER suspension_id,
  ADD CONSTRAINT fk_sub_suspension
    FOREIGN KEY (suspension_id) REFERENCES customer_suspensions(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- Static public IP assignment for a subscription.
-- Only meaningful for PPPoE — hotspot uses DHCP from a pool.
-- When set, provisioning sets this as the PPP secret's
-- `remote-address` so MikroTik hands exactly this IP to the user.
-- ------------------------------------------------------------
ALTER TABLE subscriptions
  ADD COLUMN static_ip VARCHAR(45) NULL AFTER last_mac,
  ADD KEY idx_sub_static_ip (static_ip);

-- ------------------------------------------------------------
-- Settings — CPU / load guard + suspension defaults
-- ------------------------------------------------------------
INSERT INTO system_settings (setting_key, setting_value, value_type, description, is_secret) VALUES
  ('guard.cpu_warn',           '75',   'number',
    'Router CPU %% above which the monitor emits a warning.', 0),
  ('guard.cpu_crit',           '85',   'number',
    'Router CPU %% above which expensive polls (queues / SFP) are paused to relieve the router.', 0),
  ('guard.cpu_crit_minutes',   '15',   'number',
    'Sustained time (minutes) the CPU must stay above the critical threshold before the guard activates.', 0),
  ('guard.resume_cpu',         '65',   'number',
    'CPU %% below which the guard lifts and resumes full polling.', 0),
  ('guard.pause_queue_poll',   'true', 'boolean',
    'When the CPU guard activates, pause /queue/simple + /queue/tree polls.', 0),
  ('guard.pause_sfp_poll',     'true', 'boolean',
    'When the CPU guard activates, pause per-interface SFP monitor calls (they are the most expensive).', 0),

  ('suspension.default_reasons', 'Late payment,TOS violation,Abuse,Requested by customer', 'string',
    'Comma-separated list of reason choices shown in the suspension dialog.', 0),
  ('suspension.notify_customer', 'true', 'boolean',
    'Send the customer a notification when their account is suspended or restored.', 0),

  ('feature.static_ip',         'true', 'boolean',
    'Allow admins to assign a static public IP to a PPPoE subscription.', 0)
ON DUPLICATE KEY UPDATE setting_key = setting_key;

-- ------------------------------------------------------------
-- guard_state — the monitor writes here when the CPU guard
-- activates / lifts on a router. Used both to decide whether
-- to skip expensive polls and to drive the "router under
-- load" badge in the UI.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS router_guard_state (
  router_id     INT UNSIGNED NOT NULL,
  active        TINYINT(1)    NOT NULL DEFAULT 0,
  reason        VARCHAR(100)  NULL,
  since         DATETIME      NULL,
  lifted_at     DATETIME      NULL,
  last_cpu      TINYINT UNSIGNED NULL,
  high_ticks    INT UNSIGNED  NOT NULL DEFAULT 0,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (router_id),
  CONSTRAINT fk_guard_router FOREIGN KEY (router_id) REFERENCES mikrotik_routers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
