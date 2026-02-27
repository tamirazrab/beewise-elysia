import { beforeAll, afterAll, test, expect } from 'bun:test';
import type { KyInstance } from 'ky';
import { startTestApp } from '../setup/test-app';
import { runMigrations } from '../setup/db';

let client: KyInstance;
let stop: () => Promise<void>;

beforeAll(async () => {
  await runMigrations();
  const app = await startTestApp();
  client = app.client;
  stop = app.stop;
});

afterAll(async () => {
  if (stop) {
    await stop();
  }
});

test('Better Auth: sign-up email handler responds without server error', async () => {
  const res = await client.post('api/auth/sign-up/email', {
    json: {
      email: 'better-auth-user@example.com',
      password: 'SecurePass123!',
      name: 'Better Auth User',
      callbackURL: '/',
    },
  });

  expect(res.status).toBeGreaterThanOrEqual(200);
  expect(res.status).toBeLessThan(600);
});

test('Better Auth: request-password-reset responds without server error', async () => {
  const res = await client.post('api/auth/request-password-reset', {
    json: {
      email: 'better-auth-user@example.com',
      redirectTo: '/reset-password',
    },
  });

  expect(res.status).toBeGreaterThanOrEqual(200);
  expect(res.status).toBeLessThan(600);
});

