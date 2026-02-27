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

test('unknown route returns 404 with structured error', async () => {
  const res = await client.get('non-existent-route');
  expect(res.status).toBe(404);
  const body = await res.json();
  expect(body.error).toBe('Route not found');
});

test('validation error returns 400 with Validation error structure', async () => {
  const res = await client.post('api/auth/login', {
    json: { password: 'missing-email@test.com' },
  });
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error).toBe('Validation error');
});

