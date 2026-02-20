import { withAuth } from '@common/middleware/auth-guard';
import { Elysia, t } from 'elysia';
import { db } from '@common/db';
import { voiceSession } from '@common/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import * as service from './service';

const SUPPORTED_LANGUAGE_CODES = new Set([
	'en', 'es', 'zh', 'fr', 'ar', 'de', 'ja', 'pt', 'ko', 'hi', 'ur', 'bn',
]);

/**
 * Voice Chat Module
 * Handles voice chat limits and bidirectional streaming
 */
export const voiceChatModule = withAuth(new Elysia({ prefix: '/api/voice' }))
	// GET /api/voice/limits - Get voice limits
	.get(
		'/limits',
		async ({ user, set }: any) => {
			if (!user) {
				set.status = 401;
				return { error: 'Unauthorized', message: 'Please login first' };
			}

			const today = new Date().toISOString().split('T')[0];
			const secondsUsed = await service.getDailyVoiceSecondsUsed(user.id, today);
			const dailyCost = await service.getDailyVoiceCostTotal(today);

			return {
				daily_minutes_limit: service.VOICE_LIMITS.DAILY_MINUTES_PER_USER,
				daily_minutes_used: Math.round((secondsUsed / 60) * 10) / 10,
				daily_budget_cap_usd: service.VOICE_LIMITS.DAILY_BUDGET_USD,
				max_session_minutes: service.VOICE_LIMITS.MAX_SESSION_MINUTES,
				cost_per_minute_usd: service.VOICE_LIMITS.COST_PER_MINUTE_USD,
			};
		},
		{
			auth: true,
			detail: {
				tags: ['Voice Chat'],
				summary: 'Get voice limits',
				description: 'Get voice chat limits and current usage',
			},
		},
	)

	// POST /api/voice/session - Bidirectional streaming endpoint
	.post(
		'/session',
		async ({ body, user, set }: any) => {
			if (!user) {
				set.status = 401;
				return { error: 'Unauthorized', message: 'Please login first' };
			}

			const languageCode = body.language_code || 'en';
			if (!SUPPORTED_LANGUAGE_CODES.has(languageCode)) {
				set.status = 400;
				return { error: 'Bad Request', message: 'Unsupported language_code' };
			}

			const active = await service.getActiveVoiceSession(user.id);
			if (active) {
				set.status = 409;
				return { error: 'Conflict', message: 'You already have an active voice session' };
			}

			const maxSessionSeconds = service.VOICE_LIMITS.MAX_SESSION_MINUTES * 60;
			const estimatedCostMax = (maxSessionSeconds / 60) * service.VOICE_LIMITS.COST_PER_MINUTE_USD;

			const budgetCheck = await service.checkDailyBudget(estimatedCostMax);
			if (!budgetCheck.allowed) {
				set.status = 429;
				return { error: 'Resource Exhausted', message: budgetCheck.reason };
			}

			const minutesCheck = await service.checkDailyVoiceMinutes(user.id, maxSessionSeconds);
			if (!minutesCheck.allowed) {
				set.status = 429;
				return { error: 'Resource Exhausted', message: minutesCheck.reason };
			}

			const [session] = await db
				.insert(voiceSession)
				.values({
					userId: user.id,
					languageCode,
				})
				.returning();

			if (!session) {
				set.status = 500;
				return { error: 'Internal Server Error', message: 'Failed to create voice session' };
			}

			// TODO: Implement bidirectional streaming with Nova Sonic
			// For now, return a placeholder response
			set.status = 501;
			return {
				error: 'Not Implemented',
				message: 'Voice streaming is not yet implemented. This requires WebSocket/bidirectional streaming support.',
				sessionId: session.id,
			};
		},
		{
			auth: true,
			body: t.Object({
				language_code: t.Optional(t.String()),
			}),
			detail: {
				tags: ['Voice Chat'],
				summary: 'Start voice session',
				description: 'Start a bidirectional voice chat session (streaming not yet implemented)',
			},
		},
	);
