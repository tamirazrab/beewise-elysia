import { beforeAll, afterAll, test, expect } from 'bun:test';
import type { KyInstance } from 'ky';
import { startTestApp } from '../setup/test-app';
import { runMigrations } from '../setup/db';

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

test('GET / returns API metadata', async () => {
	const res = await client.get('');

	expect(res.status).toBe(200);

	const body = await res.json();

	expect(body.name).toBe('Elysia Production API');
	expect(body.docs).toBe('/docs');
	expect(body.health).toBe('/health');
});

test('GET /health returns OK status', async () => {
	const res = await client.get('health');

	expect(res.status).toBe(200);

	const body = await res.json();

	expect(body.status).toBe('ok');
});

