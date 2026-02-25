import type { Elysia } from 'elysia';
import { getDeviceIdFromRequest, hashDeviceId } from '@common/utils/device-id';

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

/**
 * Derives user from JWT when present; otherwise derives anonymous identity from X-Device-Id header.
 * Use for free-tier routes that accept either logged-in users or anonymous (device ID).
 * Exposes: user (null if anonymous), anonymousIdHash (null if logged in), session.
 */
export function withOptionalAuth<T extends Elysia<any, any, any, any, any, any, any>>(app: T) {
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

			let anonymousIdHash: string | null = null;
			if (!user) {
				const deviceId = getDeviceIdFromRequest(request);
				if (deviceId) {
					anonymousIdHash = hashDeviceId(deviceId);
				}
			}

			return {
				user,
				anonymousIdHash,
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
			/** Requires either JWT (user) or X-Device-Id (anonymousIdHash). Use for free-tier routes. */
			freeIdentity(enabled: boolean) {
				if (!enabled) return;
				return {
					beforeHandle: async ({ user, anonymousIdHash, set }: any) => {
						if (!user && !anonymousIdHash) {
							set.status = 401;
							return {
								error: 'Unauthorized',
								message: 'Send Authorization: Bearer <token> or X-Device-Id header to identify yourself.',
							};
						}
					},
				};
			},
		});
}
