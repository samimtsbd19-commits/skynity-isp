-- ============================================================
-- 017: Live-config hot-reload — move Telegram credentials to DB
--       settings so they can be edited from the UI without a
--       container restart.
-- ============================================================

INSERT IGNORE INTO system_settings (setting_key, setting_value, value_type, description, is_secret) VALUES
  ('telegram.bot_token',   '',     'string',
    'Telegram bot token from @BotFather. Save + Restart Bot to apply. Falls back to env TELEGRAM_BOT_TOKEN if empty.', 1),
  ('telegram.admin_ids',   '',     'string',
    'Comma-separated Telegram user IDs that may use admin commands. Falls back to env TELEGRAM_ADMIN_IDS if empty.', 0),
  ('telegram.bot_enabled', 'true', 'boolean',
    'Master switch for the Telegram bot. Turn off to stop without removing the token.', 0);
