import { db } from '@common/db';
import {
	userVocabularyProgress,
	favoriteItem,
	practiceSession,
	practiceRecording,
	quizAttempt,
	anonymousVocabularyProgress,
	anonymousFavoriteItem,
	anonymousPracticeSession,
	anonymousPracticeRecording,
	anonymousQuizAttempt,
} from '@common/db/schema';
import { eq, and, inArray } from 'drizzle-orm';

/**
 * Migrate anonymous (device-id) vocabulary data to a newly linked user.
 * Call after setting user.linkedAnonymousIdHash.
 * Idempotent: safe to call multiple times (skips or merges duplicates).
 */
export async function migrateAnonymousDataToUser(
	anonymousIdHash: string,
	userId: string,
): Promise<{ progress: number; favorites: number; practiceSessions: number; quizAttempts: number }> {
	let progress = 0;
	let favorites = 0;
	let practiceSessions = 0;
	let quizAttempts = 0;

	// Vocabulary progress: merge by max mastery
	const anonProgress = await db
		.select()
		.from(anonymousVocabularyProgress)
		.where(eq(anonymousVocabularyProgress.anonymousIdHash, anonymousIdHash));

	for (const row of anonProgress) {
		const [existing] = await db
			.select()
			.from(userVocabularyProgress)
			.where(
				and(
					eq(userVocabularyProgress.userId, userId),
					eq(userVocabularyProgress.vocabularyId, row.vocabularyId),
				),
			)
			.limit(1);
		if (existing) {
			const newMastery = Math.max(existing.masteryLevel, row.masteryLevel);
			if (newMastery !== existing.masteryLevel) {
				await db
					.update(userVocabularyProgress)
					.set({
						masteryLevel: newMastery,
						lastPracticedAt: row.lastPracticedAt ?? existing.lastPracticedAt,
						updatedAt: new Date(),
					})
					.where(
						and(
							eq(userVocabularyProgress.userId, userId),
							eq(userVocabularyProgress.vocabularyId, row.vocabularyId),
						),
					);
				progress++;
			}
		} else {
			await db.insert(userVocabularyProgress).values({
				userId,
				vocabularyId: row.vocabularyId,
				masteryLevel: row.masteryLevel,
				lastPracticedAt: row.lastPracticedAt,
			});
			progress++;
		}
	}

	// Favorites: insert if user doesn't have same item
	const anonFavs = await db
		.select()
		.from(anonymousFavoriteItem)
		.where(eq(anonymousFavoriteItem.anonymousIdHash, anonymousIdHash));

	for (const row of anonFavs) {
		const [existing] = await db
			.select()
			.from(favoriteItem)
			.where(
				and(
					eq(favoriteItem.userId, userId),
					eq(favoriteItem.itemType, row.itemType),
					eq(favoriteItem.itemId, row.itemId),
				),
			)
			.limit(1);
		if (!existing) {
			await db.insert(favoriteItem).values({
				userId,
				itemType: row.itemType,
				itemId: row.itemId,
			});
			favorites++;
		}
	}

	// Practice sessions + recordings: copy with new session ids
	const anonSessions = await db
		.select()
		.from(anonymousPracticeSession)
		.where(eq(anonymousPracticeSession.anonymousIdHash, anonymousIdHash));

	const oldToNewSessionId = new Map<string, string>();
	for (const row of anonSessions) {
		const [newSession] = await db
			.insert(practiceSession)
			.values({
				userId,
				type: row.type,
				languageCode: row.languageCode,
			})
			.returning({ id: practiceSession.id });
		if (newSession) {
			oldToNewSessionId.set(row.id, newSession.id);
			practiceSessions++;
		}
	}

	const anonSessionIds = anonSessions.map((s) => s.id);
	const anonRecordings =
		anonSessionIds.length > 0
			? await db
					.select()
					.from(anonymousPracticeRecording)
					.where(inArray(anonymousPracticeRecording.sessionId, anonSessionIds))
			: [];
	for (const row of anonRecordings) {
		const newSessionId = oldToNewSessionId.get(row.sessionId);
		if (newSessionId) {
			await db.insert(practiceRecording).values({
				sessionId: newSessionId,
				s3Key: row.s3Key,
				durationSeconds: row.durationSeconds,
				pronunciationScore: row.pronunciationScore,
				aiFeedback: row.aiFeedback,
			});
		}
	}

	// Quiz attempts
	const anonQuiz = await db
		.select()
		.from(anonymousQuizAttempt)
		.where(eq(anonymousQuizAttempt.anonymousIdHash, anonymousIdHash));

	for (const row of anonQuiz) {
		await db.insert(quizAttempt).values({
			userId,
			quizId: row.quizId,
			score: row.score,
			completedAt: row.completedAt,
		});
		quizAttempts++;
	}

	return { progress, favorites, practiceSessions, quizAttempts };
}
