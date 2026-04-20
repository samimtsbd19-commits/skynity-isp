import http from 'node:http';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import bcrypt from 'bcrypt';
import config from './config/index.js';
import logger from './utils/logger.js';
import db from './database/pool.js';
import { getMikrotikClient } from './mikrotik/client.js';
import { startBot } from './telegram/bot.js';
import { startJobs } from './jobs/scheduler.js';
import apiRoutes from './routes/api.js';
import { attachMonitorWebSocket } from './ws/monitor.js';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ---------- API ----------
app.use('/api', apiRoutes);

// ---------- health ----------
app.get('/health', async (_req, res) => {
  const out = { status: 'ok', app: config.APP_NAME, ts: new Date().toISOString() };
  try {
    await db.query('SELECT 1');
    out.db = 'ok';
  } catch (e) {
    out.db = 'error';
    out.db_error = e.message;
  }
  try {
    const mt = await getMikrotikClient();
    const info = await mt.ping();
    out.mikrotik = { status: 'ok', ...info };
  } catch (e) {
    out.mikrotik = { status: 'error', error: e.message };
  }
  res.json(out);
});

app.get('/', (_req, res) => {
  res.json({ app: config.APP_NAME, version: '0.1.0', message: 'Skynity ISP backend is running' });
});

// ---------- startup ----------
async function main() {
  // verify DB
  try {
    await db.query('SELECT 1');
    logger.info('database connection ok');
  } catch (err) {
    logger.fatal({ err }, 'database connection failed, exiting');
    process.exit(1);
  }

  // bootstrap first admin from env (if no admins exist yet)
  try {
    const [row] = await db.query('SELECT COUNT(*) AS c FROM admins');
    if (row.c === 0 && config.TELEGRAM_ADMIN_IDS.length > 0) {
      const defaultPassword = 'admin123'; // WARNING: change after first login
      const hash = await bcrypt.hash(defaultPassword, 10);
      await db.query(
        `INSERT INTO admins (username, password_hash, full_name, telegram_id, role, is_active)
         VALUES (?, ?, ?, ?, 'superadmin', 1)`,
        ['admin', hash, 'Superadmin', config.TELEGRAM_ADMIN_IDS[0]]
      );
      logger.warn('bootstrapped admin user: username=admin password=admin123 — CHANGE IMMEDIATELY');
    }
  } catch (err) {
    logger.error({ err }, 'admin bootstrap failed');
  }

  // start Telegram bot
  try {
    startBot();
  } catch (err) {
    logger.error({ err }, 'failed to start telegram bot');
  }

  // start cron jobs
  try {
    startJobs();
  } catch (err) {
    logger.error({ err }, 'failed to start cron jobs');
  }

  const server = http.createServer(app);
  attachMonitorWebSocket(server);

  server.listen(config.PORT, () => {
    logger.info({ port: config.PORT, env: config.NODE_ENV }, `${config.APP_NAME} backend listening`);
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'fatal startup error');
  process.exit(1);
});

// graceful shutdown
process.on('SIGTERM', () => { logger.info('SIGTERM received'); process.exit(0); });
process.on('SIGINT', () => { logger.info('SIGINT received'); process.exit(0); });
