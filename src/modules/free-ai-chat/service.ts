import { db } from '@common/db';
import {
	conversationSession,
	conversationMessage,
	userUsageDaily,
	userUsageMonthly,
	freeSubscriptionStatus,
	type ConversationSession,
	type ConversationMessage,
} from '@common/db/schema';
import { env } from '@common/config/env';
import { BedrockRuntimeClient, ConverseCommand, Message } from '@aws-sdk/client-bedrock-runtime';
import { eq, and, desc, sql } from 'drizzle-orm';

/**
 * Free AI Chat Service
 * Handles Bedrock integration, usage tracking, limits, and message pruning
 */

let bedrockClient: BedrockRuntimeClient | null = null;

function getBedrockClient(): BedrockRuntimeClient {
	if (bedrockClient) {
		return bedrockClient;
	}

	const accessKeyId = env.AWS_ACCESS_KEY_ID;
	const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;

	if (!accessKeyId || !secretAccessKey) {
		throw new Error(
			'AWS credentials not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in environment variables.',
		);
	}

	bedrockClient = new BedrockRuntimeClient({
		region: env.AWS_REGION,
		credentials: {
			accessKeyId,
			secretAccessKey,
		},
	});

	return bedrockClient;
}

export interface BedrockResponse {
	content: string;
	tokensUsed: number;
	costUsd: number;
}

export async function estimateTokenCount(text: string): Promise<number> {
	return Math.ceil(text.length / 4);
}

export async function invokeBedrock(
	messages: Array<{ role: string; content: string }>,
	systemPrompt: string,
): Promise<BedrockResponse> {
	const converseMessages: Message[] = messages
		.filter((msg) => msg.role !== 'system')
		.map((msg): Message => ({
			role: msg.role === 'user' ? 'user' : 'assistant',
			content: [{ text: msg.content }],
		}));

	const allText = systemPrompt + '\n\n' + messages.map((m) => m.content).join('\n');
	const estimatedInputTokens = await estimateTokenCount(allText);

	const command = new ConverseCommand({
		modelId: env.BEDROCK_MODEL_ID,
		system: [{ text: systemPrompt }],
		messages: converseMessages,
		inferenceConfig: {
			maxTokens: 1000,
			temperature: 0.7,
			topP: 0.9,
		},
	});

	const client = getBedrockClient();
	const response = await client.send(command);

	const outputText =
		response.output?.message?.content
			?.filter((block: any) => block.text != null)
			.map((block: any) => block.text)
			.join('') || '';

	const outputTokens = await estimateTokenCount(outputText);
	const totalTokens = estimatedInputTokens + outputTokens;
	const costUsd = (totalTokens / 1000) * parseFloat(env.BEDROCK_COST_PER_1K_TOKENS);

	return {
		content: outputText.trim(),
		tokensUsed: totalTokens,
		costUsd,
	};
}

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
	const maxMessages = parseInt(env.MAX_MESSAGES_PER_SESSION);

	const messageCount = await db
		.select({ count: sql<number>`count(*)` })
		.from(conversationMessage)
		.where(eq(conversationMessage.sessionId, sessionId));

	const count = messageCount[0]?.count || 0;

	if (count <= maxMessages) {
		return;
	}

	const messagesToKeep = await db
		.select({ id: conversationMessage.id })
		.from(conversationMessage)
		.where(eq(conversationMessage.sessionId, sessionId))
		.orderBy(desc(conversationMessage.createdAt))
		.limit(maxMessages);

	const idsToKeep = messagesToKeep.map((m) => m.id);

	if (idsToKeep.length === 0) {
		return;
	}

	const deletedMessages = await db
		.delete(conversationMessage)
		.where(
			and(
				eq(conversationMessage.sessionId, sessionId),
				sql`${conversationMessage.id} != ALL(${idsToKeep})`,
			),
		)
		.returning({ tokenCount: conversationMessage.tokenCount });

	const totalDeletedTokens = deletedMessages.reduce((sum, msg) => sum + (msg.tokenCount || 0), 0);

	const currentSession = await db
		.select({
			totalMessages: conversationSession.totalMessages,
			totalTokensUsed: conversationSession.totalTokensUsed,
		})
		.from(conversationSession)
		.where(eq(conversationSession.id, sessionId))
		.limit(1);

	if (currentSession[0]) {
		const newTotalMessages = Math.max(0, count - (count - idsToKeep.length));
		const newTotalTokens = Math.max(0, (currentSession[0].totalTokensUsed || 0) - totalDeletedTokens);

		await db
			.update(conversationSession)
			.set({
				totalMessages: newTotalMessages,
				totalTokensUsed: newTotalTokens,
				updatedAt: new Date(),
			})
			.where(eq(conversationSession.id, sessionId));
	}
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
