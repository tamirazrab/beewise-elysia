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

test('quizzes: admin can create quiz and user can fetch and attempt it', async () => {
  const { token: adminToken } = await registerAdminUser();
  const { token: userToken } = await registerUser();

  const createRes = await client.post('api/vocabulary/quizzes', {
    json: {
      languageCode: 'es',
      difficultyLevel: 'beginner',
      questions: [
        {
          questionText: 'What does "hola" mean?',
          options: ['Hello', 'Goodbye'],
          correctAnswerIndex: 0,
        },
        {
          questionText: 'What is "agua" in English?',
          options: ['Water', 'Fire'],
          correctAnswerIndex: 0,
        },
      ],
    },
    headers: { authorization: `Bearer ${adminToken}` },
  });

  expect(createRes.status).toBe(201);
  const createBody = await createRes.json();
  const quizId = createBody.data.id as string;

  const getRes = await client.get(`api/vocabulary/quizzes/${quizId}`);
  expect(getRes.status).toBe(200);
  const getBody = await getRes.json();
  expect(getBody.data.questions.length).toBe(2);

  const attemptRes = await client.post(`api/vocabulary/quizzes/${quizId}/attempts`, {
    json: { answers: [0, 1] },
    headers: { authorization: `Bearer ${userToken}` },
  });
  expect(attemptRes.status).toBe(201);

  const listRes = await client.get('api/vocabulary/quizzes/attempts', {
    headers: { authorization: `Bearer ${userToken}` },
  });
  expect(listRes.status).toBe(200);
  const listBody = await listRes.json();
  expect(Array.isArray(listBody.attempts)).toBe(true);
  expect(listBody.attempts.length).toBeGreaterThanOrEqual(1);
});

test('quizzes: validation error when answer count does not match questions', async () => {
  const { token: adminToken } = await registerAdminUser();
  const { token: userToken } = await registerUser();

  const createRes = await client.post('api/vocabulary/quizzes', {
    json: {
      languageCode: 'es',
      difficultyLevel: 'beginner',
      questions: [
        {
          questionText: 'What does "hola" mean?',
          options: ['Hello', 'Goodbye'],
          correctAnswerIndex: 0,
        },
      ],
    },
    headers: { authorization: `Bearer ${adminToken}` },
  });
  const createBody = await createRes.json();
  const quizId = createBody.data.id as string;

  const res = await client.post(`api/vocabulary/quizzes/${quizId}/attempts`, {
    json: { answers: [0, 1] },
    headers: { authorization: `Bearer ${userToken}` },
  });

  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error).toBe('Bad Request');
});

test('quiz generation endpoint always returns 501', async () => {
  const { token: adminToken } = await registerAdminUser();

  const res = await client.post('api/vocabulary/quizzes/generate', {
    json: {
      languageCode: 'es',
      difficultyLevel: 'beginner',
      numQuestions: 5,
    },
    headers: { authorization: `Bearer ${adminToken}` },
  });

  expect(res.status).toBe(501);
  const body = await res.json();
  expect(body.error).toBe('Not Implemented');
});

test('favorites: user can add, list, and remove vocabulary favorite', async () => {
  const { token: adminToken } = await registerAdminUser();
  const { token: userToken } = await registerUser();

  const vocabRes = await client.post('api/vocabulary', {
    json: {
      languageCode: 'es',
      difficultyLevel: 'beginner',
      word: 'hola',
      meaning: 'hello',
    },
    headers: { authorization: `Bearer ${adminToken}` },
  });
  const vocabBody = await vocabRes.json();
  const vocabId = vocabBody.data.id as string;

  const addRes = await client.post('api/vocabulary/favorites', {
    json: { itemType: 'vocabulary', itemId: vocabId },
    headers: { authorization: `Bearer ${userToken}` },
  });
  expect([200, 201]).toContain(addRes.status);

  const listRes = await client.get('api/vocabulary/favorites', {
    headers: { authorization: `Bearer ${userToken}` },
  });
  expect(listRes.status).toBe(200);
  const listBody = await listRes.json();
  expect(listBody.favorites.length).toBeGreaterThanOrEqual(1);

  const deleteRes = await client.delete(`api/vocabulary/favorites/vocabulary/${vocabId}`, {
    headers: { authorization: `Bearer ${userToken}` },
  });
  expect(deleteRes.status).toBe(200);
});

