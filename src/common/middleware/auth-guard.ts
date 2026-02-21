import type { Elysia } from 'elysia';

/**
 * Derives user from JWT (Authorization: Bearer <token>).
 * Uses @elysiajs/jwt. Call this in your module before defining routes.
 */
export function withAuth<T extends Elysia<any, any, any, any, any, any, any>>(app: T) {
	return app
		.derive(async ({ request, jwt }) => {
			const authHeader = request.headers.get('authorization');
			const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
			const payload = token ? await jwt.verify(token) : null;

			const user = payload && typeof payload === 'object' && 'sub' in payload
				? {
						id: String((payload as { sub?: string }).sub),
						email: String((payload as { email?: string }).email ?? ''),
						role: (payload as { role?: string }).role ?? undefined,
					}
				: null;

			return {
				user,
				session: null as { id: string } | null,
			};
		})
		.macro({
			auth(enabled: boolean) {
				if (!enabled) return;

				return {
					beforeHandle: async ({ user, set }: any) => {
						if (!user) {
							set.status = 401;
							return {
								error: 'Unauthorized',
								message: 'Please login first',
							};
						}
					},
				};
			},
		});
}
