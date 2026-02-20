import { db } from '@common/db';
import { voiceUsageDaily, voiceSession } from '@common/db/schema';
import { eq, and, isNull, sql, desc } from 'drizzle-orm';

/**
 * Voice Chat Service
 * Handles voice usage tracking and limits checking
 */

export const VOICE_LIMITS = {
	DAILY_MINUTES_PER_USER: parseInt(process.env.VOICE_DAILY_MINUTES_PER_USER || '2', 10),
	DAILY_BUDGET_USD: parseFloat(process.env.VOICE_DAILY_BUDGET_USD || '20'),
	MAX_SESSION_MINUTES: parseInt(process.env.VOICE_MAX_SESSION_MINUTES || '5', 10),
	COST_PER_MINUTE_USD: 0.017,
};

export interface VoiceLimitCheckResult {
	allowed: boolean;
	reason?: string;
}

export async function getDailyVoiceSecondsUsed(userId: string, usageDate: string): Promise<number> {
	const [result] = await db
		.select({
			secondsUsed: voiceUsageDaily.secondsUsed,
		})
		.from(voiceUsageDaily)
		.where(and(eq(voiceUsageDaily.userId, userId), eq(voiceUsageDaily.usageDate, usageDate)))
		.limit(1);

	return result?.secondsUsed || 0;
}

export async function getDailyVoiceCostTotal(usageDate: string): Promise<number> {
	const [result] = await db
		.select({
			total: sql<number>`COALESCE(SUM(${voiceUsageDaily.costEstimateUsd}), 0)::float`,
		})
		.from(voiceUsageDaily)
		.where(eq(voiceUsageDaily.usageDate, usageDate))
		.limit(1);

	return Number(result?.total) || 0;
}

export async function checkDailyVoiceMinutes(
	userId: string,
	additionalSeconds: number,
): Promise<VoiceLimitCheckResult> {
	const today = new Date().toISOString().split('T')[0];
	const used = await getDailyVoiceSecondsUsed(userId, today);
	const limitSeconds = VOICE_LIMITS.DAILY_MINUTES_PER_USER * 60;
	if (used + additionalSeconds > limitSeconds) {
		return {
			allowed: false,
			reason: `Daily voice limit reached (${VOICE_LIMITS.DAILY_MINUTES_PER_USER} minutes).`,
		};
	}
	return { allowed: true };
}

export async function checkDailyBudget(additionalCostUsd: number): Promise<VoiceLimitCheckResult> {
	const today = new Date().toISOString().split('T')[0];
	const current = await getDailyVoiceCostTotal(today);
	if (current + additionalCostUsd > VOICE_LIMITS.DAILY_BUDGET_USD) {
		return {
			allowed: false,
			reason: 'Daily voice budget exceeded. Try again tomorrow.',
		};
	}
	return { allowed: true };
}

export async function getActiveVoiceSession(userId: string): Promise<{ id: string } | null> {
	const [result] = await db
		.select({ id: voiceSession.id })
		.from(voiceSession)
		.where(and(eq(voiceSession.userId, userId), isNull(voiceSession.endedAt)))
		.orderBy(desc(voiceSession.startedAt))
		.limit(1);

	return result || null;
}

export async function recordVoiceSession(
	userId: string,
	sessionId: string,
	secondsUsed: number,
	costEstimateUsd: number,
	languageCode: string,
): Promise<void> {
	const today = new Date().toISOString().split('T')[0];

	await db
		.insert(voiceUsageDaily)
		.values({
			userId,
			usageDate: today,
			secondsUsed,
			costEstimateUsd: costEstimateUsd.toString(),
			sessionCount: 1,
		})
		.onConflictDoUpdate({
			target: [voiceUsageDaily.userId, voiceUsageDaily.usageDate],
			set: {
				secondsUsed: sql`${voiceUsageDaily.secondsUsed} + ${secondsUsed}`,
				costEstimateUsd: sql`${voiceUsageDaily.costEstimateUsd} + ${costEstimateUsd}`,
				sessionCount: sql`${voiceUsageDaily.sessionCount} + 1`,
			},
		});

	await db
		.update(voiceSession)
		.set({
			endedAt: new Date(),
			secondsUsed,
			costEstimateUsd: costEstimateUsd.toString(),
		})
		.where(eq(voiceSession.id, sessionId));
}
