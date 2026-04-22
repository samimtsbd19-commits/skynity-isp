import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import config from '../config/index.js';
import logger from '../utils/logger.js';

const pexec = promisify(exec);

const BACKUP_DIR = process.env.BACKUP_DIR || '/var/backups/skynity';
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS || 14);
const UPLOAD_DIR = config.UPLOAD_DIR || '/app/uploads';

export async function runDailyBackup() {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const sqlFile = path.join(BACKUP_DIR, `skynity-${ts}.sql.gz`);

  const pw = config.DB_PASSWORD.replace(/'/g, "'\\''");
  const cmd = `mysqldump -h ${config.DB_HOST} -P ${config.DB_PORT} -u ${config.DB_USER} ` +
    `--password='${pw}' --single-transaction --quick --routines --triggers ` +
    `${config.DB_NAME} | gzip > ${sqlFile}`;

  try {
    await pexec(cmd, { shell: '/bin/sh', maxBuffer: 64 * 1024 * 1024 });
    const stat = await fs.stat(sqlFile);
    logger.info({ file: sqlFile, bytes: stat.size }, 'db backup ok');
  } catch (err) {
    logger.error({ err: err.message }, 'db backup failed');
    return;
  }

  try {
    const uploadTar = path.join(BACKUP_DIR, `uploads-${ts}.tar.gz`);
    await pexec(`tar czf ${uploadTar} -C ${path.dirname(UPLOAD_DIR)} ${path.basename(UPLOAD_DIR)}`, {
      shell: '/bin/sh',
      maxBuffer: 64 * 1024 * 1024,
    }).catch((e) => {
      logger.warn({ err: e.message }, 'uploads archive skipped');
    });
  } catch { /* optional */ }

  const now = Date.now();
  const files = await fs.readdir(BACKUP_DIR);
  for (const f of files) {
    const p = path.join(BACKUP_DIR, f);
    const st = await fs.stat(p);
    if (now - st.mtimeMs > RETENTION_DAYS * 86400000) {
      await fs.unlink(p);
      logger.info({ file: f }, 'backup pruned');
    }
  }
}

export default { runDailyBackup };
