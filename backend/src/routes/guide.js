// ============================================================
// /api/guide — Project guide markdown (AI handoff document)
// ============================================================
import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireAdmin, requireRole } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// In Docker, backend runs from /app so the docs dir lives at /app/docs.
// Try a few candidate locations so dev (Windows) and prod (Linux/Docker) both work.
const CANDIDATES = [
  path.resolve('/app/docs/PROJECT_GUIDE.md'),
  path.resolve(__dirname, '../../../docs/PROJECT_GUIDE.md'),
  path.resolve(process.cwd(), 'docs/PROJECT_GUIDE.md'),
  path.resolve(process.cwd(), '../docs/PROJECT_GUIDE.md'),
];

async function findGuideFile() {
  for (const p of CANDIDATES) {
    try {
      await fs.access(p);
      return p;
    } catch { /* try next */ }
  }
  // Default write location
  return CANDIDATES[0];
}

const router = Router();

router.get('/', requireAdmin, async (req, res) => {
  try {
    const file = await findGuideFile();
    try {
      const markdown = await fs.readFile(file, 'utf8');
      const stat = await fs.stat(file);
      res.json({ markdown, path: file, mtime: stat.mtime });
    } catch {
      res.json({ markdown: '# Project Guide\n\nNot yet created.', path: file, mtime: null });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    const { markdown } = req.body || {};
    if (typeof markdown !== 'string') return res.status(400).json({ error: 'markdown string required' });
    const file = await findGuideFile();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, markdown, 'utf8');
    res.json({ ok: true, path: file, bytes: Buffer.byteLength(markdown, 'utf8') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
