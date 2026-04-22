import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    env: {
      DB_PASSWORD: 'vitest_db_password_not_used',
      JWT_SECRET: '0123456789abcdef0123456789abcdef',
      SESSION_SECRET: 'fedcba9876543210fedcba9876543210',
    },
  },
});
