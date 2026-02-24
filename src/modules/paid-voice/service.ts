import { SignJWT, jwtVerify } from 'jose';
import { db } from '@common/db';
import { paidVoiceSession } from '@common/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { env } from '@common/config/env';

/**
 * Paid Voice Service (OpenAI Realtime)
 * Token, session lookup, and usage recording for paid voice
 */

const PAID_VOICE_TOKEN_EXPIRY_SEC = 300;

export interface PaidVoiceSessionTokenPayload {
	sub: string;
	sessionId: string;
}

export async function createPaidVoiceSessionToken(
	userId: string,
	sessionId: string,
): Promise<string> {
	const secretStr =
		env.JWT_SECRET ||
		(env as { BETTER_AUTH_SECRET?: string }).BETTER_AUTH_SECRET ||
		'development-secret-min-32-characters-long';
	const secret = new TextEncoder().encode(secretStr);
	return new SignJWT({ sessionId })
		.setSubject(userId)
		.setProtectedHeader({ alg: 'HS256' })
		.setIssuedAt()
		.setExpirationTime(`${PAID_VOICE_TOKEN_EXPIRY_SEC}s`)
		.sign(secret);
}

export async function validatePaidVoiceSessionToken(
	token: string,
): Promise<PaidVoiceSessionTokenPayload | null> {
	try {
		const secretStr =
			env.JWT_SECRET ||
			(env as { BETTER_AUTH_SECRET?: string }).BETTER_AUTH_SECRET ||
			'development-secret-min-32-characters-long';
		const secret = new TextEncoder().encode(secretStr);
		const { payload } = await jwtVerify(token, secret);
		const sub = payload.sub;
		const sessionId = (payload as { sessionId?: string }).sessionId;
		if (typeof sub !== 'string' || typeof sessionId !== 'string') return null;
		return { sub, sessionId };
	} catch {
		return null;
	}
}

export async function getPaidVoiceSessionByIdAndUser(
	sessionId: string,
	userId: string,
): Promise<{ id: string; languageCode: string } | null> {
	const [result] = await db
		.select({ id: paidVoiceSession.id, languageCode: paidVoiceSession.languageCode })
		.from(paidVoiceSession)
		.where(
			and(
				eq(paidVoiceSession.id, sessionId),
				eq(paidVoiceSession.userId, userId),
				isNull(paidVoiceSession.endedAt),
			),
		)
		.limit(1);

	return result || null;
}

export async function recordPaidVoiceSession(
	userId: string,
	sessionId: string,
	secondsUsed: number,
	costEstimateUsd: number,
	languageCode: string,
): Promise<void> {
	await db
		.update(paidVoiceSession)
		.set({
			endedAt: new Date(),
			secondsUsed,
			costEstimateUsd: costEstimateUsd.toString(),
		})
		.where(eq(paidVoiceSession.id, sessionId));
}

/** Approximate cost per minute for OpenAI Realtime (~$0.06 input + $0.24 output) */
export const PAID_VOICE_COST_PER_MINUTE_USD = 0.3;
