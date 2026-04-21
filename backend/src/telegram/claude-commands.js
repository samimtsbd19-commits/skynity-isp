// ============================================================
// Claude AI + emergency controls (Telegram, admin-only)
// ============================================================

import * as claude from '../services/claude.js';
import ops from '../services/ops.js';
import { setSetting } from '../services/settings.js';
import logger from '../utils/logger.js';
import {
  stopTelegramPolling,
  startTelegramPolling,
} from './poll-control.js';

const MAX_MSG = 20;

export function registerClaudeAi(bot, { isAdmin, setSession, clearSession }) {
  bot.onText(/^\/models$/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const choices = await claude.getModelChoices();
    const lines = choices.map((m) => `• \`${m.id}\`\n  _${m.label}_`).join('\n');
    const via = await claude.aiProviderName();
    await bot.sendMessage(
      msg.chat.id,
      `🧠 *Models* (${via})\n\n${lines}`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.onText(/^\/ai_stop$/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    await clearSession(msg.from.id);
    await bot.sendMessage(msg.chat.id, '✅ AI chat ended. Use /ai to start again.');
  });

  bot.onText(/^\/emergency_on$/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    await ops.setEmergencyStop(true, { updatedBy: `tg:${msg.from.id}` });
    await bot.sendMessage(
      msg.chat.id,
      '🛑 *Emergency stop ON*\n\n'
      + '• All cron jobs (sync, monitoring, expiry reminders, etc.) are paused.\n'
      + '• HTTP API still works — use Security page or /emergency_off\n'
      + '• Telegram stays online.',
      { parse_mode: 'Markdown' }
    );
  });

  bot.onText(/^\/emergency_off$/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    await ops.setEmergencyStop(false, { updatedBy: `tg:${msg.from.id}` });
    await bot.sendMessage(msg.chat.id, '✅ Emergency stop OFF — background jobs active again.');
  });

  bot.onText(/^\/bot_pause$/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    try {
      await stopTelegramPolling();
      await bot.sendMessage(msg.chat.id, '⏸ Telegram *polling paused*. /bot_resume', { parse_mode: 'Markdown' });
    } catch (e) {
      await bot.sendMessage(msg.chat.id, `Failed: ${e.message}`);
    }
  });

  bot.onText(/^\/bot_resume$/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    try {
      await startTelegramPolling();
      await bot.sendMessage(msg.chat.id, '▶️ Telegram polling resumed.');
    } catch (e) {
      await bot.sendMessage(msg.chat.id, `Failed: ${e.message}`);
    }
  });

  bot.onText(/^\/ai$/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;
    const enabled = await claude.isClaudeEnabled();
    if (!enabled) {
      return bot.sendMessage(
        msg.chat.id,
        'AI is off. Set `ai.claude.enabled` = true, then either:\n'
        + '• *OpenRouter:* `ai.openrouter.enabled` + `ai.openrouter.api_key` (openrouter.ai/keys)\n'
        + '• *Anthropic direct:* `ai.claude.api_key`\n',
        { parse_mode: 'Markdown' }
      );
    }
    const choices = await claude.getModelChoices();
    const keyboard = choices.map((m, i) => [{
      text: m.label.slice(0, 64),
      callback_data: `aim:${i}`,
    }]);
    const via = await claude.aiProviderName();
    await bot.sendMessage(
      msg.chat.id,
      `🧠 *AI* (${via})\n\nPick a model, then type your question. /ai_stop to exit.\nOne-shot: \`/ai your text\``,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } }
    );
  });

  bot.onText(/^\/ai\s+(.+)$/s, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return;
    const enabled = await claude.isClaudeEnabled();
    if (!enabled) {
      return bot.sendMessage(msg.chat.id, 'AI disabled — check System Settings (ai.claude.enabled + OpenRouter or Anthropic key).');
    }
    try {
      const reply = await claude.chat({ userMessage: match[1].trim() });
      await bot.sendMessage(msg.chat.id, truncateTelegram(reply.text, 3900));
    } catch (err) {
      await bot.sendMessage(msg.chat.id, `❌ ${err.message}`);
    }
  });

  bot.on('callback_query', async (cq) => {
    const data = cq.data || '';
    if (!data.startsWith('aim:')) return;
    if (!isAdmin(cq.from.id)) {
      return bot.answerCallbackQuery(cq.id, { text: 'Admin only', show_alert: true });
    }
    const idx = Number(data.slice(4));
    if (!Number.isFinite(idx) || idx < 0) {
      return bot.answerCallbackQuery(cq.id, { text: 'Invalid', show_alert: true });
    }
    const model = await claude.modelFromChoiceIndex(idx);
    if (!model) {
      return bot.answerCallbackQuery(cq.id, { text: 'Bad model index', show_alert: true });
    }
    const tgId = cq.from.id;
    await setSession(tgId, 'ai_chat', { model, messages: [] });
    await bot.answerCallbackQuery(cq.id, { text: 'OK' });
    await bot.sendMessage(
      cq.message.chat.id,
      `✅ Model: \`${model}\`\nSend your message. /ai_stop`,
      { parse_mode: 'Markdown' }
    );
  });
}

export async function handleAiChatMessage(bot, msg, session, { setSession, isAdmin }) {
  if (!isAdmin(msg.from.id)) return false;
  if (session.state !== 'ai_chat') return false;
  if (!msg.text || msg.text.startsWith('/')) return false;

  const enabled = await claude.isClaudeEnabled();
  if (!enabled) {
    await bot.sendMessage(msg.chat.id, 'AI disabled.');
    return true;
  }

  const model = session.data?.model;
  let messages = Array.isArray(session.data?.messages) ? [...session.data.messages] : [];
  const userText = msg.text.trim();

  messages.push({ role: 'user', content: userText });
  if (messages.length > MAX_MSG) messages = messages.slice(-MAX_MSG);

  try {
    const reply = await claude.continueChat({ model, messages });
    messages.push({ role: 'assistant', content: reply.text });
    if (messages.length > MAX_MSG) messages = messages.slice(-MAX_MSG);

    await setSession(msg.from.id, 'ai_chat', { model, messages });
    await bot.sendMessage(msg.chat.id, truncateTelegram(reply.text, 3900));
  } catch (err) {
    logger.error({ err: err.message }, 'AI continueChat failed');
    messages.pop();
    await setSession(msg.from.id, 'ai_chat', { model, messages });
    await bot.sendMessage(msg.chat.id, `❌ ${err.message}`);
  }
  return true;
}

function truncateTelegram(s, max) {
  const t = String(s || '');
  if (t.length <= max) return t;
  return `${t.slice(0, max - 24)}… [truncated]`;
}

export function registerSettingShortcut(bot, { isAdmin }) {
  bot.onText(/^\/setsetting\s+([a-z0-9._-]+)\s+([\s\S]+)$/i, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return;
    const key = match[1];
    const value = match[2].trim();
    try {
      await setSetting({ key, value, updatedBy: `tg:${msg.from.id}` });
      await bot.sendMessage(msg.chat.id, `✅ \`${key}\` updated`, { parse_mode: 'Markdown' });
    } catch (e) {
      await bot.sendMessage(msg.chat.id, `❌ ${e.message}`);
    }
  });
}
