import pino from 'pino';
import config from '../config/index.js';

const transport =
  config.NODE_ENV === 'development'
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
    : undefined;

export const logger = pino({
  level: config.LOG_LEVEL,
  base: { app: 'skynity' },
  transport,
});

export default logger;
