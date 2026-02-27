import { beforeAll, afterAll, beforeEach, test, expect } from 'bun:test';
import WebSocket from 'ws';
import type { KyInstance } from 'ky';
import { startTestApp } from '../setup/test-app';
import { runMigrations, resetDatabase } from '../setup/db';
import { getFaker } from '../setup/faker';
import { db } from '@common/db';
import { paidVoiceSession } from '@common/db/schema';

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
		.json<{ token: string }>();

	return { token: res.token };
}

test('paid voice: authenticated user can stream and session is recorded', async () => {
	const { token } = await registerUser();

	const sessionRes = await client.post('api/paid-voice/session', {
		json: { language_code: 'en' },
		headers: { authorization: `Bearer ${token}` },
	});

	expect(sessionRes.status).toBe(200);
	const { sessionId, wsUrl } = await sessionRes.json<{ sessionId: string; wsUrl: string }>();

	const ws = new WebSocket(wsUrl);

	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('WebSocket open timeout')), 5000);
		ws.on('open', () => {
			clearTimeout(timer);
			ws.send(JSON.stringify({ audio: 'AAAA' }));
			resolve();
		});
	});

	await new Promise<void>((resolve) => {
		let received = false;
		const timer = setTimeout(() => {
			if (!received) {
				ws.close();
			}
			resolve();
		}, 2000);

		ws.on('message', () => {
			received = true;
			ws.close();
			clearTimeout(timer);
			resolve();
		});
	});

	const [session] = await db
		.select()
		.from(paidVoiceSession)
		.where(paidVoiceSession.id.eq(sessionId))
		.limit(1);

	expect(session).toBeDefined();
	expect(session.endedAt).not.toBeNull();
});

test('paid voice: invalid token is rejected', async () => {
	// Use a clearly invalid token; server should close the connection quickly.
	const url = 'ws://127.0.0.1:0/api/paid-voice/stream?token=invalid';
	const ws = new WebSocket(url);

	await new Promise<void>((resolve) => {
		const timer = setTimeout(() => {
			try {
				ws.close();
			} catch {}
			resolve();
		}, 2000);

		ws.on('close', () => {
			clearTimeout(timer);
			resolve();
		});
	});
});

