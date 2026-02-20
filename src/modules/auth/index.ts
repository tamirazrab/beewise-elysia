import { auth } from '@common/config/auth';
import { Elysia } from 'elysia';

/**
 * Authentication routes powered by Better Auth.
 *
 * You typically do not need to modify this file.
 * Customize auth behavior via Better Auth configuration instead.
 *
 * @see https://better-auth.com/docs
 */

export const authModule = new Elysia({ prefix: '/api/auth' })
	// Sign Up with Email
	.post('/sign-up/email', ({ request }) => auth.handler(request), {
		detail: {
			tags: ['Auth'],
			summary: 'Register with email',
			description:
				'Register a new user. Requires email, password, and name.\n\n' +
				'**Request Body (JSON):**\n' +
				'- `email` (string, required)\n' +
				'- `password` (string, required)\n' +
				'- `name` (string, required)\n' +
				'- `image` (string, optional)\n' +
				'- `callbackURL` (string, optional)',
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
	// Sign In with Email
	.post('/sign-in/email', ({ request }) => auth.handler(request), {
		detail: {
			tags: ['Auth'],
			summary: 'Login with email',
			description:
				'Authenticate and start a session using email and password. On success, the response sets a session cookie; use the same origin (e.g. /docs on this host) when calling protected routes so the cookie is sent.',
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
	// Sign Out
	.post('/sign-out', ({ request }) => auth.handler(request), {
		detail: {
			tags: ['Auth'],
			summary: 'Logout',
			description: 'End the current user session. Requires active session cookie.',
		},
	})
	// Get Session
	.get('/get-session', ({ request }) => auth.handler(request), {
		detail: {
			tags: ['Auth'],
			summary: 'Get current session',
			description:
				"Retrieve the authenticated user's session information.\n\n" +
				'Returns user data and session details if authenticated, or null if not authenticated.',
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
