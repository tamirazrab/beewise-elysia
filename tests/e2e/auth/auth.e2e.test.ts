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
		.json<{ token: string; user: { id: string; email: string } }>();

	return { email, password, token: res.token, userId: res.user.id };
}

test('register then login returns JWT and grants access to protected route', async () => {
	const { email, password } = await registerUser();

	const loginRes = await client
		.post('api/auth/login', {
			json: { email, password },
		})
		.json<{ token: string }>();

	expect(loginRes.token).toBeDefined();

	const protectedRes = await client.get('api/free/subscription/status', {
		headers: {
			authorization: `Bearer ${loginRes.token}`,
		},
	});

	expect(protectedRes.status).toBe(200);
	const protectedBody = await protectedRes.json();
	expect(protectedBody).toHaveProperty('plan_type');
});

test('login with wrong password fails with 401', async () => {
	const { email } = await registerUser();

	const res = await client.post('api/auth/login', {
		json: { email, password: 'WrongPass123!' },
	});

	expect(res.status).toBe(401);
	const body = await res.json();
	expect(body.error).toBe('Unauthorized');
});

test('login validation error on missing fields', async () => {
	const res = await client.post('api/auth/login', {
		json: { password: 'no-email@example.com' },
	});

	expect(res.status).toBe(400);
	const body = await res.json();
	expect(body.error).toBe('Validation error');
});

test('protected route rejects missing and malformed tokens', async () => {
	const resNoToken = await client.get('api/free/subscription/status');
	expect(resNoToken.status).toBe(401);
	const noTokenBody = await resNoToken.json();
	expect(noTokenBody.error).toBe('Unauthorized');

	const resBadToken = await client.get('api/free/subscription/status', {
		headers: {
			authorization: 'Bearer invalid.token.value',
		},
	});
	expect(resBadToken.status).toBe(401);
	const badTokenBody = await resBadToken.json();
	expect(badTokenBody.error).toBe('Unauthorized');
});

