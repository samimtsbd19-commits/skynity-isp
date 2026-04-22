-- ============================================================
-- 020: FreeRADIUS AAA integration
-- ------------------------------------------------------------
-- Adds the canonical FreeRADIUS 3.x MySQL schema (radcheck,
-- radreply, radgroupcheck, radgroupreply, radusergroup, radacct,
-- radpostauth, nas) alongside Skynity's own tables so a single
-- MySQL instance backs both.
--
-- Also adds:
--   * packages.radius_group          — maps each package to a
--                                      RADIUS group (bandwidth
--                                      profile, pool, etc.)
--   * mikrotik_routers.radius_secret — per-router shared secret
--   * mikrotik_routers.radius_nas_ip — IP the NAS uses as source
--                                      when talking to RADIUS
--   * mikrotik_routers.radius_nas_shortname — human identifier
--   * subscriptions.radius_synced    — last sync state
--   * subscriptions.radius_last_sync_at / radius_error
--   * radius_sync_log                — audit trail of every push
--   * radius_disconnect_queue        — CoA/PoD jobs waiting to
--                                      fire (so a user whose
--                                      plan was suspended at
--                                      10:00 is actually kicked
--                                      even if the MikroTik was
--                                      briefly unreachable).
-- ============================================================

SET NAMES utf8mb4;

-- ------------------------------------------------------------
-- Core FreeRADIUS tables (schema.sql from freeradius-server 3.2)
-- Indexed on username(32) to keep InnoDB key size sane.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS radcheck (
  id          INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  username    VARCHAR(64) NOT NULL DEFAULT '',
  attribute   VARCHAR(64) NOT NULL DEFAULT '',
  op          CHAR(2)     NOT NULL DEFAULT '==',
  value       VARCHAR(253) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  KEY idx_radcheck_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS radreply (
  id          INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  username    VARCHAR(64) NOT NULL DEFAULT '',
  attribute   VARCHAR(64) NOT NULL DEFAULT '',
  op          CHAR(2)     NOT NULL DEFAULT '=',
  value       VARCHAR(253) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  KEY idx_radreply_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS radgroupcheck (
  id          INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  groupname   VARCHAR(64) NOT NULL DEFAULT '',
  attribute   VARCHAR(64) NOT NULL DEFAULT '',
  op          CHAR(2)     NOT NULL DEFAULT '==',
  value       VARCHAR(253) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  KEY idx_radgroupcheck_groupname (groupname)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS radgroupreply (
  id          INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  groupname   VARCHAR(64) NOT NULL DEFAULT '',
  attribute   VARCHAR(64) NOT NULL DEFAULT '',
  op          CHAR(2)     NOT NULL DEFAULT '=',
  value       VARCHAR(253) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  KEY idx_radgroupreply_groupname (groupname)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS radusergroup (
  id          INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
  username    VARCHAR(64) NOT NULL DEFAULT '',
  groupname   VARCHAR(64) NOT NULL DEFAULT '',
  priority    INT(11) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  KEY idx_radusergroup_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS radacct (
  radacctid           BIGINT(21) NOT NULL AUTO_INCREMENT,
  acctsessionid       VARCHAR(64) NOT NULL DEFAULT '',
  acctuniqueid        VARCHAR(32) NOT NULL DEFAULT '',
  username            VARCHAR(64) NOT NULL DEFAULT '',
  realm               VARCHAR(64) DEFAULT '',
  nasipaddress        VARCHAR(15) NOT NULL DEFAULT '',
  nasportid           VARCHAR(32) DEFAULT NULL,
  nasporttype         VARCHAR(32) DEFAULT NULL,
  acctstarttime       DATETIME NULL DEFAULT NULL,
  acctupdatetime      DATETIME NULL DEFAULT NULL,
  acctstoptime        DATETIME NULL DEFAULT NULL,
  acctinterval        INT(12) DEFAULT NULL,
  acctsessiontime     INT(12) UNSIGNED DEFAULT NULL,
  acctauthentic       VARCHAR(32) DEFAULT NULL,
  connectinfo_start   VARCHAR(50) DEFAULT NULL,
  connectinfo_stop    VARCHAR(50) DEFAULT NULL,
  acctinputoctets     BIGINT(20) DEFAULT NULL,
  acctoutputoctets    BIGINT(20) DEFAULT NULL,
  calledstationid     VARCHAR(50) NOT NULL DEFAULT '',
  callingstationid    VARCHAR(50) NOT NULL DEFAULT '',
  acctterminatecause  VARCHAR(32) NOT NULL DEFAULT '',
  servicetype         VARCHAR(32) DEFAULT NULL,
  framedprotocol      VARCHAR(32) DEFAULT NULL,
  framedipaddress     VARCHAR(15) NOT NULL DEFAULT '',
  framedipv6address   VARCHAR(45) NOT NULL DEFAULT '',
  framedipv6prefix    VARCHAR(45) NOT NULL DEFAULT '',
  framedinterfaceid   VARCHAR(44) NOT NULL DEFAULT '',
  delegatedipv6prefix VARCHAR(45) NOT NULL DEFAULT '',
  class               VARCHAR(64) DEFAULT NULL,
  PRIMARY KEY (radacctid),
  UNIQUE KEY uq_radacct_unique (acctuniqueid),
  KEY idx_radacct_username (username),
  KEY idx_radacct_framedip (framedipaddress),
  KEY idx_radacct_session (acctsessionid),
  KEY idx_radacct_start (acctstarttime),
  KEY idx_radacct_stop (acctstoptime),
  KEY idx_radacct_nasip (nasipaddress),
  KEY idx_radacct_open (acctstoptime, username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS radpostauth (
  id        INT(11) NOT NULL AUTO_INCREMENT,
  username  VARCHAR(64) NOT NULL DEFAULT '',
  pass      VARCHAR(64) NOT NULL DEFAULT '',
  reply     VARCHAR(32) NOT NULL DEFAULT '',
  authdate  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  class     VARCHAR(64) DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_radpostauth_username (username),
  KEY idx_radpostauth_authdate (authdate)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS nas (
  id          INT(10) NOT NULL AUTO_INCREMENT,
  nasname     VARCHAR(128) NOT NULL,
  shortname   VARCHAR(32) DEFAULT NULL,
  type        VARCHAR(30) DEFAULT 'other',
  ports       INT(5) DEFAULT NULL,
  secret      VARCHAR(60) DEFAULT 'secret',
  server      VARCHAR(64) DEFAULT NULL,
  community   VARCHAR(50) DEFAULT NULL,
  description VARCHAR(200) DEFAULT 'RADIUS Client',
  PRIMARY KEY (id),
  KEY idx_nas_nasname (nasname)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Skynity-side extensions to link subscriptions/packages/routers
-- to the RADIUS world.
-- ------------------------------------------------------------

ALTER TABLE packages
  ADD COLUMN radius_group        VARCHAR(64) NULL AFTER mikrotik_profile,
  ADD COLUMN radius_session_timeout INT UNSIGNED NULL AFTER radius_group,
  ADD COLUMN radius_idle_timeout    INT UNSIGNED NULL AFTER radius_session_timeout;

ALTER TABLE mikrotik_routers
  ADD COLUMN radius_enabled       TINYINT(1)   NOT NULL DEFAULT 0,
  ADD COLUMN radius_secret        VARCHAR(128) NULL,
  ADD COLUMN radius_nas_ip        VARCHAR(45)  NULL,
  ADD COLUMN radius_nas_shortname VARCHAR(64)  NULL,
  ADD COLUMN radius_coa_port      INT UNSIGNED NOT NULL DEFAULT 3799;

ALTER TABLE subscriptions
  ADD COLUMN radius_synced       TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN radius_last_sync_at DATETIME NULL,
  ADD COLUMN radius_error        TEXT NULL,
  ADD KEY idx_sub_radius_sync (radius_synced, status);

-- Audit trail — every RADIUS write the backend performs.
CREATE TABLE IF NOT EXISTS radius_sync_log (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  subscription_id INT UNSIGNED NULL,
  action          VARCHAR(32) NOT NULL,  -- upsert_user, disable_user, enable_user, delete_user, upsert_group, coa_disconnect, full_sync
  username        VARCHAR(64) NULL,
  groupname       VARCHAR(64) NULL,
  nas_id          INT(10) NULL,
  ok              TINYINT(1) NOT NULL DEFAULT 0,
  error           TEXT NULL,
  meta            JSON NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_radsync_sub (subscription_id, created_at),
  KEY idx_radsync_action (action, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Queue of Change-of-Authorization / Packet-of-Disconnect jobs
-- that the backend must deliver to a NAS. Processed by the
-- scheduler — retries on failure, gives up after `max_attempts`.
CREATE TABLE IF NOT EXISTS radius_disconnect_queue (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  subscription_id INT UNSIGNED NULL,
  username        VARCHAR(64) NOT NULL,
  router_id       INT UNSIGNED NULL,
  reason          VARCHAR(100) NULL,
  attempts        INT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts    INT UNSIGNED NOT NULL DEFAULT 5,
  status          ENUM('pending','done','failed') NOT NULL DEFAULT 'pending',
  last_error      TEXT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  done_at         DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_radq_status (status, created_at),
  KEY idx_radq_user (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Seed: baseline settings so the backend + FreeRADIUS can see
-- a coherent state on first boot. Admin toggles `feature.radius_enabled`
-- once everything is wired up on the MikroTik.
-- ------------------------------------------------------------
INSERT INTO system_settings (setting_key, setting_value, value_type, description, is_secret) VALUES
  ('feature.radius_enabled',     'false',    'boolean','Master switch — when true, subscription changes also push to FreeRADIUS tables.', 0),
  ('radius.host',                '',         'string', 'Public IP/hostname the MikroTik NAS should use as RADIUS server (auth 1812/acct 1813).', 0),
  ('radius.default_secret',      '',         'string', 'Default shared secret used when auto-registering a new NAS row from mikrotik_routers.', 1),
  ('radius.accounting_interval', '60',       'number', 'Interim-update interval in seconds that the NAS should use.', 0),
  ('radius.nas_type',            'mikrotik', 'string', 'NAS vendor identifier (mikrotik/cisco/other).', 0),
  ('radius.auto_register_nas',   'true',     'boolean','Auto-insert an entry in the RADIUS nas table whenever a router is added.', 0),
  ('radius.coa_enabled',         'true',     'boolean','Allow backend to issue CoA/PoD packets to NAS (port 3799).', 0)
  ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);
