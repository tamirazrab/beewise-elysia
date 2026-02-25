import { withAuth, withOptionalAuth } from '@common/middleware/auth-guard';
import { Elysia, t } from 'elysia';
import { db } from '@common/db';
import {
	conversationSession,
	conversationMessage,
	freeSubscriptionStatus,
} from '@common/db/schema';
import { env } from '@common/config/env';
import { eq, and, desc, sql } from 'drizzle-orm';
import * as trialService from '@modules/trial/service';
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

function getClientIP(request: Request): string {
	return (
		request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
		request.headers.get('x-real-ip') ||
		'127.0.0.1'
	);
}

/**
 * Free AI Chat Module
 * Handles free-tier AI chat sessions (logged-in or anonymous via X-Device-Id), messages, usage tracking, and limits
 */
export const freeAIChatModule = withOptionalAuth(new Elysia({ prefix: '/api/free' }))
	// POST /api/free/sessions - Create session (JWT or X-Device-Id)
	.post(
		'/sessions',
		async ({ body, user, anonymousIdHash, set, request }: any) => {
			if (!SUPPORTED_LANGUAGE_CODES.has(body.language_code)) {
				set.status = 400;
				return {
					error: 'Invalid language_code',
					message: `language_code must be one of: ${[...SUPPORTED_LANGUAGE_CODES].sort().join(', ')}`,
				};
			}

			if (user) {
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
			}

			if (anonymousIdHash) {
				const ip = getClientIP(request);
				const ipHash = trialService.hashIp(ip);
				const abused = await trialService.checkIpAbuse(ipHash);
				if (abused) {
					set.status = 429;
					return { error: 'Too Many Requests', message: 'Too many identities from this network. Try again later.' };
				}
				try {
					const { sessionId } = await trialService.createFreeAnonymousChatSession(
						anonymousIdHash,
						body.language_code,
						ipHash,
					);
					set.status = 201;
					return {
						session: {
							id: sessionId,
							languageCode: body.language_code,
							status: 'active',
						},
					};
				} catch (err) {
					const msg = err instanceof Error ? err.message : 'Failed to create session';
					if (msg.includes('limit')) {
						set.status = 429;
						return { error: 'Resource Exhausted', message: msg };
					}
					set.status = 500;
					return { error: 'Internal Server Error', message: msg };
				}
			}

			set.status = 401;
			return { error: 'Unauthorized', message: 'Send Authorization: Bearer <token> or X-Device-Id header.' };
		},
		{
			freeIdentity: true,
			body: t.Object({
				language_code: t.String({
					description: 'ISO 639-1 language code for the conversation (e.g. en, es, fr)',
					default: 'es',
				}),
			}),
			detail: {
				tags: ['Free AI Chat'],
				summary: 'Create session',
				description: 'Create a free-tier conversation session. Use JWT (logged-in) or X-Device-Id (anonymous).',
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

	// GET /api/free/sessions - List sessions (JWT or X-Device-Id)
	.get(
		'/sessions',
		async ({ query, user, anonymousIdHash, set }: any) => {
			const limit = query.limit ? Number(query.limit) : 20;
			const offset = query.offset ? Number(query.offset) : 0;

			if (user) {
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
				return { sessions, total: Number(count) };
			}

			if (anonymousIdHash) {
				const sessions = await trialService.listTrialSessionsByHash(anonymousIdHash, limit + offset, 0);
				const total = sessions.length;
				const page = sessions.slice(offset, offset + limit).map((s) => ({
					id: s.id,
					languageCode: s.languageCode,
					createdAt: s.createdAt,
					status: 'active',
				}));
				return { sessions: page, total };
			}

			set.status = 401;
			return { error: 'Unauthorized', message: 'Send JWT or X-Device-Id.' };
		},
		{
			freeIdentity: true,
			query: t.Object({
				limit: t.Optional(t.String()),
				offset: t.Optional(t.String()),
			}),
			detail: {
				tags: ['Free AI Chat'],
				summary: 'List sessions',
				description: 'List conversation sessions (logged-in or anonymous by X-Device-Id)',
			},
		},
	)

	// GET /api/free/sessions/:id - Get session
	.get(
		'/:id',
		async ({ params, user, anonymousIdHash, set }: any) => {
			try {
				validateUUID(params.id, 'session id');
			} catch (error: any) {
				set.status = 400;
				return { error: 'Bad Request', message: error.message };
			}

			if (user) {
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
			}

			if (anonymousIdHash) {
				const session = await trialService.getTrialChatSession(params.id, anonymousIdHash);
				if (!session) {
					set.status = 404;
					return { error: 'Not Found', message: 'Session not found' };
				}
				return { id: session.id, languageCode: session.languageCode, status: 'active' };
			}

			set.status = 401;
			return { error: 'Unauthorized', message: 'Send JWT or X-Device-Id.' };
		},
		{
			freeIdentity: true,
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

	// POST /api/free/sessions/:id/close - Close session (logged-in only; anonymous sessions have no close)
	.post(
		'/:id/close',
		async ({ params, user, anonymousIdHash, set }: any) => {
			if (anonymousIdHash) {
				set.status = 400;
				return { error: 'Bad Request', message: 'Anonymous sessions cannot be closed. Use delete if needed.' };
			}
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
			freeIdentity: true,
			params: t.Object({
				id: t.String(),
			}),
			detail: {
				tags: ['Free AI Chat'],
				summary: 'Close session',
				description: 'Close an active conversation session (logged-in only)',
			},
		},
	)

	// DELETE /api/free/sessions/:id - Delete session
	.delete(
		'/:id',
		async ({ params, user, anonymousIdHash, set }: any) => {
			try {
				validateUUID(params.id, 'session id');
			} catch (error: any) {
				set.status = 400;
				return { error: 'Bad Request', message: error.message };
			}
			if (user) {
				await db
					.delete(conversationSession)
					.where(and(eq(conversationSession.id, params.id), eq(conversationSession.userId, user.id)));
				return { message: 'Session deleted successfully' };
			}
			if (anonymousIdHash) {
				const deleted = await trialService.deleteTrialSession(params.id, anonymousIdHash);
				if (!deleted) {
					set.status = 404;
					return { error: 'Not Found', message: 'Session not found' };
				}
				return { message: 'Session deleted successfully' };
			}
			set.status = 401;
			return { error: 'Unauthorized', message: 'Send JWT or X-Device-Id.' };
		},
		{
			freeIdentity: true,
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

	// POST /api/free/sessions/:id/messages - Send message (JWT or X-Device-Id)
	.post(
		'/:id/messages',
		async ({ params, body, user, anonymousIdHash, set }: any) => {
			try {
				validateUUID(params.id, 'session id');
			} catch (error: any) {
				set.status = 400;
				return { error: 'Bad Request', message: error.message };
			}

			if (user) {
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
				return { message: userMessage, ai_response: aiMessage, session: updatedSession };
			}

			if (anonymousIdHash) {
				try {
					const result = await trialService.sendFreeAnonymousChatMessage(
						anonymousIdHash,
						params.id,
						body.content,
					);
					return {
						message: { role: 'user', content: body.content },
						ai_response: { role: 'assistant', content: result.content },
						session: { id: params.id, status: 'active' },
					};
				} catch (err) {
					const msg = err instanceof Error ? err.message : 'Failed to send message';
					if (msg.includes('not found') || msg.includes('Session')) {
						set.status = 404;
						return { error: 'Not Found', message: msg };
					}
					if (msg.includes('limit') || msg.includes('long')) {
						set.status = msg.includes('long') ? 400 : 429;
						return { error: msg.includes('long') ? 'Bad Request' : 'Resource Exhausted', message: msg };
					}
					set.status = 500;
					return { error: 'Internal Server Error', message: msg };
				}
			}

			set.status = 401;
			return { error: 'Unauthorized', message: 'Send JWT or X-Device-Id.' };
		},
		{
			freeIdentity: true,
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
				description: 'Send a message in an active session (JWT or X-Device-Id)',
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

	// GET /api/free/sessions/:id/messages - Get messages (JWT or X-Device-Id)
	.get(
		'/:id/messages',
		async ({ params, query, user, anonymousIdHash, set }: any) => {
			try {
				validateUUID(params.id, 'session id');
			} catch (error: any) {
				set.status = 400;
				return { error: 'Bad Request', message: error.message };
			}
			const limit = query.limit ? Number(query.limit) : 20;
			const offset = query.offset ? Number(query.offset) : 0;

			if (user) {
				const [sessionCheck] = await db
					.select({ id: conversationSession.id })
					.from(conversationSession)
					.where(and(eq(conversationSession.id, params.id), eq(conversationSession.userId, user.id)))
					.limit(1);
				if (!sessionCheck) {
					set.status = 404;
					return { error: 'Not Found', message: 'Session not found' };
				}
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
				return { messages: messages.reverse(), total: Number(count) };
			}

			if (anonymousIdHash) {
				const session = await trialService.getTrialChatSession(params.id, anonymousIdHash);
				if (!session) {
					set.status = 404;
					return { error: 'Not Found', message: 'Session not found' };
				}
				const rows = await trialService.getTrialSessionMessages(params.id, limit + offset);
				const slice = rows.slice(offset, offset + limit);
				return { messages: slice.map((m) => ({ role: m.role, content: m.content })), total: rows.length };
			}

			set.status = 401;
			return { error: 'Unauthorized', message: 'Send JWT or X-Device-Id.' };
		},
		{
			freeIdentity: true,
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

// Usage endpoints (JWT or X-Device-Id)
export const usageModule = withOptionalAuth(new Elysia({ prefix: '/api/usage' }))
	.get(
		'/daily',
		async ({ user, anonymousIdHash, set }: any) => {
			if (user) {
				const daily = await service.getDailyUsage(user.id);
				const monthly = await service.getMonthlyUsage(user.id);
				return {
					daily: {
						message_count: daily?.message_count || 0,
						token_count: daily?.token_count || 0,
						session_count: daily?.session_count || 0,
					},
					monthly: { session_count: monthly?.session_count || 0 },
					limits: {
						daily_message_limit: service.FREE_TIER_LIMITS.DAILY_MESSAGE_LIMIT,
						daily_token_limit: service.FREE_TIER_LIMITS.DAILY_TOKEN_LIMIT,
						monthly_session_limit: service.FREE_TIER_LIMITS.MONTHLY_SESSION_LIMIT,
					},
				};
			}
			if (anonymousIdHash) {
				const identity = await trialService.getOrCreateTrialIdentity(anonymousIdHash);
				return {
					daily: {
						message_count: identity.chatMessagesUsed,
						token_count: 0,
						session_count: identity.chatSessionsUsed,
					},
					monthly: { session_count: identity.chatSessionsUsed },
					limits: {
						daily_message_limit: env.FREE_ANONYMOUS_CHAT_MAX_MESSAGES,
						daily_token_limit: env.FREE_ANONYMOUS_CHAT_MAX_TOKENS_PER_REQUEST,
						monthly_session_limit: env.FREE_ANONYMOUS_CHAT_MAX_SESSIONS,
					},
				};
			}
			set.status = 401;
			return { error: 'Unauthorized', message: 'Send JWT or X-Device-Id.' };
		},
		{ freeIdentity: true, detail: { tags: ['Free AI Chat'], summary: 'Get daily usage', description: 'Daily usage (JWT or X-Device-Id)' } },
	)
	.get(
		'/monthly',
		async ({ user, anonymousIdHash, set }: any) => {
			if (user) {
				const monthly = await service.getMonthlyUsage(user.id);
				return { session_count: monthly?.session_count || 0 };
			}
			if (anonymousIdHash) {
				const identity = await trialService.getOrCreateTrialIdentity(anonymousIdHash);
				return { session_count: identity.chatSessionsUsed };
			}
			set.status = 401;
			return { error: 'Unauthorized', message: 'Send JWT or X-Device-Id.' };
		},
		{ freeIdentity: true, detail: { tags: ['Free AI Chat'], summary: 'Get monthly usage', description: 'Monthly usage (JWT or X-Device-Id)' } },
	);

// Limits endpoint (JWT or X-Device-Id)
export const limitsModule = withOptionalAuth(new Elysia({ prefix: '/api/limits' }))
	.get(
		'/',
		async ({ user, anonymousIdHash, set }: any) => {
			if (user) {
				return {
					daily_message_limit: service.FREE_TIER_LIMITS.DAILY_MESSAGE_LIMIT,
					daily_token_limit: service.FREE_TIER_LIMITS.DAILY_TOKEN_LIMIT,
					monthly_session_limit: service.FREE_TIER_LIMITS.MONTHLY_SESSION_LIMIT,
				};
			}
			if (anonymousIdHash) {
				return {
					daily_message_limit: env.FREE_ANONYMOUS_CHAT_MAX_MESSAGES,
					daily_token_limit: env.FREE_ANONYMOUS_CHAT_MAX_TOKENS_PER_REQUEST,
					monthly_session_limit: env.FREE_ANONYMOUS_CHAT_MAX_SESSIONS,
				};
			}
			set.status = 401;
			return { error: 'Unauthorized', message: 'Send JWT or X-Device-Id.' };
		},
		{ freeIdentity: true, detail: { tags: ['Free AI Chat'], summary: 'Get limits', description: 'Free tier limits (JWT or X-Device-Id)' } },
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
