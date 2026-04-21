// ============================================================
// Anthropic Claude Messages API
// ------------------------------------------------------------
// Requires ai.claude.api_key in system_settings (Anthropic Console).
// claude.ai "Pro" web subscription does NOT include API access.
// ============================================================

import axios from 'axios';
import { getSetting } from './settings.js';
import logger from '../utils/logger.js';

const API = 'https://api.anthropic.com/v1/messages';

const SKYNITY_CONTEXT = `You are an expert assistant for "Skynity ISP", a Bangladesh ISP billing and network automation stack.
Tech stack: Node.js backend, React admin + public portal, MySQL, Redis, MikroTik RouterOS REST API, Docker/Coolify deployment.
Admins configure features via System Settings (keys like site.name, feature.*, notify.*, provisioning.*), MikroTik routers in DB, packages, orders.
You help with: explaining how to enable/disable features, safe operational steps, MikroTik concepts (PPPoE, hotspot, queues), and suggesting setting keys.
You MUST NOT claim you changed production data unless the user used an explicit admin command that does so. For "add a feature", give concrete steps: which setting key, which admin page, or which env var — never invent nonexistent API endpoints.
Keep answers concise for Telegram; use bullet lists when helpful.`;

export async function isClaudeEnabled() {
  const enabled = String(await getSetting('ai.claude.enabled')).toLowerCase() === 'true';
  const key = await getSetting('ai.claude.api_key');
  return !!(enabled && key && String(key).length > 10);
}

export async function chat({ userMessage, model, systemExtra = '' }) {
  const key = await getSetting('ai.claude.api_key');
  if (!key) throw new Error('ai.claude.api_key not set in System Settings');
  const defModel = (await getSetting('ai.claude.model')) || 'claude-3-5-sonnet-20241022';
  const maxTokens = Math.min(8192, Math.max(256, Number(await getSetting('ai.claude.max_tokens')) || 2048));
  const useModel = model || defModel;

  const system = [SKYNITY_CONTEXT, systemExtra].filter(Boolean).join('\n\n');

  const { data } = await axios.post(
    API,
    {
      model: useModel,
      max_tokens: maxTokens,
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
 * Multi-turn chat. `messages` = Anthropic shape ending with user:
 * [ { role:'user', content }, { role:'assistant', content }, ... , { role:'user', content } ]
 */
export async function continueChat({ messages, model }) {
  const key = await getSetting('ai.claude.api_key');
  if (!key) throw new Error('ai.claude.api_key not set in System Settings');
  const defModel = (await getSetting('ai.claude.model')) || 'claude-3-5-sonnet-20241022';
  const maxTokens = Math.min(8192, Math.max(256, Number(await getSetting('ai.claude.max_tokens')) || 2048));
  const useModel = model || defModel;

  const system = SKYNITY_CONTEXT;

  const { data } = await axios.post(
    API,
    {
      model: useModel,
      max_tokens: maxTokens,
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

export const MODEL_CHOICES = [
  { id: 'claude-3-5-sonnet-20241022', label: 'Sonnet 3.5 (balanced)' },
  { id: 'claude-3-5-haiku-20241022', label: 'Haiku 3.5 (fast/cheap)' },
  { id: 'claude-3-opus-20240229', label: 'Opus 3 (heaviest)' },
];

export default { chat, continueChat, isClaudeEnabled, MODEL_CHOICES };
