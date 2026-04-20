-- ============================================================
-- Skynity ISP — Database Schema v1
-- ============================================================
-- Philosophy:
--   - customers: people who buy internet
--   - packages: bandwidth + duration templates
--   - orders: a customer's purchase attempt
--   - payments: proof & confirmation of money received
--   - subscriptions: active recurring service
--   - mikrotik_routers: routers we manage (multi-tenant ready)
--   - admins: telegram admins / web-dashboard users
-- ============================================================

SET NAMES utf8mb4;
SET time_zone = '+06:00';

-- ----------- MikroTik Routers --------------------------------
CREATE TABLE IF NOT EXISTS mikrotik_routers (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name          VARCHAR(100) NOT NULL,
  host          VARCHAR(255) NOT NULL,
  port          INT NOT NULL DEFAULT 443,
  username      VARCHAR(100) NOT NULL,
  password_enc  TEXT NOT NULL,     -- encrypted
  use_ssl       TINYINT(1) NOT NULL DEFAULT 1,
  is_default    TINYINT(1) NOT NULL DEFAULT 0,
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  note          TEXT,
  last_seen_at  DATETIME NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_router_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------- Admins / Web dashboard users --------------------
CREATE TABLE IF NOT EXISTS admins (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username       VARCHAR(50) NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,
  full_name      VARCHAR(100) NOT NULL,
  telegram_id    VARCHAR(32) NULL,
  role           ENUM('superadmin','admin','reseller','viewer') NOT NULL DEFAULT 'admin',
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at  DATETIME NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admin_username (username),
  UNIQUE KEY uq_admin_telegram (telegram_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------- Packages ----------------------------------------
CREATE TABLE IF NOT EXISTS packages (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code           VARCHAR(50) NOT NULL,              -- e.g. PPPOE-5M-30D
  name           VARCHAR(100) NOT NULL,
  service_type   ENUM('hotspot','pppoe') NOT NULL,
  rate_up_mbps   DECIMAL(6,2) NOT NULL,
  rate_down_mbps DECIMAL(6,2) NOT NULL,
  duration_days  INT NOT NULL,
  price          DECIMAL(10,2) NOT NULL,
  mikrotik_profile VARCHAR(100) NOT NULL,           -- maps to /ppp profile or /ip hotspot user profile
  description    TEXT,
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  sort_order     INT NOT NULL DEFAULT 0,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_package_code (code),
  KEY idx_package_service (service_type, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------- Customers ---------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_code   VARCHAR(20) NOT NULL,            -- human friendly: SKY-0001
  full_name       VARCHAR(100) NOT NULL,
  phone           VARCHAR(20) NOT NULL,
  email           VARCHAR(100) NULL,
  address         VARCHAR(255) NULL,
  telegram_id     VARCHAR(32) NULL,
  telegram_username VARCHAR(64) NULL,
  status          ENUM('active','suspended','banned','pending') NOT NULL DEFAULT 'pending',
  note            TEXT,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_customer_code (customer_code),
  UNIQUE KEY uq_customer_phone (phone),
  UNIQUE KEY uq_customer_telegram (telegram_id),
  KEY idx_customer_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------- Subscriptions (active service) ------------------
CREATE TABLE IF NOT EXISTS subscriptions (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id     INT UNSIGNED NOT NULL,
  package_id      INT UNSIGNED NOT NULL,
  router_id       INT UNSIGNED NOT NULL,
  service_type    ENUM('hotspot','pppoe') NOT NULL,
  -- Login credentials on MikroTik
  login_username  VARCHAR(64) NOT NULL,
  login_password  VARCHAR(64) NOT NULL,
  -- Lifecycle
  starts_at       DATETIME NOT NULL,
  expires_at      DATETIME NOT NULL,
  status          ENUM('active','expired','suspended','cancelled') NOT NULL DEFAULT 'active',
  -- MikroTik sync state
  mt_synced       TINYINT(1) NOT NULL DEFAULT 0,
  mt_last_sync_at DATETIME NULL,
  mt_error        TEXT NULL,
  -- Usage tracking (refreshed by monitoring job)
  last_seen_at    DATETIME NULL,
  last_ip         VARCHAR(45) NULL,
  last_mac        VARCHAR(17) NULL,
  bytes_in        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  bytes_out       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sub_customer (customer_id),
  KEY idx_sub_status (status, expires_at),
  KEY idx_sub_login (login_username, service_type),
  CONSTRAINT fk_sub_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  CONSTRAINT fk_sub_package FOREIGN KEY (package_id) REFERENCES packages(id),
  CONSTRAINT fk_sub_router FOREIGN KEY (router_id) REFERENCES mikrotik_routers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------- Orders ------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_code      VARCHAR(20) NOT NULL,             -- ORD-20260419-0001
  customer_id     INT UNSIGNED NULL,                -- null until customer record created
  package_id      INT UNSIGNED NOT NULL,
  -- snapshot of submitted form (in case customer deleted)
  full_name       VARCHAR(100) NOT NULL,
  phone           VARCHAR(20) NOT NULL,
  telegram_id     VARCHAR(32) NULL,
  amount          DECIMAL(10,2) NOT NULL,
  status          ENUM('pending_payment','payment_submitted','approved','rejected','expired','cancelled')
                    NOT NULL DEFAULT 'pending_payment',
  -- admin workflow
  approved_by     INT UNSIGNED NULL,                 -- admins.id
  approved_at     DATETIME NULL,
  rejected_reason TEXT NULL,
  -- subscription created after approval
  subscription_id INT UNSIGNED NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_order_code (order_code),
  KEY idx_order_customer (customer_id),
  KEY idx_order_status (status, created_at),
  CONSTRAINT fk_order_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  CONSTRAINT fk_order_package FOREIGN KEY (package_id) REFERENCES packages(id),
  CONSTRAINT fk_order_approver FOREIGN KEY (approved_by) REFERENCES admins(id) ON DELETE SET NULL,
  CONSTRAINT fk_order_subscription FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------- Payments ----------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id        INT UNSIGNED NOT NULL,
  method          ENUM('bkash','nagad','rocket','bank','cash','other') NOT NULL,
  sender_number   VARCHAR(20) NULL,
  trx_id          VARCHAR(50) NULL,
  amount          DECIMAL(10,2) NOT NULL,
  screenshot_path VARCHAR(500) NULL,               -- uploaded proof image
  status          ENUM('pending','verified','rejected') NOT NULL DEFAULT 'pending',
  verified_by     INT UNSIGNED NULL,
  verified_at     DATETIME NULL,
  reject_reason   TEXT NULL,
  note            TEXT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_payment_order (order_id),
  KEY idx_payment_trx (trx_id),
  KEY idx_payment_status (status, created_at),
  CONSTRAINT fk_payment_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_payment_verifier FOREIGN KEY (verified_by) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------- Audit / activity log ----------------------------
CREATE TABLE IF NOT EXISTS activity_log (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_type    ENUM('system','admin','customer','bot','cron') NOT NULL,
  actor_id      VARCHAR(64) NULL,
  action        VARCHAR(100) NOT NULL,
  entity_type   VARCHAR(50) NULL,
  entity_id     VARCHAR(64) NULL,
  meta          JSON NULL,
  ip_address    VARCHAR(45) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_log_entity (entity_type, entity_id),
  KEY idx_log_actor (actor_type, actor_id),
  KEY idx_log_action (action, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------- Telegram Bot state cache ------------------------
-- Stores multi-step conversation state per user
CREATE TABLE IF NOT EXISTS bot_sessions (
  telegram_id   VARCHAR(32) NOT NULL,
  state         VARCHAR(50) NOT NULL,
  data          JSON NULL,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (telegram_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------- Seed data ---------------------------------------
-- NOTE: No seed for `mikrotik_routers` or `packages` on purpose.
-- Admins add their real router and packages from the dashboard
-- after first login. Keeps production deployments clean.
