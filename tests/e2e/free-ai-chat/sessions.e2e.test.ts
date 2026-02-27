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
		.post('api/auth/register', {
			json: { email, password, name },
		})
		.json<{ token: string; user: { id: string } }>();

	return { token: res.token, userId: res.user.id, email, password };
}

test('logged-in user can create free chat session', async () => {
	const { token } = await registerUser();

	const res = await client.post('api/free/sessions', {
		json: { language_code: 'es' },
		headers: {
			authorization: `Bearer ${token}`,
		},
	});

	expect(res.status).toBe(201);
	const body = await res.json();
	expect(body.session).toBeDefined();
	expect(body.session.languageCode).toBe('es');
	expect(body.session.status).toBe('active');
});

test('invalid language_code returns 400 with structured error', async () => {
	const { token } = await registerUser();

const res = await client.post('api/free/sessions', {
		json: { language_code: 'xx' },
		headers: {
			authorization: `Bearer ${token}`,
		},
	});

	expect(res.status).toBe(400);
	const body = await res.json();
	expect(body.error).toBe('Invalid language_code');
});

test('anonymous client can create session with X-Device-Id', async () => {
	const res = await client.post('api/free/sessions', {
		json: { language_code: 'en' },
		headers: {
			'X-Device-Id': 'device-e2e-123',
		},
	});

	expect(res.status).toBe(201);
	const body = await res.json();
	expect(body.session).toBeDefined();
	expect(body.session.languageCode).toBe('en');
});

test('missing JWT and X-Device-Id is rejected by freeIdentity guard', async () => {
	const res = await client.post('api/free/sessions', {
		json: { language_code: 'en' },
	});

	expect(res.status).toBe(401);
	const body = await res.json();
	expect(body.error).toBe('Unauthorized');
	expect(String(body.message)).toContain('X-Device-Id');
});

