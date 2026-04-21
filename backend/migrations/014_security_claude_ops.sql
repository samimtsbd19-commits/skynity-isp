-- ============================================================
-- Security audit log + Claude AI + emergency operations
-- ============================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS security_events (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_type   VARCHAR(64)  NOT NULL,
  severity     VARCHAR(16)  NOT NULL DEFAULT 'info',
  ip           VARCHAR(45)  NULL,
  user_agent   VARCHAR(512) NULL,
  admin_id     INT UNSIGNED NULL,
  subject      VARCHAR(255) NULL,
  meta         JSON NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sec_type_time (event_type, created_at),
  KEY idx_sec_time (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO system_settings (setting_key, setting_value, value_type, description, is_secret) VALUES
  ('ops.emergency_stop', 'false', 'boolean',
    'When true: all scheduled cron jobs (sync, monitoring, reminders, etc.) are skipped. Use from admin Security page or Telegram /emergency_off. API stays up.',
    0),

  ('ai.claude.enabled', 'false', 'boolean',
    'Enable Claude AI in Telegram (/ai, /models). Requires ai.claude.api_key.', 0),
  ('ai.claude.api_key', '', 'string',
    'Anthropic API key (from console.anthropic.com — not the same as claude.ai Pro web subscription).', 1),
  ('ai.claude.model', 'claude-3-5-sonnet-20241022', 'string',
    'Default model id for admin Telegram AI chat.', 0),
  ('ai.claude.max_tokens', '2048', 'number',
    'Max output tokens per Claude reply.', 0)
ON DUPLICATE KEY UPDATE setting_key = setting_key;
