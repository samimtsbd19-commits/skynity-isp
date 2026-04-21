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

// helmet with captive-portal-friendly CSP (portal uses inline styles)
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// CORS: in production only allow same-origin (served behind Caddy/nginx).
// In development allow the Vite dev server on port 5173.
const allowedOrigins =
  config.NODE_ENV === 'production'
    ? [config.PUBLIC_BASE_URL].filter(Boolean)
    : ['http://localhost:5173', 'http://127.0.0.1:5173'];

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no Origin header (curl, Postman, same-origin browser)
    if (!origin) return cb(null, true);
    if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// trust the reverse proxy (Coolify/Traefik/Caddy) so req.ip and
// x-forwarded-for are honoured by the portal rate-limiter
app.set('trust proxy', 1);

// ---------- Uploads (logos, etc.) ----------
app.use('/uploads', express.static('/app/uploads', { maxAge: '7d' }));

// ---------- API (includes token-protected admin + public /portal) ----------
app.use('/api', apiRoutes);

// ---------- health ----------
// Returns 200 as long as the DB is reachable; MikroTik state is informational only.
app.get('/health', async (_req, res) => {
  const out = { status: 'ok', app: config.APP_NAME, ts: new Date().toISOString() };
  try {
    await db.query('SELECT 1');
    out.db = 'ok';
  } catch (e) {
    out.status = 'degraded';
    out.db = 'error';
    out.db_error = e.message;
    return res.status(503).json(out);
  }
  try {
    const mt = await getMikrotikClient();
    const info = await mt.ping();
    out.mikrotik = { status: 'ok', ...info };
  } catch (e) {
    out.mikrotik = { status: 'not_configured', detail: e.message };
  }
  res.json(out);
});

app.get('/', (_req, res) => {
  res.json({ app: config.APP_NAME, version: '0.1.0', message: 'Skynity ISP backend is running' });
});

// ---------- global error handler ----------
// Must be defined after all routes (4-arg signature signals it to Express).
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  logger.error({ err, path: req.path, method: req.method }, 'unhandled route error');
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: err.message || 'internal server error' });
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

  // bootstrap first admin (superadmin) on empty install
  try {
    const [row] = await db.query('SELECT COUNT(*) AS c FROM admins');
    if (row.c === 0) {
      const defaultPassword = 'admin123'; // WARNING: change after first login
      const hash = await bcrypt.hash(defaultPassword, 10);
      const firstTgId = config.TELEGRAM_ADMIN_IDS[0] || null;
      await db.query(
        `INSERT INTO admins (username, password_hash, full_name, telegram_id, role, is_active)
         VALUES (?, ?, ?, ?, 'superadmin', 1)`,
        ['admin', hash, 'Superadmin', firstTgId]
      );
      logger.warn('bootstrapped admin user: username=admin password=admin123 — CHANGE IMMEDIATELY after first login');
    }
  } catch (err) {
    logger.error({ err }, 'admin bootstrap failed');
  }

  // start Telegram bot
  try {
    await startBot();
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
