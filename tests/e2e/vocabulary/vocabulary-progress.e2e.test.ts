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
    .json<{ token: string; user: { id: string } }>();

  return { token: res.token, userId: res.user.id };
}

async function createVocabularyItem(adminToken: string) {
  const res = await client.post('api/vocabulary', {
    json: {
      languageCode: 'es',
      difficultyLevel: 'beginner',
      word: 'hola',
      meaning: 'hello',
    },
    headers: { authorization: `Bearer ${adminToken}` },
  });

  expect(res.status).toBe(201);
  const body = await res.json();
  return body.data.id as string;
}

test('vocabulary progress: user can update and fetch progress by vocabularyId', async () => {
  const { token: adminToken } = await registerAdminUser();
  const vocabId = await createVocabularyItem(adminToken);

  const { token } = await registerUser();

  const updateRes = await client.put(`api/vocabulary/progress/${vocabId}`, {
    json: { masteryLevel: 75 },
    headers: { authorization: `Bearer ${token}` },
  });
  expect(updateRes.status).toBe(200);
  const updateBody = await updateRes.json();
  expect(updateBody.data.masteryLevel).toBe(75);

  const getRes = await client.get('api/vocabulary/progress', {
    headers: { authorization: `Bearer ${token}` },
    searchParams: { vocabularyId: vocabId },
  });
  expect(getRes.status).toBe(200);
  const getBody = await getRes.json();
  expect(Array.isArray(getBody.progress)).toBe(true);
  expect(getBody.progress[0].vocabularyId).toBe(vocabId);
});

test('vocabulary progress: anonymous device can update and fetch progress', async () => {
  const { token: adminToken } = await registerAdminUser();
  const vocabId = await createVocabularyItem(adminToken);

  const deviceId = 'anon-progress-device';

  const updateRes = await client.put(`api/vocabulary/progress/${vocabId}`, {
    json: { masteryLevel: 50 },
    headers: { 'X-Device-Id': deviceId },
  });
  expect(updateRes.status).toBe(200);

  const getRes = await client.get('api/vocabulary/progress', {
    headers: { 'X-Device-Id': deviceId },
    searchParams: { vocabularyId: vocabId },
  });
  expect(getRes.status).toBe(200);
  const getBody = await getRes.json();
  expect(getBody.progress[0].vocabularyId).toBe(vocabId);
});

test('vocabulary progress review: returns items needing review', async () => {
  const { token: adminToken } = await registerAdminUser();
  const vocabId = await createVocabularyItem(adminToken);

  const { token } = await registerUser();

  await client.put(`api/vocabulary/progress/${vocabId}`, {
    json: { masteryLevel: 10 },
    headers: { authorization: `Bearer ${token}` },
  });

  const res = await client.get('api/vocabulary/progress/review', {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body.items)).toBe(true);
  expect(body.items.length).toBeGreaterThanOrEqual(1);
});

