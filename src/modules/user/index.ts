import { db } from '@common/db';
import { user as userTable } from '@common/db/schema/auth';
import { withAuth } from '@common/middleware/auth-guard';
import { Elysia, t } from 'elysia';
import { eq } from 'drizzle-orm';

/**
 * User Module
 *
 * Provides self-service user profile APIs:
 * - Get current user profile
 * - Update current user profile
 *
 * All routes are authenticated with JWT and operate only on the
 * currently authenticated user (no cross-user updates).
 */

const updateUserSchema = t.Object({
	name: t.Optional(t.String({ minLength: 1, description: 'Display name of the user' })),
	image: t.Optional(
		t.Nullable(
			t.String({
				description: 'Optional avatar/profile image URL',
			}),
		),
	),
});

export const userModule = withAuth(new Elysia({ prefix: '/api/users' }))
	// GET /api/users/me - Get current user profile
	.get(
		'/me',
		async ({ user, set }: any) => {
			if (!user) {
				set.status = 401;
				return { error: 'Unauthorized', message: 'Please login first' };
			}

			const [foundUser] = await db
				.select({
					id: userTable.id,
					name: userTable.name,
					email: userTable.email,
					image: userTable.image,
					emailVerified: userTable.emailVerified,
					role: userTable.role,
					createdAt: userTable.createdAt,
					updatedAt: userTable.updatedAt,
				})
				.from(userTable)
				.where(eq(userTable.id, user.id))
				.limit(1);

			if (!foundUser) {
				set.status = 404;
				return { error: 'Not Found', message: 'User not found' };
			}

			return { user: foundUser };
		},
		{
			auth: true,
			detail: {
				tags: ['Users'],
				summary: 'Get current user profile',
				description:
					'Returns the profile of the currently authenticated user. Requires **Authorization: Bearer &lt;token&gt;**.',
			},
		},
	)

	// PATCH /api/users/me - Update current user profile
	.patch(
		'/me',
		async ({ user, body, set }: any) => {
			if (!user) {
				set.status = 401;
				return { error: 'Unauthorized', message: 'Please login first' };
			}

			const updates: {
				name?: string;
				image?: string | null;
				updatedAt: Date;
			} = {
				updatedAt: new Date(),
			};

			let hasChanges = false;

			if (Object.prototype.hasOwnProperty.call(body, 'name')) {
				updates.name = typeof body.name === 'string' ? body.name.trim() : body.name;
				hasChanges = true;
			}

			if (Object.prototype.hasOwnProperty.call(body, 'image')) {
				updates.image = body.image ?? null;
				hasChanges = true;
			}

			if (!hasChanges) {
				return { message: 'No changes provided' };
			}

			const [updatedUser] = await db
				.update(userTable)
				.set(updates)
				.where(eq(userTable.id, user.id))
				.returning({
					id: userTable.id,
					name: userTable.name,
					email: userTable.email,
					image: userTable.image,
					emailVerified: userTable.emailVerified,
					role: userTable.role,
					createdAt: userTable.createdAt,
					updatedAt: userTable.updatedAt,
				});

			if (!updatedUser) {
				set.status = 404;
				return { error: 'Not Found', message: 'User not found' };
			}

			return { user: updatedUser };
		},
		{
			auth: true,
			body: updateUserSchema,
			detail: {
				tags: ['Users'],
				summary: 'Update current user profile',
				description:
					'Update the profile of the currently authenticated user. Only `name` and `image` can be changed. ' +
					'This route always updates the authenticated user and never allows updating other users.',
				requestBody: {
					content: {
						'application/json': {
							example: {
								name: 'Alice Smith',
								image: 'https://example.com/avatar.png',
							},
						},
					},
				},
			},
		},
	);

