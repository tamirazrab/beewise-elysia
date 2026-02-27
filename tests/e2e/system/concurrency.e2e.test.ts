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

test('concurrent health checks all succeed', async () => {
	const requests = Array.from({ length: 10 }, () => client.get('health'));

	const responses = await Promise.all(requests);

	for (const res of responses) {
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe('ok');
	}
});

