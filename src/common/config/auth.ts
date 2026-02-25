import { db } from '@common/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sendEmail } from './email';
import { env } from './env';

/**
 * Better Auth: sign-up, sign-in (email + social), password reset, sessions.
 * Used only for login flows (and social OAuth). API auth uses @elysiajs/jwt:
 * after sign-in, call GET /api/auth/jwt to exchange session for a JWT.
 */
export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: 'pg',
	}),
	user: {
		additionalFields: {
			role: {
				type: 'string',
				required: false,
			},
		},
	},
	trustedOrigins: env.CORS_ORIGIN,
	emailAndPassword: {
		enabled: true,
		minPasswordLength: 8,
		maxPasswordLength: 128,
		requireEmailVerification: env.REQUIRE_EMAIL_VERIFICATION,

		// Password reset - enables /api/auth/request-password-reset endpoint
		sendResetPassword: async ({ user, url, token: _token }, _request) => {
			await sendEmail({
				to: user.email,
				subject: 'Reset your password',
				text: `Click the link to reset your password: ${url}`,
				html: `
					<h2>Reset Your Password</h2>
					<p>Click the link below to reset your password:</p>
					<a href="${url}">Reset Password</a>
					<p>This link will expire in 1 hour.</p>
					<p>If you didn't request this, please ignore this email.</p>
				`,
			});
		},

		// Optional hook after password reset (extend for logging, notifications, etc.)
		onPasswordReset: async ({ user: _user }, _request) => {},
	},
	// Email verification (separate from emailAndPassword)
	emailVerification: {
		sendVerificationEmail: async ({ user, url, token: _token }, _request) => {
			await sendEmail({
				to: user.email,
				subject: 'Verify your email address',
				text: `Click the link to verify your email: ${url}`,
				html: `
					<h2>Verify Your Email</h2>
					<p>Click the link below to verify your email address:</p>
					<a href="${url}">Verify Email</a>
				`,
			});
		},
	},
	socialProviders: {
		google: env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
			? {
					clientId: env.GOOGLE_CLIENT_ID,
					clientSecret: env.GOOGLE_CLIENT_SECRET,
				}
			: undefined,
		apple: env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY
			? {
					clientId: env.APPLE_CLIENT_ID,
					teamId: env.APPLE_TEAM_ID,
					keyId: env.APPLE_KEY_ID,
					privateKey: env.APPLE_PRIVATE_KEY,
				}
			: undefined,
	},
	session: {
		expiresIn: 60 * 60 * 24 * 7, // 7 days
		updateAge: 60 * 60 * 24, // 1 day
	},
	secret: env.BETTER_AUTH_SECRET!,
	baseURL: env.BETTER_AUTH_URL,
	advanced: {
		cookiePrefix: 'auth',
		useSecureCookies: env.APP_ENV === 'staging' || env.APP_ENV === 'production',
	},
});
