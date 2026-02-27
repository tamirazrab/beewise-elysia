import { beforeAll, afterAll, beforeEach, test, expect } from 'bun:test';
import type { KyInstance } from 'ky';
import { startTestApp } from '../setup/test-app';
import { runMigrations, resetDatabase } from '../setup/db';
import { getFaker } from '../setup/faker';
import { db } from '@common/db';
import { user as userTable } from '@common/db/schema/auth';

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

beforeEach(async () => {
  await resetDatabase();
});

async function registerAdminUser() {
  const faker = getFaker();
  const email = faker.internet.email().toLowerCase();
  const password = 'SecurePass123!';
  const name = faker.person.fullName();

  const registerRes = await client
    .post('api/auth/register', { json: { email, password, name } })
    .json<{ token: string; user: { id: string } }>();

  await db
    .update(userTable)
    .set({ role: 'admin' })
    .where(userTable.id.eq(registerRes.user.id));

  const loginRes = await client
    .post('api/auth/login', { json: { email, password } })
    .json<{ token: string }>();

  return { token: loginRes.token };
}

async function registerUser() {
  const faker = getFaker();
  const email = faker.internet.email().toLowerCase();
  const password = 'SecurePass123!';
  const name = faker.person.fullName();

  const res = await client
    .post('api/auth/register', { json: { email, password, name } })
    .json<{ token: string }>();

  return { token: res.token };
}

test('speak-practice: list returns empty initially and 404 for random when no sentences', async () => {
  const listRes = await client.get('api/speak-practice');
  expect(listRes.status).toBe(200);
  const listBody = await listRes.json();
  expect(listBody.items).toEqual([]);
  expect(listBody.total).toBe(0);

  const randomRes = await client.get('api/speak-practice/random');
  expect(randomRes.status).toBe(404);
});

test('speak-practice: admin can create, list, get, update, and delete sentence', async () => {
  const { token } = await registerAdminUser();

  const createRes = await client.post('api/speak-practice', {
    json: {
      sentence: 'Hola, ¿cómo estás?',
      languageCode: 'es',
      level: 'beginner',
    },
    headers: { authorization: `Bearer ${token}` },
  });
  expect(createRes.status).toBe(201);
  const createBody = await createRes.json();
  const id = createBody.data.id as string;

  const listRes = await client.get('api/speak-practice', {
    searchParams: { languageCode: 'es' },
  });
  expect(listRes.status).toBe(200);
  const listBody = await listRes.json();
  expect(listBody.items.length).toBe(1);

  const getRes = await client.get(`api/speak-practice/${id}`);
  expect(getRes.status).toBe(200);

  const updateRes = await client.put(`api/speak-practice/${id}`, {
    json: { sentence: 'Hola, ¿qué tal?' },
    headers: { authorization: `Bearer ${token}` },
  });
  expect(updateRes.status).toBe(200);

  const deleteRes = await client.delete(`api/speak-practice/${id}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(deleteRes.status).toBe(200);

  const getAfterDelete = await client.get(`api/speak-practice/${id}`);
  expect(getAfterDelete.status).toBe(404);
});

test('speak-practice: non-admin cannot create sentence', async () => {
  const { token } = await registerUser();

  const res = await client.post('api/speak-practice', {
    json: {
      sentence: 'Hola',
      languageCode: 'es',
      level: 'beginner',
    },
    headers: { authorization: `Bearer ${token}` },
  });

  expect(res.status).toBe(403);
});

