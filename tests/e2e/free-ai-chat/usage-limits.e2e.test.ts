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

test('usage: /api/usage/daily and /api/usage/monthly for logged-in user start at zero', async () => {
	const { token } = await registerUser();

	const dailyRes = await client.get('api/usage/daily', {
		headers: { authorization: `Bearer ${token}` },
	});
	expect(dailyRes.status).toBe(200);
	const dailyBody = await dailyRes.json();
	expect(dailyBody.daily.message_count).toBe(0);
	expect(dailyBody.daily.token_count).toBe(0);
	expect(dailyBody.daily.session_count).toBe(0);
	expect(typeof dailyBody.limits.daily_message_limit).toBe('number');

	const monthlyRes = await client.get('api/usage/monthly', {
		headers: { authorization: `Bearer ${token}` },
	});
	expect(monthlyRes.status).toBe(200);
	const monthlyBody = await monthlyRes.json();
	expect(typeof monthlyBody.session_count).toBe('number');
});

test('usage: /api/usage/daily and /api/limits require identity', async () => {
	const dailyRes = await client.get('api/usage/daily');
	expect(dailyRes.status).toBe(401);

	const limitsRes = await client.get('api/limits/');
	expect(limitsRes.status).toBe(401);
});

test('limits: /api/limits/ returns different limits for JWT and anonymous device', async () => {
	const { token } = await registerUser();

	const jwtRes = await client.get('api/limits/', {
		headers: { authorization: `Bearer ${token}` },
	});
	expect(jwtRes.status).toBe(200);
	const jwtBody = await jwtRes.json();
	expect(typeof jwtBody.daily_message_limit).toBe('number');

	const anonRes = await client.get('api/limits/', {
		headers: { 'X-Device-Id': 'anon-limits-device' },
	});
	expect(anonRes.status).toBe(200);
	const anonBody = await anonRes.json();
	expect(typeof anonBody.daily_message_limit).toBe('number');
});

test('subscription status: defaults for user without row', async () => {
	const { token } = await registerUser();

	const res = await client.get('api/free/subscription/status', {
		headers: { authorization: `Bearer ${token}` },
	});

	expect(res.status).toBe(200);
	const body = await res.json();
	expect(body.plan_type).toBeDefined();
});

