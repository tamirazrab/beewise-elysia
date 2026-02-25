import { createHash } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { db } from '@common/db';
import {
	trialIdentity,
	trialConversationSession,
	trialConversationMessage,
	trialVoiceSession,
	type TrialIdentity as TrialIdentityRow,
} from '@common/db/schema';
import { env } from '@common/config/env';
import { appLogger } from '@common/logger';
import { eq, and, desc, sql, gte } from 'drizzle-orm';
import { estimateTokenCount, invokeBedrock } from '@modules/free-ai-chat/service';

const TRIAL_SYSTEM_PROMPT =
	'You are a helpful language learning assistant. Keep responses concise and encouraging. Help the user practice the language.';

export function hashTrialDeviceId(deviceId: string): string {
	return createHash('sha256').update(deviceId.trim()).digest('hex');
}

export function hashIp(ip: string): string {
	return createHash('sha256').update(ip.trim()).digest('hex');
}

export async function getOrCreateTrialIdentity(
	trialIdHash: string,
	ipHash?: string,
): Promise<TrialIdentityRow> {
	const [existing] = await db
		.select()
		.from(trialIdentity)
		.where(eq(trialIdentity.trialIdHash, trialIdHash))
		.limit(1);

	if (existing) return existing;

	const [created] = await db
		.insert(trialIdentity)
		.values({
			trialIdHash,
			firstSeenIpHash: ipHash ?? null,
		})
		.returning();

	if (!created) throw new Error('Failed to create trial identity');
	return created;
}

export function isExhausted(identity: TrialIdentityRow): boolean {
	return identity.exhaustedAt != null;
}

export async function checkIpAbuse(ipHash: string): Promise<boolean> {
	const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
	try {
		const [row] = await db
			.select({
				count: sql<number>`count(*)::int`,
			})
			.from(trialIdentity)
			.where(
				and(eq(trialIdentity.firstSeenIpHash, ipHash), gte(trialIdentity.createdAt, since)),
			);

		const count = row?.count ?? 0;
		return count >= (env.TRIAL_MAX_IDENTITIES_PER_IP_PER_DAY ?? 15);
	} catch (err) {
		appLogger.warn(
			{ err, ipHash: '[redacted]' },
			'Trial: checkIpAbuse query failed (trial_identity table may be missing). Run: bun run db:migrate',
		);
		return false;
	}
}

export async function createTrialChatSession(
	trialIdHash: string,
	languageCode: string,
	ipHash?: string,
): Promise<{ sessionId: string }> {
	const identity = await getOrCreateTrialIdentity(trialIdHash, ipHash);
	if (isExhausted(identity)) {
		throw new Error('Trial used. Sign up to continue.');
	}

	const maxSessions = env.TRIAL_CHAT_MAX_SESSIONS ?? 1;
	if (identity.chatSessionsUsed >= maxSessions) {
		await markExhausted(trialIdHash);
		throw new Error('Trial used. Sign up to continue.');
	}

	const [session] = await db
		.insert(trialConversationSession)
		.values({
			trialIdHash,
			languageCode,
		})
		.returning();

	if (!session) throw new Error('Failed to create trial session');

	await db
		.update(trialIdentity)
		.set({
			chatSessionsUsed: identity.chatSessionsUsed + 1,
			updatedAt: new Date(),
		})
		.where(eq(trialIdentity.trialIdHash, trialIdHash));

	return { sessionId: session.id };
}

export async function getTrialChatSession(
	sessionId: string,
	trialIdHash: string,
): Promise<{ id: string; languageCode: string } | null> {
	const [row] = await db
		.select({ id: trialConversationSession.id, languageCode: trialConversationSession.languageCode })
		.from(trialConversationSession)
		.where(
			and(
				eq(trialConversationSession.id, sessionId),
				eq(trialConversationSession.trialIdHash, trialIdHash),
			),
		)
		.limit(1);
	return row ?? null;
}

export async function listTrialSessionsByHash(
	trialIdHash: string,
	limit: number = 20,
	offset: number = 0,
): Promise<Array<{ id: string; languageCode: string; createdAt: Date }>> {
	const rows = await db
		.select({
			id: trialConversationSession.id,
			languageCode: trialConversationSession.languageCode,
			createdAt: trialConversationSession.createdAt,
		})
		.from(trialConversationSession)
		.where(eq(trialConversationSession.trialIdHash, trialIdHash))
		.orderBy(desc(trialConversationSession.createdAt))
		.limit(limit)
		.offset(offset);
	return rows;
}

export async function deleteTrialSession(sessionId: string, trialIdHash: string): Promise<boolean> {
	const [deleted] = await db
		.delete(trialConversationSession)
		.where(
			and(
				eq(trialConversationSession.id, sessionId),
				eq(trialConversationSession.trialIdHash, trialIdHash),
			),
		)
		.returning({ id: trialConversationSession.id });
	return deleted != null;
}

export async function getTrialSessionMessages(
	sessionId: string,
	limit: number = 20,
): Promise<Array<{ role: string; content: string }>> {
	const rows = await db
		.select({
			role: trialConversationMessage.role,
			content: trialConversationMessage.content,
		})
		.from(trialConversationMessage)
		.where(eq(trialConversationMessage.sessionId, sessionId))
		.orderBy(desc(trialConversationMessage.createdAt))
		.limit(limit);
	return rows.reverse();
}

export async function addTrialMessage(
	sessionId: string,
	role: string,
	content: string,
	tokenCount: number,
): Promise<void> {
	await db.insert(trialConversationMessage).values({
		sessionId,
		role,
		content,
		tokenCount,
	});
}

export async function sendTrialChatMessage(
	trialIdHash: string,
	sessionId: string,
	userContent: string,
): Promise<{ content: string; tokensUsed: number }> {
	const identity = await getOrCreateTrialIdentity(trialIdHash);
	if (isExhausted(identity)) {
		throw new Error('Trial used. Sign up to continue.');
	}

	const maxMessages = env.TRIAL_CHAT_MAX_MESSAGES ?? 5;
	if (identity.chatMessagesUsed >= maxMessages) {
		await markExhausted(trialIdHash);
		throw new Error('Trial used. Sign up to continue.');
	}

	const session = await getTrialChatSession(sessionId, trialIdHash);
	if (!session) throw new Error('Session not found');

	const userTokens = await estimateTokenCount(userContent);
	const maxPerRequest = env.TRIAL_CHAT_MAX_TOKENS_PER_REQUEST ?? 500;
	if (userTokens > maxPerRequest) {
		throw new Error(`Message too long (max ${maxPerRequest} tokens).`);
	}

	const history = await getTrialSessionMessages(sessionId);
	const messages = [...history.map((m) => ({ role: m.role, content: m.content })), { role: 'user' as const, content: userContent }];

	const response = await invokeBedrock(messages, TRIAL_SYSTEM_PROMPT);

	await addTrialMessage(sessionId, 'user', userContent, userTokens);
	await addTrialMessage(sessionId, 'assistant', response.content, response.tokensUsed - userTokens);

	const newTotal = identity.chatMessagesUsed + 1;
	const exhausted = newTotal >= maxMessages;
	await db
		.update(trialIdentity)
		.set({
			chatMessagesUsed: newTotal,
			updatedAt: new Date(),
			...(exhausted && { exhaustedAt: new Date() }),
		})
		.where(eq(trialIdentity.trialIdHash, trialIdHash));

	return {
		content: response.content,
		tokensUsed: response.tokensUsed,
	};
}

async function markExhausted(trialIdHash: string): Promise<void> {
	await db
		.update(trialIdentity)
		.set({ exhaustedAt: new Date(), updatedAt: new Date() })
		.where(eq(trialIdentity.trialIdHash, trialIdHash));
}

// --- Free anonymous (same tables, FREE_ANONYMOUS_* limits; no login) ---

export async function createFreeAnonymousChatSession(
	anonymousIdHash: string,
	languageCode: string,
	ipHash?: string,
): Promise<{ sessionId: string }> {
	const identity = await getOrCreateTrialIdentity(anonymousIdHash, ipHash);
	const maxSessions = env.FREE_ANONYMOUS_CHAT_MAX_SESSIONS ?? 20;
	if (identity.chatSessionsUsed >= maxSessions) {
		throw new Error('Free anonymous session limit reached. Sign up to continue.');
	}

	const [session] = await db
		.insert(trialConversationSession)
		.values({
			trialIdHash: anonymousIdHash,
			languageCode,
		})
		.returning();

	if (!session) throw new Error('Failed to create session');

	await db
		.update(trialIdentity)
		.set({
			chatSessionsUsed: identity.chatSessionsUsed + 1,
			updatedAt: new Date(),
		})
		.where(eq(trialIdentity.trialIdHash, anonymousIdHash));

	return { sessionId: session.id };
}

export async function sendFreeAnonymousChatMessage(
	anonymousIdHash: string,
	sessionId: string,
	userContent: string,
): Promise<{ content: string; tokensUsed: number }> {
	const identity = await getOrCreateTrialIdentity(anonymousIdHash);
	const maxMessages = env.FREE_ANONYMOUS_CHAT_MAX_MESSAGES ?? 200;
	if (identity.chatMessagesUsed >= maxMessages) {
		throw new Error('Free anonymous message limit reached. Sign up to continue.');
	}

	const session = await getTrialChatSession(sessionId, anonymousIdHash);
	if (!session) throw new Error('Session not found');

	const userTokens = await estimateTokenCount(userContent);
	const maxPerRequest = env.FREE_ANONYMOUS_CHAT_MAX_TOKENS_PER_REQUEST ?? 2000;
	if (userTokens > maxPerRequest) {
		throw new Error(`Message too long (max ${maxPerRequest} tokens).`);
	}

	const history = await getTrialSessionMessages(sessionId);
	const messages = [
		...history.map((m) => ({ role: m.role, content: m.content })),
		{ role: 'user' as const, content: userContent },
	];
	const response = await invokeBedrock(messages, TRIAL_SYSTEM_PROMPT);

	await addTrialMessage(sessionId, 'user', userContent, userTokens);
	await addTrialMessage(sessionId, 'assistant', response.content, response.tokensUsed - userTokens);

	const newTotal = identity.chatMessagesUsed + 1;
	await db
		.update(trialIdentity)
		.set({
			chatMessagesUsed: newTotal,
			updatedAt: new Date(),
		})
		.where(eq(trialIdentity.trialIdHash, anonymousIdHash));

	return {
		content: response.content,
		tokensUsed: response.tokensUsed,
	};
}

// --- Trial voice ---

export async function createTrialVoiceSession(
	trialIdHash: string,
	languageCode: string,
	ipHash?: string,
): Promise<{ sessionId: string }> {
	const identity = await getOrCreateTrialIdentity(trialIdHash, ipHash);
	if (isExhausted(identity)) {
		throw new Error('Trial used. Sign up to continue.');
	}

	const maxSessions = env.TRIAL_VOICE_MAX_SESSIONS ?? 1;
	const maxSeconds = env.TRIAL_VOICE_MAX_SECONDS ?? 90;
	if (identity.voiceSessionsUsed >= maxSessions || identity.voiceSecondsUsed >= maxSeconds) {
		await markExhausted(trialIdHash);
		throw new Error('Trial used. Sign up to continue.');
	}

	const [session] = await db
		.insert(trialVoiceSession)
		.values({
			trialIdHash,
			languageCode,
		})
		.returning();

	if (!session) throw new Error('Failed to create trial voice session');

	await db
		.update(trialIdentity)
		.set({
			voiceSessionsUsed: identity.voiceSessionsUsed + 1,
			updatedAt: new Date(),
		})
		.where(eq(trialIdentity.trialIdHash, trialIdHash));

	return { sessionId: session.id };
}

export async function createFreeAnonymousVoiceSession(
	anonymousIdHash: string,
	languageCode: string,
	ipHash?: string,
): Promise<{ sessionId: string }> {
	const identity = await getOrCreateTrialIdentity(anonymousIdHash, ipHash);
	const maxSessions = env.FREE_ANONYMOUS_VOICE_MAX_SESSIONS ?? 10;
	const maxSeconds = env.FREE_ANONYMOUS_VOICE_MAX_SECONDS ?? 600;
	if (identity.voiceSessionsUsed >= maxSessions || identity.voiceSecondsUsed >= maxSeconds) {
		throw new Error('Free anonymous voice limit reached. Sign up to continue.');
	}

	const [session] = await db
		.insert(trialVoiceSession)
		.values({
			trialIdHash: anonymousIdHash,
			languageCode,
		})
		.returning();

	if (!session) throw new Error('Failed to create voice session');

	await db
		.update(trialIdentity)
		.set({
			voiceSessionsUsed: identity.voiceSessionsUsed + 1,
			updatedAt: new Date(),
		})
		.where(eq(trialIdentity.trialIdHash, anonymousIdHash));

	return { sessionId: session.id };
}

const VOICE_COST_PER_MINUTE = 0.017;

export async function createTrialVoiceToken(trialIdHash: string, sessionId: string): Promise<string> {
	const secretStr =
		env.JWT_SECRET || (env as { BETTER_AUTH_SECRET?: string }).BETTER_AUTH_SECRET || 'development-secret-min-32-characters-long';
	const secret = new TextEncoder().encode(secretStr);
	const expSec = env.VOICE_WS_TOKEN_EXPIRY_SEC ?? 300;
	return new SignJWT({ sessionId, type: 'trial' })
		.setSubject(trialIdHash)
		.setProtectedHeader({ alg: 'HS256' })
		.setIssuedAt()
		.setExpirationTime(`${expSec}s`)
		.sign(secret);
}

export interface TrialVoiceTokenPayload {
	trialIdHash: string;
	sessionId: string;
}

export async function validateTrialVoiceToken(
	token: string,
): Promise<TrialVoiceTokenPayload | null> {
	try {
		const secretStr =
			env.JWT_SECRET || (env as { BETTER_AUTH_SECRET?: string }).BETTER_AUTH_SECRET || 'development-secret-min-32-characters-long';
		const secret = new TextEncoder().encode(secretStr);
		const { payload } = await jwtVerify(token, secret);
		const type = (payload as { type?: string }).type;
		if (type !== 'trial') return null;
		const sub = payload.sub;
		const sessionId = (payload as { sessionId?: string }).sessionId;
		if (typeof sub !== 'string' || typeof sessionId !== 'string') return null;
		return { trialIdHash: sub, sessionId };
	} catch {
		return null;
	}
}

export async function getTrialVoiceSessionById(
	sessionId: string,
	trialIdHash: string,
): Promise<{ id: string; languageCode: string } | null> {
	const [row] = await db
		.select({
			id: trialVoiceSession.id,
			languageCode: trialVoiceSession.languageCode,
		})
		.from(trialVoiceSession)
		.where(
			and(
				eq(trialVoiceSession.id, sessionId),
				eq(trialVoiceSession.trialIdHash, trialIdHash),
			),
		)
		.limit(1);
	return row ?? null;
}

export async function recordTrialVoiceSessionEnd(
	trialIdHash: string,
	sessionId: string,
	secondsUsed: number,
): Promise<void> {
	const maxSeconds = env.TRIAL_VOICE_MAX_SECONDS ?? 90;

	const [identity] = await db
		.select({
			voiceSecondsUsed: trialIdentity.voiceSecondsUsed,
		})
		.from(trialIdentity)
		.where(eq(trialIdentity.trialIdHash, trialIdHash))
		.limit(1);

	const previousSeconds = identity?.voiceSecondsUsed ?? 0;
	const totalAfter = Math.min(previousSeconds + secondsUsed, maxSeconds);
	const exhausted = totalAfter >= maxSeconds;

	const costEstimateUsd = (secondsUsed / 60) * VOICE_COST_PER_MINUTE;

	await db
		.update(trialVoiceSession)
		.set({
			endedAt: new Date(),
			secondsUsed,
			costEstimateUsd: costEstimateUsd.toString(),
		})
		.where(eq(trialVoiceSession.id, sessionId));

	await db
		.update(trialIdentity)
		.set({
			voiceSecondsUsed: totalAfter,
			updatedAt: new Date(),
			...(exhausted && { exhaustedAt: new Date() }),
		})
		.where(eq(trialIdentity.trialIdHash, trialIdHash));
}

export async function getTrialLimits(trialIdHash: string): Promise<{
	chat_messages_remaining: number;
	chat_session_used: boolean;
	voice_seconds_remaining: number;
	voice_session_used: boolean;
	exhausted: boolean;
}> {
	const [identity] = await db
		.select()
		.from(trialIdentity)
		.where(eq(trialIdentity.trialIdHash, trialIdHash))
		.limit(1);

	const maxMessages = env.TRIAL_CHAT_MAX_MESSAGES ?? 5;
	const maxSessions = env.TRIAL_CHAT_MAX_SESSIONS ?? 1;
	const maxVoiceSeconds = env.TRIAL_VOICE_MAX_SECONDS ?? 90;

	if (!identity) {
		return {
			chat_messages_remaining: maxMessages,
			chat_session_used: false,
			voice_seconds_remaining: maxVoiceSeconds,
			voice_session_used: false,
			exhausted: false,
		};
	}

	const exhausted = identity.exhaustedAt != null;
	return {
		chat_messages_remaining: Math.max(0, maxMessages - identity.chatMessagesUsed),
		chat_session_used: identity.chatSessionsUsed >= maxSessions,
		voice_seconds_remaining: Math.max(0, maxVoiceSeconds - identity.voiceSecondsUsed),
		voice_session_used: identity.voiceSessionsUsed >= (env.TRIAL_VOICE_MAX_SESSIONS ?? 1),
		exhausted,
	};
}
