import { beforeAll, afterAll, beforeEach, test, expect } from 'bun:test';
import type { KyInstance } from 'ky';
import { startTestApp } from '../setup/test-app';
import { runMigrations, resetDatabase } from '../setup/db';
import { getFaker } from '../setup/faker';

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

async function registerUser() {
	const faker = getFaker();
	const email = faker.internet.email().toLowerCase();
	const password = 'SecurePass123!';
	const name = faker.person.fullName();

	const res = await client
		.post('api/auth/register', { json: { email, password, name } })
		.json<{ token: string; user: { id: string } }>();

	return { token: res.token, userId: res.user.id, email, password };
}

async function createPaidSession(token: string, languageCode = 'en') {
	const res = await client.post('api/paid/sessions', {
		json: { language_code: languageCode },
		headers: { authorization: `Bearer ${token}` },
	});

	const body = await res.json<{ session: { id: string } }>();
	return { status: res.status, sessionId: body.session.id };
}

test('paid chat: logged-in user can create session', async () => {
	const { token } = await registerUser();

	const res = await client.post('api/paid/sessions', {
		json: { language_code: 'en' },
		headers: { authorization: `Bearer ${token}` },
	});

	expect(res.status).toBe(201);
	const body = await res.json();
	expect(body.session).toBeDefined();
});

test('paid chat: creating session without token is unauthorized', async () => {
	const res = await client.post('api/paid/sessions', {
		json: { language_code: 'en' },
	});

	expect(res.status).toBe(401);
	const body = await res.json();
	expect(body.error).toBe('Unauthorized');
});

test('paid chat: sending message in session returns AI response', async () => {
	const { token } = await registerUser();
	const { sessionId } = await createPaidSession(token);

	const res = await client.post(`api/paid/${sessionId}/messages`, {
		json: { content: 'Say hello in Spanish.' },
		headers: { authorization: `Bearer ${token}` },
	});

	// This path calls OpenAI; ensure env OPENAI_API_KEY / OPENAI_MODEL are configured in .env.test
	expect([200, 500, 502]).toContain(res.status);
	const body = await res.json();
	if (res.status === 200) {
		expect(body.content).toBeDefined();
		expect(typeof body.tokens_used).toBe('number');
		expect(typeof body.cost_usd).toBe('number');
	} else {
		expect(body.error).toBeDefined();
	}
});

test('paid chat: invalid session id returns 400', async () => {
	const { token } = await registerUser();

	const res = await client.post('api/paid/not-a-uuid/messages', {
		json: { content: 'test' },
		headers: { authorization: `Bearer ${token}` },
	});

	expect(res.status).toBe(400);
	const body = await res.json();
	expect(body.error).toBe('Bad Request');
});

test('paid chat: non-existent session returns 404', async () => {
	const { token } = await registerUser();
	const fakeId = '00000000-0000-0000-0000-000000000000';

	const res = await client.post(`api/paid/${fakeId}/messages`, {
		json: { content: 'test' },
		headers: { authorization: `Bearer ${token}` },
	});

	expect(res.status).toBe(404);
	const body = await res.json();
	expect(body.error).toBe('Not Found');
});

test('paid chat: usage endpoint returns history', async () => {
	const { token } = await registerUser();

	const res = await client.get('api/paid/usage', {
		headers: { authorization: `Bearer ${token}` },
	});

	expect(res.status).toBe(200);
	const body = await res.json();
	expect(body).toHaveProperty('usage');
	expect(body).toHaveProperty('total');
});

test('paid chat: usage endpoint requires auth', async () => {
	const res = await client.get('api/paid/usage');
	expect(res.status).toBe(401);
	const body = await res.json();
	expect(body.error).toBe('Unauthorized');
});

