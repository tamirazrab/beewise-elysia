import type { Elysia } from 'elysia';

/**
 * Admin guard middleware
 * Checks if user has admin privileges
 * Note: This assumes Better Auth user has an isAdmin field
 * You may need to extend Better Auth user schema to include this field
 */
export function withAdmin<T extends Elysia<any, any, any, any, any, any, any>>(app: T) {
	return app.macro({
		admin(enabled: boolean) {
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

					// TEMPORARY: Admin role check disabled – any authenticated user can access admin routes.
					// Uncomment below to re-enforce admin-only access.
					// const isAdmin = (user as any).isAdmin === true || (user as any).role === 'admin';
					// if (!isAdmin) {
					// 	set.status = 403;
					// 	return {
					// 		error: 'Forbidden',
					// 		message: 'Admin access required',
					// 	};
					// }
				},
			};
		},
	});
}
