import { withAuth } from '@common/middleware/auth-guard';
import { Elysia, t } from 'elysia';
import { db } from '@common/db';
import { paidAISession, paidAIUsage } from '@common/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import * as service from './service';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUUID(id: string, paramName: string = 'id'): void {
	if (!id || typeof id !== 'string') {
		throw new Error(`${paramName} is required`);
	}
	if (id === ':id' || id.startsWith(':')) {
		throw new Error(
			`Invalid ${paramName}: "${id}". The path parameter must be replaced with an actual UUID value.`,
		);
	}
	if (!UUID_REGEX.test(id)) {
		throw new Error(`${paramName} must be a valid UUID format. Received: "${id}"`);
	}
}

/**
 * Paid AI Chat Module
 * Handles paid-tier AI chat sessions and usage tracking
 */
export const paidAIChatModule = withAuth(new Elysia({ prefix: '/api/paid' }))
	// POST /api/paid/sessions - Create session
	.post(
		'/sessions',
		async ({ body, user, set }: any) => {
			if (!user) {
				set.status = 401;
				return { error: 'Unauthorized', message: 'Please login first' };
			}

			const [session] = await db
				.insert(paidAISession)
				.values({
					userId: user.id,
					languageCode: body.language_code,
				})
				.returning();

			if (!session) {
				set.status = 500;
				return { error: 'Internal Server Error', message: 'Failed to create session' };
			}

			set.status = 201;
			return { session };
		},
		{
			auth: true,
			body: t.Object({
				language_code: t.String({
					description: 'ISO 639-1 language code (e.g. en, es, fr)',
					default: 'es',
				}),
			}),
			detail: {
				tags: ['Paid AI Chat'],
				summary: 'Create session',
				description: 'Authenticated. Create a new paid-tier conversation session. Body prefilled with example.',
				requestBody: {
					content: {
						'application/json': {
							example: { language_code: 'es' },
						},
					},
				},
			},
		},
	)

	// POST /api/paid/sessions/:id/messages - Send message
	.post(
		'/:id/messages',
		async ({ params, body, user, set }: any) => {
			if (!user) {
				set.status = 401;
				return { error: 'Unauthorized', message: 'Please login first' };
			}

			try {
				validateUUID(params.id, 'session id');
			} catch (error: any) {
				set.status = 400;
				return { error: 'Bad Request', message: error.message };
			}

			const [session] = await db
				.select()
				.from(paidAISession)
				.where(and(eq(paidAISession.id, params.id), eq(paidAISession.userId, user.id)))
				.limit(1);

			if (!session) {
				set.status = 404;
				return { error: 'Not Found', message: 'Session not found' };
			}

			const messages = [
				{ role: 'system' as const, content: service.SYSTEM_PROMPT },
				{ role: 'user' as const, content: body.content },
			];

			const openaiResponse = await service.invokeOpenAI(messages);

			await db
				.update(paidAISession)
				.set({ lastMessageAt: new Date() })
				.where(eq(paidAISession.id, session.id));

			await db.insert(paidAIUsage).values({
				userId: user.id,
				sessionId: session.id,
				tokensUsed: openaiResponse.tokensUsed,
				costUsd: openaiResponse.costUsd.toString(),
			});

			const [updatedSession] = await db
				.select()
				.from(paidAISession)
				.where(eq(paidAISession.id, session.id))
				.limit(1);

			if (!updatedSession) {
				set.status = 500;
				return { error: 'Internal Server Error', message: 'Failed to update session' };
			}

			return {
				content: openaiResponse.content,
				tokens_used: openaiResponse.tokensUsed,
				cost_usd: openaiResponse.costUsd,
				session: updatedSession,
			};
		},
		{
			auth: true,
			params: t.Object({
				id: t.String(),
			}),
			body: t.Object({
				content: t.String({
					description: 'User message to send to the AI',
					default: "What are some common Spanish greetings?",
				}),
			}),
			detail: {
				tags: ['Paid AI Chat'],
				summary: 'Send message',
				description: 'Authenticated. Send a message in a paid session. Body prefilled with example.',
				requestBody: {
					content: {
						'application/json': {
							example: { content: "What are some common Spanish greetings?" },
						},
					},
				},
			},
		},
	)

	// GET /api/paid/sessions/:id - Get session
	.get(
		'/:id',
		async ({ params, user, set }: any) => {
			if (!user) {
				set.status = 401;
				return { error: 'Unauthorized', message: 'Please login first' };
			}

			try {
				validateUUID(params.id, 'session id');
			} catch (error: any) {
				set.status = 400;
				return { error: 'Bad Request', message: error.message };
			}

			const [session] = await db
				.select()
				.from(paidAISession)
				.where(and(eq(paidAISession.id, params.id), eq(paidAISession.userId, user.id)))
				.limit(1);

			if (!session) {
				set.status = 404;
				return { error: 'Not Found', message: 'Session not found' };
			}

			return session;
		},
		{
			auth: true,
			params: t.Object({
				id: t.String(),
			}),
			detail: {
				tags: ['Paid AI Chat'],
				summary: 'Get session',
				description: 'Get a specific paid conversation session',
			},
		},
	);

// Usage endpoint
export const paidUsageModule = withAuth(new Elysia({ prefix: '/api/paid' }))
	.get(
		'/usage',
		async ({ query, user, set }: any) => {
			if (!user) {
				set.status = 401;
				return { error: 'Unauthorized', message: 'Please login first' };
			}

			const limit = query.limit ? Number(query.limit) : 20;
			const offset = query.offset ? Number(query.offset) : 0;

			const usage = await db
				.select()
				.from(paidAIUsage)
				.where(eq(paidAIUsage.userId, user.id))
				.orderBy(desc(paidAIUsage.createdAt))
				.limit(limit)
				.offset(offset);

			const total = await db
				.select({ count: t.Number() })
				.from(paidAIUsage)
				.where(eq(paidAIUsage.userId, user.id));

			return {
				usage,
				total: Number(count),
			};
		},
		{
			auth: true,
			query: t.Object({
				limit: t.Optional(t.String()),
				offset: t.Optional(t.String()),
			}),
			detail: {
				tags: ['Paid AI Chat'],
				summary: 'Get usage',
				description: 'Get paid AI chat usage history',
			},
		},
	);
