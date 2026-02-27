import { db } from '@common/db';
import {
	conversationSession,
	conversationMessage,
	userUsageDaily,
	userUsageMonthly,
} from '@common/db/schema';
import { env } from '@common/config/env';
import { estimateTokenCountSync, invokeBedrockChat } from '@common/llm/bedrock';
import { eq, and, desc, sql } from 'drizzle-orm';

/**
 * Free AI Chat Service
 * Handles Bedrock integration, usage tracking, limits, and message pruning
 */

export async function getSessionMessages(
	sessionId: string,
	limit: number = parseInt(env.MAX_MESSAGES_PER_SESSION),
): Promise<Array<{ role: string; content: string }>> {
	const messages = await db
		.select({
			role: conversationMessage.role,
			content: conversationMessage.content,
		})
		.from(conversationMessage)
		.where(eq(conversationMessage.sessionId, sessionId))
		.orderBy(desc(conversationMessage.createdAt))
		.limit(limit);

	return messages.reverse();
}

export async function saveMessage(
	sessionId: string,
	role: 'system' | 'user' | 'assistant',
	content: string,
	tokenCount: number,
): Promise<void> {
	await db.insert(conversationMessage).values({
		sessionId,
		role,
		content,
		tokenCount,
	});

	await db
		.update(conversationSession)
		.set({
			totalMessages: sql`${conversationSession.totalMessages} + 1`,
			totalTokensUsed: sql`${conversationSession.totalTokensUsed} + ${tokenCount}`,
			updatedAt: new Date(),
		})
		.where(eq(conversationSession.id, sessionId));

	await pruneMessages(sessionId);
}

export async function pruneMessages(sessionId: string): Promise<void> {
	const maxMessages = parseInt(env.MAX_MESSAGES_PER_SESSION, 10);

	// Select messages to delete (everything older than the most recent N)
	const messagesToDelete = await db
		.select({
			id: conversationMessage.id,
			tokenCount: conversationMessage.tokenCount,
		})
		.from(conversationMessage)
		.where(eq(conversationMessage.sessionId, sessionId))
		.orderBy(desc(conversationMessage.createdAt))
		.offset(maxMessages);

	if (messagesToDelete.length === 0) {
		return;
	}

	const idsToDelete = messagesToDelete.map((m) => m.id);
	const totalDeletedTokens = messagesToDelete.reduce(
		(sum, msg) => sum + (msg.tokenCount || 0),
		0,
	);

	await db
		.delete(conversationMessage)
		.where(sql`${conversationMessage.id} = ANY(${idsToDelete})`);

	await db
		.update(conversationSession)
		.set({
			totalMessages: sql`${conversationSession.totalMessages} - ${idsToDelete.length}`,
			totalTokensUsed: sql`${conversationSession.totalTokensUsed} - ${totalDeletedTokens}`,
			updatedAt: new Date(),
		})
		.where(eq(conversationSession.id, sessionId));
}

export const FREE_TIER_LIMITS = {
	DAILY_MESSAGE_LIMIT: parseInt(env.DAILY_MESSAGE_LIMIT),
	DAILY_TOKEN_LIMIT: parseInt(env.DAILY_TOKEN_LIMIT),
	MONTHLY_SESSION_LIMIT: parseInt(env.MONTHLY_SESSION_LIMIT),
	MAX_MESSAGES_PER_SESSION: parseInt(env.MAX_MESSAGES_PER_SESSION),
	MAX_TOKENS_PER_REQUEST: parseInt(env.MAX_TOKENS_PER_REQUEST),
};

export interface LimitCheckResult {
	allowed: boolean;
	reason?: string;
}

export function checkRequestTokenLimit(requestTokens: number): LimitCheckResult {
	if (requestTokens > FREE_TIER_LIMITS.MAX_TOKENS_PER_REQUEST) {
		return {
			allowed: false,
			reason: `Request exceeds maximum tokens per request (${FREE_TIER_LIMITS.MAX_TOKENS_PER_REQUEST})`,
		};
	}
	return { allowed: true };
}

export function checkDailyMessageLimit(currentCount: number): LimitCheckResult {
	if (currentCount >= FREE_TIER_LIMITS.DAILY_MESSAGE_LIMIT) {
		return {
			allowed: false,
			reason: `Daily message limit reached (${FREE_TIER_LIMITS.DAILY_MESSAGE_LIMIT})`,
		};
	}
	return { allowed: true };
}

export function checkDailyTokenLimit(currentTokens: number, additionalTokens: number): LimitCheckResult {
	const totalAfter = currentTokens + additionalTokens;
	if (totalAfter > FREE_TIER_LIMITS.DAILY_TOKEN_LIMIT) {
		return {
			allowed: false,
			reason: `Daily token limit would be exceeded (${FREE_TIER_LIMITS.DAILY_TOKEN_LIMIT})`,
		};
	}
	return { allowed: true };
}

export function checkMonthlySessionLimit(currentCount: number): LimitCheckResult {
	if (currentCount >= FREE_TIER_LIMITS.MONTHLY_SESSION_LIMIT) {
		return {
			allowed: false,
			reason: `Monthly session limit reached (${FREE_TIER_LIMITS.MONTHLY_SESSION_LIMIT})`,
		};
	}
	return { allowed: true };
}

export async function incrementDailyUsage(
	userId: string,
	messageDelta: number,
	tokenDelta: number,
	sessionDelta: number = 0,
): Promise<void> {
	const today = new Date().toISOString().split('T')[0];

	await db
		.insert(userUsageDaily)
		.values({
			userId,
			usageDate: today,
			messageCount: messageDelta,
			tokenCount: tokenDelta,
			sessionCount: sessionDelta,
		})
		.onConflictDoUpdate({
			target: [userUsageDaily.userId, userUsageDaily.usageDate],
			set: {
				messageCount: sql`${userUsageDaily.messageCount} + ${messageDelta}`,
				tokenCount: sql`${userUsageDaily.tokenCount} + ${tokenDelta}`,
				sessionCount: sql`${userUsageDaily.sessionCount} + ${sessionDelta}`,
			},
		});
}

export async function incrementMonthlySessionUsage(userId: string): Promise<void> {
	const now = new Date();
	const year = now.getFullYear();
	const month = now.getMonth() + 1;

	await db
		.insert(userUsageMonthly)
		.values({
			userId,
			usageYear: year,
			usageMonth: month,
			sessionCount: 1,
		})
		.onConflictDoUpdate({
			target: [userUsageMonthly.userId, userUsageMonthly.usageYear, userUsageMonthly.usageMonth],
			set: {
				sessionCount: sql`${userUsageMonthly.sessionCount} + 1`,
			},
		});
}

export async function getDailyUsage(userId: string): Promise<{
	message_count: number;
	token_count: number;
	session_count: number;
} | null> {
	const today = new Date().toISOString().split('T')[0];

	const result = await db
		.select({
			message_count: userUsageDaily.messageCount,
			token_count: userUsageDaily.tokenCount,
			session_count: userUsageDaily.sessionCount,
		})
		.from(userUsageDaily)
		.where(and(eq(userUsageDaily.userId, userId), eq(userUsageDaily.usageDate, today)))
		.limit(1);

	return result[0] || null;
}

export async function getMonthlyUsage(userId: string): Promise<{ session_count: number } | null> {
	const now = new Date();
	const year = now.getFullYear();
	const month = now.getMonth() + 1;

	const result = await db
		.select({
			session_count: userUsageMonthly.sessionCount,
		})
		.from(userUsageMonthly)
		.where(
			and(
				eq(userUsageMonthly.userId, userId),
				eq(userUsageMonthly.usageYear, year),
				eq(userUsageMonthly.usageMonth, month),
			),
		)
		.limit(1);

	return result[0] || null;
}

export function buildSystemPrompt(languageCode: string): string {
	const SUPPORTED_LANGUAGES: Record<string, string> = {
		en: 'English',
		es: 'Spanish',
		zh: 'Mandarin Chinese',
		fr: 'French',
		ar: 'Arabic',
		de: 'German',
		ja: 'Japanese',
		pt: 'Portuguese',
		ko: 'Korean',
		hi: 'Hindi',
		ur: 'Urdu',
		bn: 'Bengali',
	};

	const languageName = SUPPORTED_LANGUAGES[languageCode] ?? languageCode;
	return `You are a helpful language learning assistant. The user is practicing ${languageName}.

Rules:
- Always respond in ${languageName} only. Do not switch to another language unless the user explicitly asks.
- Have natural conversations about any topic the user brings up; use the conversation to help them practice ${languageName}.
- When the user makes grammar, spelling, or word-choice mistakes, gently correct them: you can give the correct form and a brief explanation, then continue the conversation.
- Be encouraging and supportive. Help with vocabulary and phrasing when useful.
- Keep responses clear and at a level appropriate for a learner.`;
}

// Backwards-compatible re-exports for callers that previously imported from this module
export { invokeBedrockChat as invokeBedrock, estimateTokenCountSync as estimateTokenCount };
