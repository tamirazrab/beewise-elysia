import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/common/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL']!,
    ssl: process.env['APP_ENV'] && process.env['APP_ENV'] !== 'local',
  },
  verbose: true,
  strict: true,
});
