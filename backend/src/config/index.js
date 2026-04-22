import 'dotenv/config';
import { z } from 'zod';

// Treat empty strings the same as undefined so schema defaults kick in.
const emptyToUndef = (v) => (v === '' ? undefined : v);

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.string().default('info'),

  DB_HOST: z.string().default('mysql'),
  DB_PORT: z.coerce.number().default(3306),
  DB_NAME: z.string().default('skynity'),
  DB_USER: z.string().default('skynity'),
  DB_PASSWORD: z.string(),

  REDIS_HOST: z.string().default('redis'),
  REDIS_PORT: z.coerce.number().default(6379),

  // Telegram bot is optional: if missing, the bot just won't start.
  TELEGRAM_BOT_TOKEN: z.preprocess(emptyToUndef, z.string().optional()),
  TELEGRAM_ADMIN_IDS: z.preprocess(
    emptyToUndef,
    z.string()
      .default('')
      .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean))
  ),

  // MikroTik is optional on first boot. Admins can add routers from the
  // web UI (Routers → Add). If these are set, the primary client falls
  // back to them when no DB router is selected.
  MIKROTIK_HOST: z.preprocess(emptyToUndef, z.string().optional()),
  MIKROTIK_PORT: z.coerce.number().default(443),
  MIKROTIK_USERNAME: z.preprocess(emptyToUndef, z.string().optional()),
  MIKROTIK_PASSWORD: z.preprocess(emptyToUndef, z.string().optional()),
  MIKROTIK_USE_SSL: z.coerce.boolean().default(true),
  MIKROTIK_REJECT_UNAUTHORIZED: z.coerce.boolean().default(false),

  SNMP_ENABLED: z.coerce.boolean().default(false),
  SNMP_COMMUNITY: z.string().default('public'),
  SNMP_PORT: z.coerce.number().default(161),
  SNMP_VERSION: z.enum(['1', '2c']).default('2c'),
  SNMP_TIMEOUT_MS: z.coerce.number().default(2500),

  BKASH_NUMBER: z.string().default(''),
  BKASH_TYPE: z.string().default('personal'),
  NAGAD_NUMBER: z.string().default(''),
  NAGAD_TYPE: z.string().default('personal'),

  BKASH_APP_KEY: z.preprocess(emptyToUndef, z.string().optional()),
  BKASH_APP_SECRET: z.preprocess(emptyToUndef, z.string().optional()),
  BKASH_USERNAME: z.preprocess(emptyToUndef, z.string().optional()),
  BKASH_PASSWORD: z.preprocess(emptyToUndef, z.string().optional()),
  BKASH_BASE_URL: z.string().default('https://tokenized.sandbox.bka.sh/v1.2.0-beta'),
  BKASH_MODE: z.enum(['sandbox', 'live']).default('sandbox'),
  BKASH_AGREEMENT_ID: z.preprocess(emptyToUndef, z.string().optional()),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 characters'),

  APP_NAME: z.string().default('Skynity ISP'),
  APP_TIMEZONE: z.string().default('Asia/Dhaka'),
  CURRENCY: z.string().default('BDT'),
  CURRENCY_SYMBOL: z.string().default('৳'),

  UPLOAD_DIR: z.string().default('/app/uploads'),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().default(5),

  // Public URL the admin panel is reachable at (used by the router
  // /tool/fetch pulls for config files). Falls back per-request.
  PUBLIC_BASE_URL: z.preprocess(emptyToUndef, z.string().optional()),

  // --- RADIUS / AAA (optional) ---
  // Host FreeRADIUS is reachable at from the backend container.
  // In the default compose stack this is the service name
  // `freeradius` on the internal docker network.
  RADIUS_HOST: z.string().default('freeradius'),
  RADIUS_AUTH_PORT: z.coerce.number().default(1812),
  RADIUS_ACCT_PORT: z.coerce.number().default(1813),
  RADIUS_COA_PORT:  z.coerce.number().default(3799),
  // Shared secret backend uses when speaking directly to the
  // FreeRADIUS `localhost` client (radtest health-checks, future
  // CoA-to-self). NOT the per-NAS secret — that lives in the
  // `nas` table.
  RADIUS_LOCALHOST_SECRET: z.preprocess(emptyToUndef, z.string().optional()),
});

const parsed = ConfigSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;

/** True if a primary MikroTik router was configured via env. */
export const hasEnvMikrotik = Boolean(
  config.MIKROTIK_HOST && config.MIKROTIK_USERNAME && config.MIKROTIK_PASSWORD
);

export default config;
