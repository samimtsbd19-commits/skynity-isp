import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from './pool.js';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
  const pool = getPool();

  // migrations table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(100) PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const dir = path.resolve(__dirname, '..', '..', 'migrations');
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const [rows] = await pool.query('SELECT id FROM schema_migrations WHERE id = ?', [file]);
    if (rows.length) {
      logger.info({ file }, 'migration already applied');
      continue;
    }
    logger.info({ file }, 'applying migration');
    const sql = await fs.readFile(path.join(dir, file), 'utf8');
    // Split by semicolons at end-of-line; keep statements that have real SQL
    // after stripping leading "-- ..." comment lines (SQL like
    //   -- ----- Admins -----
    //   CREATE TABLE admins ...
    // must not be skipped).
    const statements = sql
      .split(/;\s*$/m)
      .map((s) => s.trim())
      .map((s) => s.replace(/^(?:\s*--[^\n]*\n?)+/, '').trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      try {
        await pool.query(stmt);
      } catch (err) {
        logger.error({ err, stmt: stmt.slice(0, 120) }, 'migration statement failed');
        throw err;
      }
    }
    await pool.query('INSERT INTO schema_migrations (id) VALUES (?)', [file]);
    logger.info({ file }, 'migration applied');
  }

  logger.info('all migrations applied');
  process.exit(0);
}

run().catch((err) => {
  logger.error({ err }, 'migration failed');
  process.exit(1);
});
