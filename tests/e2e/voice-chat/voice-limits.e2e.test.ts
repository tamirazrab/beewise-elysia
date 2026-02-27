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

test('trial voice: session limit is enforced per device', async () => {
	const deviceId = 'trial-voice-limit-device';
	const maxSessions = env.TRIAL_VOICE_MAX_SESSIONS ?? 1;

	let sawLimit = false;

	for (let i = 0; i < maxSessions + 3; i++) {
		const res = await client.post('api/trial/voice/session', {
			json: { language_code: 'en', trial_device_id: deviceId },
		});

		if (res.status === 429) {
			const body = await res.json();
			expect(body.error).toBe('Resource Exhausted');
			expect(String(body.message)).toContain('Trial used');
			sawLimit = true;
			break;
		}
	}

	expect(sawLimit).toBe(true);
});

test('free anonymous voice: session limit is enforced per device', async () => {
	const deviceId = 'anon-voice-limit-device';
	const maxSessions = env.FREE_ANONYMOUS_VOICE_MAX_SESSIONS ?? 10;

	let sawLimit = false;

	for (let i = 0; i < maxSessions + 5; i++) {
		const res = await client.post('api/voice/session', {
			json: { language_code: 'en' },
			headers: { 'X-Device-Id': deviceId },
		});

		if (res.status === 429) {
			const body = await res.json();
			expect(body.error).toBe('Resource Exhausted');
			expect(String(body.message)).toContain('Free anonymous voice limit');
			sawLimit = true;
			break;
		}
	}

	expect(sawLimit).toBe(true);
});

test('voice limits endpoint returns structured limits for anonymous', async () => {
	const res = await client.get('api/voice/limits', {
		headers: { 'X-Device-Id': 'anon-voice-limits-device' },
	});

	expect(res.status).toBe(200);
	const body = await res.json();
	expect(typeof body.daily_minutes_limit).toBe('number');
	expect(typeof body.daily_minutes_used).toBe('number');
});

test('voice limits endpoint requires identity', async () => {
	const res = await client.get('api/voice/limits');
	expect(res.status).toBe(401);
	const body = await res.json();
	expect(body.error).toBe('Unauthorized');
});

test('paid voice: session requires auth', async () => {
	const res = await client.post('api/paid-voice/session', {
		json: { language_code: 'en' },
	});

	expect(res.status).toBe(401);
	const body = await res.json();
	expect(body.error).toBe('Unauthorized');
});

test('paid voice: authenticated user can start session', async () => {
	const { token } = await registerUser();

	const res = await client.post('api/paid-voice/session', {
		json: { language_code: 'en' },
		headers: { authorization: `Bearer ${token}` },
	});

	expect(res.status).toBe(200);
	const body = await res.json();
	expect(body.sessionId).toBeDefined();
	expect(body.wsUrl).toContain('/api/paid-voice/stream?token=');
});

test('voice: authenticated user cannot start a second active session', async () => {
	const { token } = await registerUser();

	// First session should succeed
	const first = await client.post('api/voice/session', {
		json: { language_code: 'en' },
		headers: { authorization: `Bearer ${token}` },
	});
	expect(first.status).toBe(200);

	// Second session while first is still active should be rejected
	const second = await client.post('api/voice/session', {
		json: { language_code: 'en' },
		headers: { authorization: `Bearer ${token}` },
	});

	expect([409, 429]).toContain(second.status);
	if (second.status === 409) {
		const body = await second.json();
		expect(body.error).toBe('Conflict');
	}
});

test('voice: anonymous device cannot start a second active session', async () => {
	const deviceId = 'anon-voice-single-active';

	const first = await client.post('api/voice/session', {
		json: { language_code: 'en' },
		headers: { 'X-Device-Id': deviceId },
	});
	expect(first.status).toBe(200);

	const second = await client.post('api/voice/session', {
		json: { language_code: 'en' },
		headers: { 'X-Device-Id': deviceId },
	});

	// Implementation may either reuse / treat as exhausted; we mainly assert not another 200.
	expect(second.status).not.toBe(200);
});

