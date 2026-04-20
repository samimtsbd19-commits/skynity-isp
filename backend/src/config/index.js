import 'dotenv/config';
import { z } from 'zod';

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production']).default('production'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.string().default('info'),

  DB_HOST: z.string(),
  DB_PORT: z.coerce.number().default(3306),
  DB_NAME: z.string(),
  DB_USER: z.string(),
  DB_PASSWORD: z.string(),

  REDIS_HOST: z.string(),
  REDIS_PORT: z.coerce.number().default(6379),

  TELEGRAM_BOT_TOKEN: z.string(),
  TELEGRAM_ADMIN_IDS: z.string().transform((v) =>
    v.split(',').map((s) => s.trim()).filter(Boolean)
  ),

  MIKROTIK_HOST: z.string(),
  MIKROTIK_PORT: z.coerce.number().default(443),
  MIKROTIK_USERNAME: z.string(),
  MIKROTIK_PASSWORD: z.string(),
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

  JWT_SECRET: z.string().min(16),
  SESSION_SECRET: z.string().min(16),

  APP_NAME: z.string().default('Skynity ISP'),
  APP_TIMEZONE: z.string().default('Asia/Dhaka'),
  CURRENCY: z.string().default('BDT'),
  CURRENCY_SYMBOL: z.string().default('৳'),

  UPLOAD_DIR: z.string().default('/app/uploads'),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().default(5),
});

const parsed = ConfigSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export default config;
