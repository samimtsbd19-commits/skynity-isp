import Redis from 'ioredis';
import config from '../config/index.js';

const client = new Redis({
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  maxRetriesPerRequest: 2,
  lazyConnect: true,
});

client.on('error', () => { /* logged on first command if unreachable */ });

export default client;
