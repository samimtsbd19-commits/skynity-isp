# Claude AI in Telegram

## Important: API vs claude.ai Pro

- **claude.ai “Pro” (web chat)** and **Anthropic API** are billed separately.
- To use the bot you need an **API key** from [Anthropic Console](https://console.anthropic.com/) (Usage → API keys).
- Put the key in **System Settings** as `ai.claude.api_key` (secret) and set `ai.claude.enabled` = `true`.

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
