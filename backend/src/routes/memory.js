// ============================================================
// /api/memory — Shared AI memory (portable, lives in repo)
// ------------------------------------------------------------
// Files in docs/memory/ are the single source of truth for
// AI context. Accessible from:
//   - Web UI  (/memory page)
//   - Telegram /ai (injected into system prompt)
//   - Any Claude.ai / ChatGPT chat via Copy-for-AI button
// This means memory survives OS reinstall, works across PCs,
// and the same context is available wherever the project is.
// ============================================================
import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireAdmin, requireRole } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CANDIDATES = [
  path.resolve('/app/docs/memory'),
  path.resolve(__dirname, '../../../docs/memory'),
  path.resolve(process.cwd(), 'docs/memory'),
  path.resolve(process.cwd(), '../docs/memory'),
];

async function findMemoryDir() {
  for (const p of CANDIDATES) {
    try {
      const stat = await fs.stat(p);
      if (stat.isDirectory()) return p;
    } catch { /* try next */ }
  }
  // Create in the first candidate if nothing exists
  await fs.mkdir(CANDIDATES[0], { recursive: true });
  return CANDIDATES[0];
}

// Safety: only allow markdown files, no traversal
function safeName(name) {
  if (!name) return null;
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return null;
  if (!name.endsWith('.md')) return null;
  if (name.length > 100) return null;
  return name;
}

const router = Router();

// ── List all memory files with metadata ──────────────────────
router.get('/', requireAdmin, async (_req, res) => {
  try {
    const dir = await findMemoryDir();
    const entries = await fs.readdir(dir);
    const mdFiles = entries.filter((e) => e.endsWith('.md'));
    const items = await Promise.all(mdFiles.map(async (name) => {
      const full = path.join(dir, name);
      const stat = await fs.stat(full);
      const content = await fs.readFile(full, 'utf8').catch(() => '');
      // Extract frontmatter (name, description, type)
      const meta = {};
      const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (fm) {
        for (const line of fm[1].split(/\r?\n/)) {
          const m = line.match(/^(\w+):\s*(.*)$/);
          if (m) meta[m[1]] = m[2].trim();
        }
      }
      return {
        filename: name,
        size: stat.size,
        mtime: stat.mtime,
        name: meta.name || name.replace(/\.md$/, ''),
        description: meta.description || '',
        type: meta.type || 'general',
      };
    }));
    res.json({ dir, files: items.sort((a, b) => (a.filename === 'MEMORY.md' ? -1 : b.filename === 'MEMORY.md' ? 1 : 0)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Read one file ────────────────────────────────────────────
router.get('/:file', requireAdmin, async (req, res) => {
  try {
    const name = safeName(req.params.file);
    if (!name) return res.status(400).json({ error: 'Invalid filename' });
    const dir = await findMemoryDir();
    const full = path.join(dir, name);
    try {
      const content = await fs.readFile(full, 'utf8');
      res.json({ filename: name, content });
    } catch {
      res.status(404).json({ error: 'Not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Write / update one file ──────────────────────────────────
router.put('/:file', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    const name = safeName(req.params.file);
    if (!name) return res.status(400).json({ error: 'Invalid filename' });
    const { content } = req.body || {};
    if (typeof content !== 'string') return res.status(400).json({ error: 'content string required' });
    if (content.length > 500_000) return res.status(400).json({ error: 'Content too large (>500KB)' });
    const dir = await findMemoryDir();
    await fs.writeFile(path.join(dir, name), content, 'utf8');
    res.json({ ok: true, filename: name, bytes: Buffer.byteLength(content, 'utf8') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Delete a file ────────────────────────────────────────────
router.delete('/:file', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    const name = safeName(req.params.file);
    if (!name) return res.status(400).json({ error: 'Invalid filename' });
    if (name === 'MEMORY.md') return res.status(400).json({ error: 'Cannot delete the index' });
    const dir = await findMemoryDir();
    await fs.unlink(path.join(dir, name)).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Combined: all files concatenated (for Telegram /ai injection) ──
router.get('/export/combined', requireAdmin, async (_req, res) => {
  try {
    const dir = await findMemoryDir();
    const entries = await fs.readdir(dir);
    const mdFiles = entries.filter((e) => e.endsWith('.md')).sort((a, b) => (a === 'MEMORY.md' ? -1 : b === 'MEMORY.md' ? 1 : 0));
    let combined = '';
    for (const name of mdFiles) {
      const content = await fs.readFile(path.join(dir, name), 'utf8').catch(() => '');
      combined += `\n\n=== FILE: ${name} ===\n${content}`;
    }
    res.json({ markdown: combined.trim(), files: mdFiles.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Plain-text combined export (used by AI service internally) ──
export async function readAllMemory() {
  try {
    const dir = await findMemoryDir();
    const entries = await fs.readdir(dir).catch(() => []);
    const mdFiles = entries.filter((e) => e.endsWith('.md'));
    let combined = '';
    for (const name of mdFiles) {
      const content = await fs.readFile(path.join(dir, name), 'utf8').catch(() => '');
      if (content.trim()) combined += `\n\n## ${name}\n${content}`;
    }
    return combined.trim();
  } catch {
    return '';
  }
}

export default router;
