import { beforeAll, afterAll, beforeEach, test, expect } from 'bun:test';
import type { KyInstance } from 'ky';
import { startTestApp } from '../setup/test-app';
import { runMigrations, resetDatabase } from '../setup/db';
import { env } from '@common/config/env';

let client: KyInstance;
let stop: () => Promise<void>;

const DEVICE_ID = 'trial-device-e2e-1';

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

async function createTrialSession(deviceId = DEVICE_ID, languageCode = 'en') {
	const res = await client.post('api/trial/chat/sessions', {
		json: { language_code: languageCode, trial_device_id: deviceId },
	});

	return res;
}

test('trial chat: happy path creates session and sends message', async () => {
	const sessionRes = await createTrialSession();
	expect(sessionRes.status).toBe(200);

	const { session_id } = await sessionRes.json<{ session_id: string }>();
	expect(session_id).toBeTruthy();

	const msgRes = await client.post(`api/trial/chat/sessions/${session_id}/messages`, {
		json: { content: 'Hello, how are you?', trial_device_id: DEVICE_ID },
	});

	expect(msgRes.status).toBe(200);
	const body = await msgRes.json<{ role: string; content: string; tokens_used: number }>();
	expect(body.role).toBe('assistant');
	expect(typeof body.content).toBe('string');
	expect(body.content.length).toBeGreaterThan(0);
	expect(body.tokens_used).toBeGreaterThan(0);
});

test('trial chat: missing device id is rejected', async () => {
	const res = await client.post('api/trial/chat/sessions', {
		json: { language_code: 'en' },
	});

	expect(res.status).toBe(400);
	const body = await res.json();
	expect(body.error).toBe('Bad Request');
	expect(String(body.message)).toContain('X-Trial-Device-Id');
});

test('trial chat: unsupported language code returns 400', async () => {
	const res = await createTrialSession(DEVICE_ID, 'xx');
	expect(res.status).toBe(400);
	const body = await res.json();
	expect(body.error).toBe('Bad Request');
	expect(String(body.message)).toContain('language_code must be one of');
});

test('trial chat: sending message with missing device id is rejected', async () => {
	const sessionRes = await createTrialSession();
	const { session_id } = await sessionRes.json<{ session_id: string }>();

	const msgRes = await client.post(`api/trial/chat/sessions/${session_id}/messages`, {
		json: { content: 'Hi' },
	});

	expect(msgRes.status).toBe(400);
	const body = await msgRes.json();
	expect(body.error).toBe('Bad Request');
	expect(String(body.message)).toContain('trial_device_id');
});

test('trial chat: sending to non-existent session returns 404', async () => {
	const msgRes = await client.post('api/trial/chat/sessions/non-existent/messages', {
		json: { content: 'Hi', trial_device_id: DEVICE_ID },
	});

	expect(msgRes.status).toBe(404);
	const body = await msgRes.json();
	expect(body.error).toBe('Not Found');
});

test('trial chat: content too long returns 400', async () => {
	const sessionRes = await createTrialSession();
	const { session_id } = await sessionRes.json<{ session_id: string }>();

	const longContent = 'x'.repeat(10_000);

	const msgRes = await client.post(`api/trial/chat/sessions/${session_id}/messages`, {
		json: { content: longContent, trial_device_id: DEVICE_ID },
	});

	expect(msgRes.status).toBe(400);
	const body = await msgRes.json();
	expect(body.error).toBe('Bad Request');
});

test('trial limits: /api/trial/limits returns structured limits', async () => {
	const res = await client.get('api/trial/limits', {
		searchParams: { trial_device_id: DEVICE_ID },
	});

	expect(res.status).toBe(200);
	const body = await res.json();
	expect(body).toHaveProperty('chat_messages_remaining');
	expect(body).toHaveProperty('voice_seconds_remaining');
	expect(body).toHaveProperty('exhausted');
});

test('trial limits: missing device query is rejected', async () => {
	const res = await client.get('api/trial/limits');
	expect(res.status).toBe(400);
	const body = await res.json();
	expect(body.error).toBe('Bad Request');
});

test('trial chat: abuse from network eventually returns 429 (ip abuse)', async () => {
	let saw429 = false;

	for (let i = 0; i < 10; i++) {
		const res = await createTrialSession(`${DEVICE_ID}-${i}`);
		if (res.status === 429) {
			saw429 = true;
			const body = await res.json();
			expect(body.error).toBe('Too Many Requests');
			break;
		}
	}

	expect(saw429).toBe(true);
});

test('trial chat: per-identity message limit is enforced', async () => {
	const maxMessages = env.TRIAL_CHAT_MAX_MESSAGES ?? 5;

	const sessionRes = await createTrialSession(DEVICE_ID);
	expect(sessionRes.status).toBe(200);
	const { session_id } = await sessionRes.json<{ session_id: string }>();

	let sawLimit = false;

	for (let i = 0; i < maxMessages + 2; i++) {
		const res = await client.post(`api/trial/chat/sessions/${session_id}/messages`, {
			json: { content: 'limit test', trial_device_id: DEVICE_ID },
		});

		if (res.status === 429) {
			const body = await res.json();
			expect(body.error).toBe('Resource Exhausted');
			sawLimit = true;
			break;
		}
	}

	expect(sawLimit).toBe(true);
});

test('trial limits: reflect chat usage after sending messages', async () => {
	const sessionRes = await createTrialSession(DEVICE_ID);
	expect(sessionRes.status).toBe(200);
	const { session_id } = await sessionRes.json<{ session_id: string }>();

	// Send a couple of messages to consume part of the quota
	for (let i = 0; i < 2; i++) {
		const res = await client.post(`api/trial/chat/sessions/${session_id}/messages`, {
			json: { content: `msg ${i}`, trial_device_id: DEVICE_ID },
		});
		expect([200, 429]).toContain(res.status);
		if (res.status === 429) break;
	}

	const limitsRes = await client.get('api/trial/limits', {
		searchParams: { trial_device_id: DEVICE_ID },
	});
	expect(limitsRes.status).toBe(200);
	const limits = await limitsRes.json<{
		chat_messages_remaining: number;
		chat_session_used: boolean;
		exhausted: boolean;
	}>();

	expect(typeof limits.chat_messages_remaining).toBe('number');
	expect(limits.chat_session_used).toBe(true);
});

