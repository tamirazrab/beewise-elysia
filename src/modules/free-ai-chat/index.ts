import { withAuth } from '@common/middleware/auth-guard';
import { Elysia, t } from 'elysia';
import { db } from '@common/db';
import {
	conversationSession,
	conversationMessage,
	freeSubscriptionStatus,
} from '@common/db/schema';
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
		throw new Error(
			`${paramName} must be a valid UUID format. Received: "${id}"`,
		);
	}
}

const SUPPORTED_LANGUAGE_CODES = new Set([
	'en', 'es', 'zh', 'fr', 'ar', 'de', 'ja', 'pt', 'ko', 'hi', 'ur', 'bn',
]);

/**
 * Free AI Chat Module
 * Handles free-tier AI chat sessions, messages, usage tracking, and limits
 */
export const freeAIChatModule = withAuth(new Elysia({ prefix: '/api/free' }))
	// POST /api/free/sessions - Create session
	.post(
		'/sessions',
		async ({ body, user, set }: any) => {
			if (!user) {
				set.status = 401;
				return { error: 'Unauthorized', message: 'Please login first' };
			}

			if (!SUPPORTED_LANGUAGE_CODES.has(body.language_code)) {
				set.status = 400;
				return {
					error: 'Invalid language_code',
					message: `language_code must be one of: ${[...SUPPORTED_LANGUAGE_CODES].sort().join(', ')}`,
				};
			}

			const monthlyUsage = await service.getMonthlyUsage(user.id);
			const sessionCount = monthlyUsage?.session_count || 0;

			const limitCheck = service.checkMonthlySessionLimit(sessionCount);
			if (!limitCheck.allowed) {
				set.status = 429;
				return { error: 'Resource Exhausted', message: limitCheck.reason };
			}

			const [session] = await db
				.insert(conversationSession)
				.values({
					userId: user.id,
					languageCode: body.language_code,
					status: 'active',
				})
				.returning();

			if (!session) {
				set.status = 500;
				return { error: 'Internal Server Error', message: 'Failed to create session' };
			}

			await service.incrementMonthlySessionUsage(user.id);
			await service.incrementDailyUsage(user.id, 0, 0, 1);

			const systemPrompt = service.buildSystemPrompt(session.languageCode);
			await service.saveMessage(session.id, 'system', systemPrompt, await service.estimateTokenCount(systemPrompt));

			set.status = 201;
			return { session };
		},
		{
			auth: true,
			body: t.Object({
				language_code: t.String({
					description: 'ISO 639-1 language code for the conversation (e.g. en, es, fr)',
					default: 'es',
				}),
			}),
			detail: {
				tags: ['Free AI Chat'],
				summary: 'Create session',
				description: 'Authenticated. Create a new free-tier conversation session. Request body is prefilled with a sample.',
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

	// GET /api/free/sessions - List sessions
	.get(
		'/sessions',
		async ({ query, user, set }: any) => {
			if (!user) {
				set.status = 401;
				return { error: 'Unauthorized', message: 'Please login first' };
			}

			const limit = query.limit ? Number(query.limit) : 20;
			const offset = query.offset ? Number(query.offset) : 0;

			const sessions = await db
				.select()
				.from(conversationSession)
				.where(eq(conversationSession.userId, user.id))
				.orderBy(desc(conversationSession.createdAt))
				.limit(limit)
				.offset(offset);

			const [{ count }] = await db
				.select({ count: sql<number>`count(*)` })
				.from(conversationSession)
				.where(eq(conversationSession.userId, user.id));

			return {
				sessions,
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
				tags: ['Free AI Chat'],
				summary: 'List sessions',
				description: 'List all conversation sessions for the authenticated user',
			},
		},
	)

	// GET /api/free/sessions/:id - Get session
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
				.from(conversationSession)
				.where(and(eq(conversationSession.id, params.id), eq(conversationSession.userId, user.id)))
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
				tags: ['Free AI Chat'],
				summary: 'Get session',
				description: 'Get a specific conversation session',
			},
		},
	)

	// POST /api/free/sessions/:id/close - Close session
	.post(
		'/:id/close',
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
				.update(conversationSession)
				.set({
					status: 'closed',
					closedAt: new Date(),
					sessionDurationSeconds: sql`EXTRACT(EPOCH FROM (NOW() - ${conversationSession.createdAt}))::INTEGER`,
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(conversationSession.id, params.id),
						eq(conversationSession.userId, user.id),
						eq(conversationSession.status, 'active'),
					),
				)
				.returning();

			if (!session) {
				set.status = 404;
				return { error: 'Not Found', message: 'Active session not found' };
			}

			return session;
		},
		{
			auth: true,
			params: t.Object({
				id: t.String(),
			}),
			detail: {
				tags: ['Free AI Chat'],
				summary: 'Close session',
				description: 'Close an active conversation session',
			},
		},
	)

	// DELETE /api/free/sessions/:id - Delete session
	.delete(
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

			await db
				.delete(conversationSession)
				.where(and(eq(conversationSession.id, params.id), eq(conversationSession.userId, user.id)));

			return { message: 'Session deleted successfully' };
		},
		{
			auth: true,
			params: t.Object({
				id: t.String(),
			}),
			detail: {
				tags: ['Free AI Chat'],
				summary: 'Delete session',
				description: 'Delete a conversation session',
			},
		},
	)

	// POST /api/free/sessions/:id/messages - Send message
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
				.from(conversationSession)
				.where(
					and(
						eq(conversationSession.id, params.id),
						eq(conversationSession.userId, user.id),
						eq(conversationSession.status, 'active'),
					),
				)
				.limit(1);

			if (!session) {
				set.status = 404;
				return { error: 'Not Found', message: 'Active session not found' };
			}

			const dailyUsage = await service.getDailyUsage(user.id);
			const currentMessageCount = dailyUsage?.message_count || 0;
			const currentTokenCount = dailyUsage?.token_count || 0;

			const messageLimitCheck = service.checkDailyMessageLimit(currentMessageCount);
			if (!messageLimitCheck.allowed) {
				set.status = 429;
				return { error: 'Resource Exhausted', message: messageLimitCheck.reason };
			}

			const userMessageTokens = await service.estimateTokenCount(body.content);
			const tokenLimitCheck = service.checkDailyTokenLimit(currentTokenCount, userMessageTokens);
			if (!tokenLimitCheck.allowed) {
				set.status = 429;
				return { error: 'Resource Exhausted', message: tokenLimitCheck.reason };
			}

			const requestTokenCheck = service.checkRequestTokenLimit(userMessageTokens);
			if (!requestTokenCheck.allowed) {
				set.status = 400;
				return { error: 'Bad Request', message: requestTokenCheck.reason };
			}

			await service.saveMessage(session.id, 'user', body.content, userMessageTokens);
			await service.incrementDailyUsage(user.id, 1, userMessageTokens, 0);

			const messages = await service.getSessionMessages(session.id, service.FREE_TIER_LIMITS.MAX_MESSAGES_PER_SESSION);
			const systemPrompt = service.buildSystemPrompt(session.languageCode);
			const bedrockResponse = await service.invokeBedrock(messages, systemPrompt);

			await service.saveMessage(session.id, 'assistant', bedrockResponse.content, bedrockResponse.tokensUsed);
			await service.incrementDailyUsage(user.id, 1, bedrockResponse.tokensUsed, 0);

			const [updatedSession] = await db
				.update(conversationSession)
				.set({
					aiCostEstimateUsd: sql`${conversationSession.aiCostEstimateUsd} + ${bedrockResponse.costUsd}`,
					updatedAt: new Date(),
				})
				.where(eq(conversationSession.id, session.id))
				.returning();

			if (!updatedSession) {
				set.status = 500;
				return { error: 'Internal Server Error', message: 'Failed to update session' };
			}

			const [userMessage] = await db
				.select()
				.from(conversationMessage)
				.where(and(eq(conversationMessage.sessionId, session.id), eq(conversationMessage.role, 'user')))
				.orderBy(desc(conversationMessage.createdAt))
				.limit(1);

			const [aiMessage] = await db
				.select()
				.from(conversationMessage)
				.where(and(eq(conversationMessage.sessionId, session.id), eq(conversationMessage.role, 'assistant')))
				.orderBy(desc(conversationMessage.createdAt))
				.limit(1);

			if (!userMessage || !aiMessage) {
				set.status = 500;
				return { error: 'Internal Server Error', message: 'Failed to retrieve messages' };
			}

			return {
				message: userMessage,
				ai_response: aiMessage,
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
					description: 'The user message to send to the AI',
					default: "How do I say 'I am learning Spanish' in Spanish?",
				}),
			}),
			detail: {
				tags: ['Free AI Chat'],
				summary: 'Send message',
				description: 'Authenticated. Send a message in an active conversation session. Body is prefilled with an example.',
				requestBody: {
					content: {
						'application/json': {
							example: { content: "How do I say 'I am learning Spanish' in Spanish?" },
						},
					},
				},
			},
		},
	)

	// GET /api/free/sessions/:id/messages - Get messages
	.get(
		'/:id/messages',
		async ({ params, query, user, set }: any) => {
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

			const [sessionCheck] = await db
				.select({ id: conversationSession.id })
				.from(conversationSession)
				.where(and(eq(conversationSession.id, params.id), eq(conversationSession.userId, user.id)))
				.limit(1);

			if (!sessionCheck) {
				set.status = 404;
				return { error: 'Not Found', message: 'Session not found' };
			}

			const limit = query.limit ? Number(query.limit) : 20;
			const offset = query.offset ? Number(query.offset) : 0;

			const messages = await db
				.select()
				.from(conversationMessage)
				.where(eq(conversationMessage.sessionId, params.id))
				.orderBy(desc(conversationMessage.createdAt))
				.limit(limit)
				.offset(offset);

			const [{ count }] = await db
				.select({ count: sql<number>`count(*)` })
				.from(conversationMessage)
				.where(eq(conversationMessage.sessionId, params.id));

			return {
				messages: messages.reverse(),
				total: Number(count),
			};
		},
		{
			auth: true,
			params: t.Object({
				id: t.String(),
			}),
			query: t.Object({
				limit: t.Optional(t.String()),
				offset: t.Optional(t.String()),
			}),
			detail: {
				tags: ['Free AI Chat'],
				summary: 'Get messages',
				description: 'Get messages from a conversation session',
			},
		},
	);

// Usage endpoints (separate module)
export const usageModule = withAuth(new Elysia({ prefix: '/api/usage' }))
	// GET /api/usage/daily - Get daily usage
	.get(
		'/daily',
		async ({ user, set }: any) => {
			if (!user) {
				set.status = 401;
				return { error: 'Unauthorized', message: 'Please login first' };
			}

			const daily = await service.getDailyUsage(user.id);
			const monthly = await service.getMonthlyUsage(user.id);

			return {
				daily: {
					message_count: daily?.message_count || 0,
					token_count: daily?.token_count || 0,
					session_count: daily?.session_count || 0,
				},
				monthly: {
					session_count: monthly?.session_count || 0,
				},
				limits: {
					daily_message_limit: service.FREE_TIER_LIMITS.DAILY_MESSAGE_LIMIT,
					daily_token_limit: service.FREE_TIER_LIMITS.DAILY_TOKEN_LIMIT,
					monthly_session_limit: service.FREE_TIER_LIMITS.MONTHLY_SESSION_LIMIT,
				},
			};
		},
		{
			auth: true,
			detail: {
				tags: ['Free AI Chat'],
				summary: 'Get daily usage',
				description: 'Get daily usage statistics',
			},
		},
	)

	// GET /api/usage/monthly - Get monthly usage
	.get(
		'/monthly',
		async ({ user, set }: any) => {
			if (!user) {
				set.status = 401;
				return { error: 'Unauthorized', message: 'Please login first' };
			}

			const monthly = await service.getMonthlyUsage(user.id);
			return {
				session_count: monthly?.session_count || 0,
			};
		},
		{
			auth: true,
			detail: {
				tags: ['Free AI Chat'],
				summary: 'Get monthly usage',
				description: 'Get monthly usage statistics',
			},
		},
	);

// Limits endpoint
export const limitsModule = withAuth(new Elysia({ prefix: '/api/limits' }))
	.get(
		'/',
		async ({ user, set }: any) => {
			if (!user) {
				set.status = 401;
				return { error: 'Unauthorized', message: 'Please login first' };
			}

			return {
				daily_message_limit: service.FREE_TIER_LIMITS.DAILY_MESSAGE_LIMIT,
				daily_token_limit: service.FREE_TIER_LIMITS.DAILY_TOKEN_LIMIT,
				monthly_session_limit: service.FREE_TIER_LIMITS.MONTHLY_SESSION_LIMIT,
			};
		},
		{
			auth: true,
			detail: {
				tags: ['Free AI Chat'],
				summary: 'Get limits',
				description: 'Get free tier limits',
			},
		},
	);

// Subscription status endpoint
export const subscriptionStatusModule = withAuth(new Elysia({ prefix: '/api/free/subscription' }))
	.get(
		'/status',
		async ({ user, set }: any) => {
			if (!user) {
				set.status = 401;
				return { error: 'Unauthorized', message: 'Please login first' };
			}

			const [status] = await db
				.select({
					plan_type: freeSubscriptionStatus.planType,
					trial_ends_at: freeSubscriptionStatus.trialEndsAt,
				})
				.from(freeSubscriptionStatus)
				.where(eq(freeSubscriptionStatus.userId, user.id))
				.limit(1);

			if (!status) {
				return {
					plan_type: 'free',
					trial_ends_at: null,
				};
			}

			return status;
		},
		{
			auth: true,
			detail: {
				tags: ['Free AI Chat'],
				summary: 'Get subscription status',
				description: 'Get free tier subscription status',
			},
		},
	);
