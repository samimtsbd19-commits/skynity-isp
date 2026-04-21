# AI assistant in Telegram (Anthropic or OpenRouter)

## Option A — OpenRouter (one key, many models)

1. Create a key at [openrouter.ai/keys](https://openrouter.ai/keys) (`sk-or-v1-…`).
2. In **System Settings**:
   - `ai.claude.enabled` = `true`
   - `ai.openrouter.enabled` = `true`
   - `ai.openrouter.api_key` = your OpenRouter key (secret)
   - Optional: `ai.openrouter.default_model` (e.g. `anthropic/claude-3.5-sonnet`, `openai/gpt-4o`)
   - Optional: `ai.openrouter.site_url` — sent as `HTTP-Referer` to OpenRouter (or use `site.public_base_url`)

When OpenRouter is enabled, `/ai` and `/models` use **OpenRouter** model IDs; Telegram buttons use short `aim:N` callbacks (fits Telegram’s 64-byte limit).

## Option B — Anthropic direct

- **claude.ai “Pro” (web)** and **Anthropic API** are billed separately.
- Get a key from [Anthropic Console](https://console.anthropic.com/) and set `ai.claude.api_key`. Leave **`ai.openrouter.enabled` = false** so traffic goes to Anthropic’s API only.

## Telegram commands (admins only)

| Command | Action |
|--------|--------|
| `/ai` | Pick a model (inline buttons), then chat until `/ai_stop` |
| `/ai <text>` | One-shot question |
| `/models` | List model IDs |
| `/ai_stop` | End multi-turn session |
| `/setsetting <key> <value>` | Quick string update for a `system_settings` key (e.g. toggling a `feature.*` flag) |
| `/emergency_on` | Pause **all cron jobs** (sync, monitoring, reminders, etc.) — API stays up |
| `/emergency_off` | Resume crons |
| `/bot_pause` | Stop Telegram **polling** only (rare — use if the bot hogs CPU) |
| `/bot_resume` | Start polling again |

The AI receives a short **Skynity ISP context** (stack, settings, MikroTik) so it can explain how to turn features on/off. It **does not** automatically change your database; use `/setsetting` or the admin UI for that.

## Suggested workflow for “add a feature”

1. Ask in `/ai`: e.g. “How do I enable expiry SMS reminders?”
2. Apply the suggested **System Settings** keys in **System** or via `/setsetting`.
3. For code changes you still deploy via Git/Coolify — the bot cannot patch your VPS filesystem.

## Security page

Admin → **Security** shows login/OTP/portal failures and has the same **emergency stop** toggle as Telegram.
