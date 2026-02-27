import { beforeAll, afterAll, beforeEach, test, expect } from 'bun:test';
import type { KyInstance } from 'ky';
import { startTestApp } from '../setup/test-app';
import { runMigrations, resetDatabase } from '../setup/db';

let client: KyInstance;
let stop: () => Promise<void>;

const DEVICE_ID = 'trial-device-voice-e2e';

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

test('trial voice: happy path returns ws_url and token', async () => {
	const res = await client.post('api/trial/voice/session', {
		json: { language_code: 'en', trial_device_id: DEVICE_ID },
	});

	expect(res.status).toBe(200);
	const body = await res.json<{ session_id: string; ws_url: string; token: string }>();
	expect(body.session_id).toBeTruthy();
	expect(body.ws_url).toContain('/api/trial/voice/stream?token=');
	expect(body.token).toBeTruthy();
});

test('trial voice: missing device id is rejected', async () => {
	const res = await client.post('api/trial/voice/session', {
		json: { language_code: 'en' },
	});

	expect(res.status).toBe(400);
	const body = await res.json();
	expect(body.error).toBe('Bad Request');
	expect(String(body.message)).toContain('trial_device_id');
});

test('trial voice: unsupported language returns 400', async () => {
	const res = await client.post('api/trial/voice/session', {
		json: { language_code: 'xx', trial_device_id: DEVICE_ID },
	});

	expect(res.status).toBe(400);
	const body = await res.json();
	expect(body.error).toBe('Bad Request');
	expect(String(body.message)).toContain('Unsupported language_code');
});

