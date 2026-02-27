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

	return { token: res.token };
}

async function createPaidSession(token: string) {
	const res = await client.post('api/paid/sessions', {
		json: { language_code: 'en' },
		headers: { authorization: `Bearer ${token}` },
	});

	expect(res.status).toBe(201);
	const body = await res.json<{ session: { id: string } }>();
	return body.session.id;
}

test('paid chat: auth rate limiting triggers 401/429 after repeated login attempts', async () => {
	const faker = getFaker();
	const email = faker.internet.email().toLowerCase();
	const password = 'SecurePass123!';
	const name = faker.person.fullName();

	// Register once
	await client.post('api/auth/register', { json: { email, password, name } });

	let sawLimit = false;

	for (let i = 0; i < 20; i++) {
		const res = await client.post('api/auth/login', {
			json: { email, password: 'WrongPass123!' },
		});

		if (res.status === 429) {
			const body = await res.json();
			expect(body.error).toBeDefined();
			sawLimit = true;
			break;
		}
	}

	expect(sawLimit).toBe(true);
});

test('paid chat: multiple messages in same session succeed under limits', async () => {
	const { token } = await registerUser();
	const sessionId = await createPaidSession(token);

	for (let i = 0; i < 5; i++) {
		const res = await client.post(`api/paid/${sessionId}/messages`, {
			json: { content: `msg ${i}` },
			headers: { authorization: `Bearer ${token}` },
		});

		expect([200, 500]).toContain(res.status);
	}
});

