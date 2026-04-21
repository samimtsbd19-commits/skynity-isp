-- OpenRouter — unified LLM API (OpenAI-compatible chat completions)
-- Use when you prefer one API key for many models (Claude, GPT, etc.)

SET NAMES utf8mb4;

INSERT INTO system_settings (setting_key, setting_value, value_type, description, is_secret) VALUES
  ('ai.openrouter.enabled', 'false', 'boolean',
    'When true, Telegram /ai uses OpenRouter instead of direct Anthropic. Requires ai.openrouter.api_key.', 0),
  ('ai.openrouter.api_key', '', 'string',
    'OpenRouter API key (sk-or-v1-...) from https://openrouter.ai/keys', 1),
  ('ai.openrouter.default_model', 'anthropic/claude-3.5-sonnet', 'string',
    'Default OpenRouter model id (e.g. anthropic/claude-3.5-sonnet, openai/gpt-4o).', 0),
  ('ai.openrouter.site_url', '', 'string',
    'Optional HTTP-Referer URL sent to OpenRouter (your site). Falls back to site.public_base_url.', 0)
ON DUPLICATE KEY UPDATE setting_key = setting_key;
