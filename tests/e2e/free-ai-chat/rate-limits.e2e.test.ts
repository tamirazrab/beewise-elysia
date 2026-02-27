import { beforeAll, afterAll, beforeEach, test, expect } from 'bun:test';
import type { KyInstance } from 'ky';
import { startTestApp } from '../setup/test-app';
import { runMigrations, resetDatabase } from '../setup/db';
import { getFaker } from '../setup/faker';
import { env } from '@common/config/env';

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

async function createSessionAndMessage(token: string) {
	const sessionRes = await client.post('api/free/sessions', {
		json: { language_code: 'en' },
		headers: { authorization: `Bearer ${token}` },
	});
	expect(sessionRes.status).toBe(201);
	const { session } = await sessionRes.json<{ session: { id: string } }>();

	const msgRes = await client.post(`api/free/${session.id}/messages`, {
		json: { content: 'test message' },
		headers: { authorization: `Bearer ${token}` },
	});

	return msgRes;
}

test('free chat: daily message limit is enforced for logged-in user', async () => {
	const { token } = await registerUser();

	const maxMessages = env.DAILY_MESSAGE_LIMIT
		? Number(env.DAILY_MESSAGE_LIMIT)
		: 5;

	let lastStatus = 200;

	for (let i = 0; i < maxMessages + 2; i++) {
		const res = await createSessionAndMessage(token);
		lastStatus = res.status;
		if (res.status === 429) {
			const body = await res.json();
			expect(body.error).toBe('Resource Exhausted');
			expect(String(body.message)).toContain('Daily message limit');
			break;
		}
	}

	expect(lastStatus).toBe(429);
});

test('free chat: daily token limit is enforced for logged-in user', async () => {
	const { token } = await registerUser();

	const maxTokens = env.DAILY_TOKEN_LIMIT
		? Number(env.DAILY_TOKEN_LIMIT)
		: 1000;

	const content = 'x'.repeat(200); // ~50 tokens per message

	let accumulated = 0;
	let sawLimit = false;

	while (accumulated <= maxTokens * 2) {
		const sessionRes = await client.post('api/free/sessions', {
			json: { language_code: 'en' },
			headers: { authorization: `Bearer ${token}` },
		});
		if (sessionRes.status !== 201) break;
		const { session } = await sessionRes.json<{ session: { id: string } }>();

		const res = await client.post(`api/free/${session.id}/messages`, {
			json: { content },
			headers: { authorization: `Bearer ${token}` },
		});

		if (res.status === 429) {
			const body = await res.json();
			expect(body.error).toBe('Resource Exhausted');
			expect(String(body.message)).toContain('Daily token limit');
			sawLimit = true;
			break;
		}

		accumulated += content.length;
	}

	expect(sawLimit).toBe(true);
});

test('free anonymous chat: session limit is enforced', async () => {
	const deviceId = 'anon-limit-device';
	const maxSessions = env.FREE_ANONYMOUS_CHAT_MAX_SESSIONS ?? 20;

	let sawLimit = false;

	for (let i = 0; i < maxSessions + 5; i++) {
		const res = await client.post('api/free/sessions', {
			json: { language_code: 'en' },
			headers: { 'X-Device-Id': deviceId },
		});

		if (res.status === 429) {
			const body = await res.json();
			expect(body.error).toBe('Resource Exhausted');
			expect(String(body.message)).toContain('Free anonymous session limit');
			sawLimit = true;
			break;
		}
	}

	expect(sawLimit).toBe(true);
});

test('free anonymous chat: message limit is enforced', async () => {
	const deviceId = 'anon-message-limit-device';
	const maxMessages = env.FREE_ANONYMOUS_CHAT_MAX_MESSAGES ?? 200;

	const sessionRes = await client.post('api/free/sessions', {
		json: { language_code: 'en' },
		headers: { 'X-Device-Id': deviceId },
	});
	expect(sessionRes.status).toBe(201);
	const { session } = await sessionRes.json<{ session: { id: string } }>();

	let sawLimit = false;

	for (let i = 0; i < maxMessages + 5; i++) {
		const res = await client.post(`api/free/${session.id}/messages`, {
			json: { content: `msg-${i}` },
			headers: { 'X-Device-Id': deviceId },
		});

		if (res.status === 429) {
			const body = await res.json();
			expect(body.error).toBe('Resource Exhausted');
			expect(String(body.message)).toContain('Free anonymous message limit');
			sawLimit = true;
			break;
		}
	}

	expect(sawLimit).toBe(true);
});

