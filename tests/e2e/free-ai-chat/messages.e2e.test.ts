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

	return { token: res.token, email, password };
}

async function createFreeSession(token: string, languageCode = 'en') {
	const res = await client.post('api/free/sessions', {
		json: { language_code: languageCode },
		headers: { authorization: `Bearer ${token}` },
	});

	const body = await res.json<{ session: { id: string } }>();
	return { status: res.status, sessionId: body.session.id };
}

test('free chat: logged-in user can send message in active session', async () => {
	const { token } = await registerUser();
	const { sessionId } = await createFreeSession(token);

	const res = await client.post(`api/free/${sessionId}/messages`, {
		json: { content: 'How do I say hello in Spanish?' },
		headers: { authorization: `Bearer ${token}` },
	});

	expect(res.status).toBe(200);
	const body = await res.json();
	expect(body.message).toBeDefined();
	expect(body.ai_response).toBeDefined();
	expect(body.session.id).toBe(sessionId);
});

test('free chat: invalid session id returns 400', async () => {
	const { token } = await registerUser();

	const res = await client.post('api/free/not-a-uuid/messages', {
		json: { content: 'test' },
		headers: { authorization: `Bearer ${token}` },
	});

	expect(res.status).toBe(400);
	const body = await res.json();
	expect(body.error).toBe('Bad Request');
});

test('free chat: sending to non-existent session returns 404', async () => {
	const { token } = await registerUser();
	const fakeId = '00000000-0000-0000-0000-000000000000';

	const res = await client.post(`api/free/${fakeId}/messages`, {
		json: { content: 'test' },
		headers: { authorization: `Bearer ${token}` },
	});

	expect(res.status).toBe(404);
	const body = await res.json();
	expect(body.error).toBe('Not Found');
});

test('free chat: missing JWT and X-Device-Id is rejected', async () => {
	const res = await client.post('api/free/00000000-0000-0000-0000-000000000000/messages', {
		json: { content: 'test' },
	});

	expect(res.status).toBe(401);
	const body = await res.json();
	expect(body.error).toBe('Unauthorized');
});

test('free chat: anonymous device can send message', async () => {
	const sessionRes = await client.post('api/free/sessions', {
		json: { language_code: 'en' },
		headers: { 'X-Device-Id': 'anon-device-e2e' },
	});

	expect(sessionRes.status).toBe(201);
	const { session } = await sessionRes.json<{ session: { id: string } }>();

	const msgRes = await client.post(`api/free/${session.id}/messages`, {
		json: { content: 'Hello from anonymous' },
		headers: { 'X-Device-Id': 'anon-device-e2e' },
	});

	expect(msgRes.status).toBe(200);
	const body = await msgRes.json();
	expect(body.ai_response).toBeDefined();
});

test('free chat: per-request token limit violation returns 400 or 429', async () => {
	const { token } = await registerUser();
	const { sessionId } = await createFreeSession(token);

	const longContent = 'x'.repeat(50_000);

	const res = await client.post(`api/free/${sessionId}/messages`, {
		json: { content: longContent },
		headers: { authorization: `Bearer ${token}` },
	});

	expect([400, 429]).toContain(res.status);
	const body = await res.json();
	expect(['Bad Request', 'Resource Exhausted']).toContain(body.error);
});

test('free chat: unicode and XSS-like content are accepted without crashing', async () => {
	const { token } = await registerUser();
	const { sessionId } = await createFreeSession(token);

	const content = 'Привет 🌍 <script>alert("xss")</script>';

	const res = await client.post(`api/free/${sessionId}/messages`, {
		json: { content },
		headers: { authorization: `Bearer ${token}` },
	});

	expect([200, 400, 429]).toContain(res.status);
	const body = await res.json();
	if (res.status !== 200) {
		expect(typeof body.message === 'string' || typeof body.message === 'object').toBe(true);
	}
});

