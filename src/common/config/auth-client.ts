import { createAuthClient } from 'better-auth/client';
import { emailOTPClient } from 'better-auth/client/plugins';

/**
 * Stored JWT for API calls (set after calling GET /api/auth/jwt).
 */
let storedJwt: string | null = null;

export function getStoredJwt(): string | null {
	return storedJwt;
}

export function setStoredJwt(token: string | null): void {
	storedJwt = token;
}

/**
 * Better Auth client for sign-up and sign-in (email + social). For API consumers:
 * use **POST /api/auth/login** with { email, password } to get { token } and use it as Authorization: Bearer <token>.
 */
export const authClient = createAuthClient({
	plugins: [emailOTPClient()],
	fetchOptions: {
		auth: {
			type: 'Bearer',
			token: () => getStoredJwt() ?? '',
		},
	},
});
