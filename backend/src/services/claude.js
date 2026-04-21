// ============================================================
// Admin AI assistant — Anthropic direct OR OpenRouter
// ------------------------------------------------------------
// Master switch: ai.claude.enabled
// Provider: if ai.openrouter.enabled + ai.openrouter.api_key → OpenRouter
//           else Anthropic (ai.claude.api_key)
// OpenRouter: https://openrouter.ai/docs — OpenAI-compatible /chat/completions
// ============================================================

import axios from 'axios';
import { getSetting } from './settings.js';
import logger from '../utils/logger.js';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';

const SKYNITY_CONTEXT = `You are an expert assistant for "Skynity ISP", a Bangladesh ISP billing and network automation stack.
Tech stack: Node.js backend, React admin + public portal, MySQL, Redis, MikroTik RouterOS REST API, Docker/Coolify deployment.
Admins configure features via System Settings (keys like site.name, feature.*, notify.*, provisioning.*), MikroTik routers in DB, packages, orders.
You help with: explaining how to enable/disable features, safe operational steps, MikroTik concepts (PPPoE, hotspot, queues), and suggesting setting keys.
You MUST NOT claim you changed production data unless the user used an explicit admin command that does so. For "add a feature", give concrete steps: which setting key, which admin page, or which env var — never invent nonexistent API endpoints.
Keep answers concise for Telegram; use bullet lists when helpful.`;

export const ANTHROPIC_MODEL_CHOICES = [
  { id: 'claude-3-5-sonnet-20241022', label: 'Sonnet 3.5 (Anthropic direct)' },
  { id: 'claude-3-5-haiku-20241022', label: 'Haiku 3.5' },
  { id: 'claude-3-opus-20240229', label: 'Opus 3' },
];

/** Curated OpenRouter slugs — callback_data stays short via numeric index (aim:N). */
export const OPENROUTER_MODEL_CHOICES = [
  { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
  { id: 'anthropic/claude-3.5-haiku', label: 'Claude 3.5 Haiku' },
  { id: 'openai/gpt-4o', label: 'GPT-4o' },
  { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini' },
  { id: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash' },
  { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B' },
];

/** @deprecated use getModelChoices() */
export const MODEL_CHOICES = ANTHROPIC_MODEL_CHOICES;

async function useOpenRouter() {
  const on = String(await getSetting('ai.openrouter.enabled')).toLowerCase() === 'true';
  const key = await getSetting('ai.openrouter.api_key');
  return on && key && String(key).length > 8;
}

/** For Telegram UI labels */
export async function aiProviderName() {
  return (await useOpenRouter()) ? 'OpenRouter' : 'Anthropic';
}

export async function getModelChoices() {
  return (await useOpenRouter()) ? OPENROUTER_MODEL_CHOICES : ANTHROPIC_MODEL_CHOICES;
}

/** Resolve model id from Telegram callback index (aim:N). */
export async function modelFromChoiceIndex(index) {
  const list = await getModelChoices();
  return list[index]?.id || null;
}

export async function isClaudeEnabled() {
  const master = String(await getSetting('ai.claude.enabled')).toLowerCase() === 'true';
  if (!master) return false;
  if (await useOpenRouter()) return true;
  const key = await getSetting('ai.claude.api_key');
  return !!(key && String(key).length > 10);
}

async function maxTokens() {
  return Math.min(8192, Math.max(256, Number(await getSetting('ai.claude.max_tokens')) || 2048));
}

// ------------------------------------------------------------
// OpenRouter (OpenAI chat completions)
// ------------------------------------------------------------
async function openRouterComplete({ messages, model }) {
  const key = await getSetting('ai.openrouter.api_key');
  if (!key) throw new Error('ai.openrouter.api_key not set');
  const defModel = (await getSetting('ai.openrouter.default_model')) || 'anthropic/claude-3.5-sonnet';
  const useModel = model || defModel;
  const mt = await maxTokens();
  const referer = (await getSetting('ai.openrouter.site_url'))
    || (await getSetting('site.public_base_url'))
    || 'https://localhost';

  const { data } = await axios.post(
    OPENROUTER_API,
    {
      model: useModel,
      messages,
      max_tokens: mt,
    },
    {
      headers: {
        Authorization: `Bearer ${key}`,
        'HTTP-Referer': String(referer).slice(0, 256),
        'X-Title': 'Skynity ISP',
        'Content-Type': 'application/json',
      },
      timeout: 120_000,
    }
  );

  const text = data.choices?.[0]?.message?.content;
  const out = typeof text === 'string' ? text : '';
  return { text: out || '(empty response)', model: useModel, usage: data.usage || null };
}

export async function chat({ userMessage, model, systemExtra = '' }) {
  if (await useOpenRouter()) {
    const sys = [SKYNITY_CONTEXT, systemExtra].filter(Boolean).join('\n\n');
    const messages = [
      { role: 'system', content: sys },
      { role: 'user', content: userMessage },
    ];
    return openRouterComplete({ messages, model });
  }

  const key = await getSetting('ai.claude.api_key');
  if (!key) throw new Error('ai.claude.api_key not set (or enable OpenRouter)');
  const defModel = (await getSetting('ai.claude.model')) || 'claude-3-5-sonnet-20241022';
  const useModel = model || defModel;
  const mt = await maxTokens();
  const system = [SKYNITY_CONTEXT, systemExtra].filter(Boolean).join('\n\n');

  const { data } = await axios.post(
    ANTHROPIC_API,
    {
      model: useModel,
      max_tokens: mt,
      system,
      messages: [{ role: 'user', content: userMessage }],
    },
    {
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      timeout: 120_000,
    }
  );

  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  return { text: text || '(empty response)', model: useModel, usage: data.usage || null };
}

/**
 * Multi-turn. `messages` = [{ role:'user'|'assistant', content }, ...] (no system — we prepend).
 */
export async function continueChat({ messages, model }) {
  if (await useOpenRouter()) {
    const apiMessages = [
      { role: 'system', content: SKYNITY_CONTEXT },
      ...messages,
    ];
    return openRouterComplete({ messages: apiMessages, model });
  }

  const key = await getSetting('ai.claude.api_key');
  if (!key) throw new Error('ai.claude.api_key not set');
  const defModel = (await getSetting('ai.claude.model')) || 'claude-3-5-sonnet-20241022';
  const useModel = model || defModel;
  const mt = await maxTokens();
  const system = SKYNITY_CONTEXT;

  const { data } = await axios.post(
    ANTHROPIC_API,
    {
      model: useModel,
      max_tokens: mt,
      system,
      messages,
    },
    {
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      timeout: 120_000,
    }
  );

  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  return { text: text || '(empty response)', model: useModel, usage: data.usage || null };
}

export default {
  chat,
  continueChat,
  isClaudeEnabled,
  getModelChoices,
  modelFromChoiceIndex,
  aiProviderName,
  ANTHROPIC_MODEL_CHOICES,
  OPENROUTER_MODEL_CHOICES,
  MODEL_CHOICES: ANTHROPIC_MODEL_CHOICES,
};
