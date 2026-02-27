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

	// Upgrade role to admin directly in DB
	await db
		.update(userTable)
		.set({ role: 'admin' })
		.where(userTable.id.eq(registerRes.user.id));

	// Login again to get token with admin role in payload
	const loginRes = await client
		.post('api/auth/login', { json: { email, password } })
		.json<{ token: string }>();

	return { token: loginRes.token };
}

test('vocabulary: list returns empty array initially', async () => {
	const res = await client.get('api/vocabulary');
	expect(res.status).toBe(200);
	const body = await res.json();
	expect(body.items).toEqual([]);
	expect(body.total).toBe(0);
});

test('vocabulary: admin can create and retrieve item', async () => {
	const { token } = await registerAdminUser();

	const createRes = await client.post('api/vocabulary', {
		json: {
			languageCode: 'es',
			difficultyLevel: 'beginner',
			word: 'hola',
			meaning: 'hello',
		},
		headers: { authorization: `Bearer ${token}` },
	});

	expect(createRes.status).toBe(201);
	const createBody = await createRes.json();
	const id = createBody.data.id as string;

	const getRes = await client.get(`api/vocabulary/${id}`);
	expect(getRes.status).toBe(200);
	const getBody = await getRes.json();
	expect(getBody.data.word).toBe('hola');
});

test('vocabulary: non-admin user cannot create item', async () => {
	const faker = getFaker();
	const email = faker.internet.email().toLowerCase();
	const password = 'SecurePass123!';
	const name = faker.person.fullName();

	const registerRes = await client
		.post('api/auth/register', { json: { email, password, name } })
		.json<{ token: string }>();

	const res = await client.post('api/vocabulary', {
		json: {
			languageCode: 'es',
			difficultyLevel: 'beginner',
			word: 'hola',
			meaning: 'hello',
		},
		headers: { authorization: `Bearer ${registerRes.token}` },
	});

	expect(res.status).toBe(403);
	const body = await res.json();
	expect(body.error).toBe('Forbidden');
});

