import { auth } from '@common/config/auth';
import { db } from '@common/db';
import { account, user } from '@common/db/schema/auth';
import { hashDeviceId } from '@common/utils/device-id';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { and, eq } from 'drizzle-orm';
import { Elysia, t } from 'elysia';
import { migrateAnonymousDataToUser } from './migrate-anonymous';

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

/**
 * Auth routes: register/login return JWT + user; sign-up and social via Better Auth.
 */

const loginBody = t.Object({
	email: t.String({ format: 'email' }),
	password: t.String({ minLength: 1 }),
	device_id: t.Optional(t.String({ description: 'Anonymous device ID to link and migrate data' })),
});

const registerBody = t.Object({
	email: t.String({ format: 'email' }),
	password: t.String({ minLength: MIN_PASSWORD_LENGTH, maxLength: MAX_PASSWORD_LENGTH }),
	name: t.String({ minLength: 1 }),
	image: t.Optional(t.String()),
	device_id: t.Optional(t.String({ description: 'Anonymous device ID to link and migrate data' })),
});

export const authModule = new Elysia({ prefix: '/api/auth' })
	// Login: email + password → JWT (no cookie/session). Use this token as Authorization: Bearer <token>.
	.post(
		'/login',
		async ({ body, jwt, set }) => {
			const [foundUser] = await db
				.select()
				.from(user)
				.where(eq(user.email, body.email))
				.limit(1);
			if (!foundUser) {
				set.status = 401;
				return { error: 'Unauthorized', message: 'Invalid email or password' };
			}
			const [credentialAccount] = await db
				.select({ password: account.password })
				.from(account)
				.where(and(eq(account.userId, foundUser.id), eq(account.providerId, 'credential')))
				.limit(1);
			const passwordHash = credentialAccount?.password;
			if (!passwordHash) {
				set.status = 401;
				return { error: 'Unauthorized', message: 'Invalid email or password' };
			}
			try {
				const valid = await verifyPassword({ password: body.password, hash: passwordHash });
				if (!valid) {
					set.status = 401;
					return { error: 'Unauthorized', message: 'Invalid email or password' };
				}
			} catch {
				set.status = 401;
				return { error: 'Unauthorized', message: 'Invalid email or password' };
			}
			if (body.device_id?.trim() && !foundUser.linkedAnonymousIdHash) {
				const anonymousIdHash = hashDeviceId(body.device_id.trim());
				await db
					.update(user)
					.set({ linkedAnonymousIdHash: anonymousIdHash, updatedAt: new Date() })
					.where(eq(user.id, foundUser.id));
				await migrateAnonymousDataToUser(anonymousIdHash, foundUser.id);
			}

			const token = await jwt.sign({
				sub: foundUser.id,
				email: foundUser.email,
				role: foundUser.role ?? undefined,
			});
			const userResponse = {
				id: foundUser.id,
				name: foundUser.name,
				email: foundUser.email,
				image: foundUser.image ?? null,
				emailVerified: foundUser.emailVerified,
				role: foundUser.role ?? null,
			};
			return { token, user: userResponse };
		},
		{
			body: loginBody,
			detail: {
				tags: ['Auth'],
				summary: 'Login (get JWT)',
				description:
					'Authenticate with email and password. Returns **{ "token", "user" }**. No cookie or session. ' +
					'Use the token as **Authorization: Bearer &lt;token&gt;** on all protected routes.',
				requestBody: {
					content: {
						'application/json': {
							example: { email: 'alice@example.com', password: 'SecurePass123!' },
						},
					},
				},
			},
		},
	)
	// Register: create user + credential account, return JWT + user (same as login response).
	.post(
		'/register',
		async ({ body, jwt, set }) => {
			const emailLower = body.email.toLowerCase().trim();
			const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, emailLower)).limit(1);
			if (existing) {
				set.status = 422;
				return { error: 'Unprocessable Entity', message: 'User already exists with this email' };
			}
			const userId = globalThis.crypto.randomUUID();
			const accountId = globalThis.crypto.randomUUID();
			const passwordHash = await hashPassword(body.password);
			const anonymousIdHash = body.device_id?.trim() ? hashDeviceId(body.device_id.trim()) : null;

			await db.insert(user).values({
				id: userId,
				name: body.name.trim(),
				email: emailLower,
				emailVerified: false,
				image: body.image ?? null,
				role: 'user',
				linkedAnonymousIdHash: anonymousIdHash ?? undefined,
			});
			await db.insert(account).values({
				id: accountId,
				accountId: userId,
				providerId: 'credential',
				userId,
				password: passwordHash,
			});
			if (anonymousIdHash) {
				await migrateAnonymousDataToUser(anonymousIdHash, userId);
			}
			const token = await jwt.sign({
				sub: userId,
				email: emailLower,
				role: 'user',
			});
			const userResponse = {
				id: userId,
				name: body.name.trim(),
				email: emailLower,
				image: body.image ?? null,
				emailVerified: false,
				role: 'user' as string | null,
			};
			return { token, user: userResponse };
		},
		{
			body: registerBody,
			detail: {
				tags: ['Auth'],
				summary: 'Register (get JWT)',
				description:
					'Create a new user. Returns **{ "token", "user" }** (same as login). No cookie or session. Use the token as **Authorization: Bearer &lt;token&gt;** on protected routes.',
				requestBody: {
					content: {
						'application/json': {
							example: {
								email: 'alice@example.com',
								password: 'SecurePass123!',
								name: 'Alice Smith',
							},
						},
					},
				},
			},
		},
	)
	// Sign Up with Email (Better Auth – alternative; for JWT use POST /api/auth/register)
	.post('/sign-up/email', ({ request }) => auth.handler(request), {
		detail: {
			tags: ['Auth'],
			summary: 'Register with email (Better Auth)',
			description:
				'Better Auth sign-up (session/cookie). For JWT response use **POST /api/auth/register** instead.',
			requestBody: {
				content: {
					'application/json': {
						example: {
							email: 'alice@example.com',
							password: 'SecurePass123!',
							name: 'Alice Smith',
							callbackURL: '/',
						},
					},
				},
			},
		},
	})
	// Sign In with Email (Better Auth – optional; for web/social. API consumers use POST /login.)
	.post('/sign-in/email', ({ request }) => auth.handler(request), {
		detail: {
			tags: ['Auth'],
			summary: 'Sign in with email (Better Auth session)',
			description: 'Creates a session (cookie). For API consumers use **POST /api/auth/login** instead to get a JWT directly.',
			requestBody: {
				content: {
					'application/json': {
						example: {
							email: 'alice@example.com',
							password: 'SecurePass123!',
							callbackURL: '/',
						},
					},
				},
			},
		},
	})
	// Sign Out (Better Auth session)
	.post('/sign-out', ({ request }) => auth.handler(request), {
		detail: {
			tags: ['Auth'],
			summary: 'Sign out (clear session cookie)',
			description: 'Only relevant when using Better Auth session (sign-in).',
		},
	})
	// Get Session (Better Auth – cookie)
	.get('/get-session', ({ request }) => auth.handler(request), {
		detail: {
			tags: ['Auth'],
			summary: 'Get current session',
			description: 'Returns user/session if request has a valid session cookie. For API use JWT from POST /login.',
		},
	})
	// Request Password Reset
	.post('/request-password-reset', ({ request }) => auth.handler(request), {
		detail: {
			tags: ['Auth'],
			summary: 'Request password reset',
			description:
				'Send a password reset link to the user’s email.\n\n' +
				'**Request Body (JSON):**\n' +
				'- `email` (string, required)\n' +
				'- `redirectTo` (string, optional)',
			requestBody: {
				content: {
					'application/json': {
						example: {
							email: 'alice@example.com',
							redirectTo: '/reset-password',
						},
					},
				},
			},
		},
	})
	// Reset Password (after clicking link in email)
	.post('/reset-password', ({ request }) => auth.handler(request), {
		detail: {
			tags: ['Auth'],
			summary: 'Reset password with token',
			description:
				'Reset user password using token from email link.\n\n' +
				'**Request Body (JSON):**\n' +
				'- `token` (string, required)\n' +
				'- `newPassword` (string, required)',
			requestBody: {
				content: {
					'application/json': {
						example: {
							token: 'your-reset-token-from-email',
							newPassword: 'NewSecurePass456!',
						},
					},
				},
			},
		},
	})
	// Catch-all for other Better Auth routes
	.all('/*', ({ request }) => auth.handler(request));
