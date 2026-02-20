import { db } from '@common/db';
import {
	user,
	vocabularyItem,
	userVocabularyProgress,
	conversationSession,
	conversationMessage,
	userUsageDaily,
	userUsageMonthly,
	freeSubscriptionStatus,
	practiceSession,
	practiceRecording,
	quiz,
	quizQuestion,
	quizAttempt,
	favoriteItem,
} from '@common/db/schema';
import { appLogger } from '@common/logger';
import { eq } from 'drizzle-orm';

/**
 * Database Seed Script (OPTIONAL)
 * Populates the database with realistic sample data for development and testing.
 * Usage: bun run db:seed
 *
 * WARNING: Only run this in development environments.
 */

const SEED_USER_IDS = {
	admin: 'seed-admin-001',
	learner1: 'seed-learner-001',
	learner2: 'seed-learner-002',
	learner3: 'seed-learner-003',
} as const;

function todayDateStr(): string {
	const d = new Date();
	return d.toISOString().slice(0, 10);
}

function currentYearMonth(): { year: number; month: number } {
	const d = new Date();
	return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

async function seed() {
	appLogger.info('[SEED] Starting database seeding...');

	try {
		// --- Users (realistic learner personas + one admin) ---
		appLogger.info('[SEED] Creating sample users...');
		const insertedUsers = await db
			.insert(user)
			.values([
				{
					id: SEED_USER_IDS.admin,
					name: 'Alex Rivera',
					email: 'alex.rivera@beewise.demo',
					emailVerified: true,
					role: 'admin',
				},
				{
					id: SEED_USER_IDS.learner1,
					name: 'Maria Santos',
					email: 'maria.santos@beewise.demo',
					emailVerified: true,
				},
				{
					id: SEED_USER_IDS.learner2,
					name: 'James Chen',
					email: 'james.chen@beewise.demo',
					emailVerified: true,
				},
				{
					id: SEED_USER_IDS.learner3,
					name: 'Sophie Martin',
					email: 'sophie.martin@beewise.demo',
					emailVerified: true,
				},
			])
			.onConflictDoNothing()
			.returning();

		if (insertedUsers.length === 0) {
			appLogger.info('[SEED] Users already exist; continuing with other data...');
		} else {
			appLogger.info(`[SEED] Created ${insertedUsers.length} users`);
		}

		// --- Vocabulary items (realistic words: en, es, fr) ---
		appLogger.info('[SEED] Creating vocabulary items...');
		const vocabRows = [
			// English (beginner)
			{
				languageCode: 'en',
				difficultyLevel: 'beginner' as const,
				word: 'hello',
				meaning: 'a greeting',
				exampleSentence: 'Hello! How are you today?',
			},
			{
				languageCode: 'en',
				difficultyLevel: 'beginner' as const,
				word: 'water',
				meaning: 'a clear liquid essential for life',
				exampleSentence: 'Can I have a glass of water?',
			},
			{
				languageCode: 'en',
				difficultyLevel: 'beginner' as const,
				word: 'book',
				meaning: 'a written or printed work',
				exampleSentence: 'I am reading a book.',
			},
			// Spanish (beginner)
			{
				languageCode: 'es',
				difficultyLevel: 'beginner' as const,
				word: 'hola',
				meaning: 'hello',
				exampleSentence: '¡Hola! ¿Cómo estás?',
			},
			{
				languageCode: 'es',
				difficultyLevel: 'beginner' as const,
				word: 'agua',
				meaning: 'water',
				exampleSentence: 'Necesito un vaso de agua.',
			},
			{
				languageCode: 'es',
				difficultyLevel: 'beginner' as const,
				word: 'libro',
				meaning: 'book',
				exampleSentence: 'Este libro es muy interesante.',
			},
			// Spanish (intermediate)
			{
				languageCode: 'es',
				difficultyLevel: 'intermediate' as const,
				word: 'correr',
				meaning: 'to run',
				exampleSentence: 'Me gusta correr por la mañana.',
			},
			{
				languageCode: 'es',
				difficultyLevel: 'intermediate' as const,
				word: 'entender',
				meaning: 'to understand',
				exampleSentence: 'No entiendo la pregunta.',
			},
			// French (beginner)
			{
				languageCode: 'fr',
				difficultyLevel: 'beginner' as const,
				word: 'bonjour',
				meaning: 'hello / good day',
				exampleSentence: 'Bonjour, comment allez-vous?',
			},
			{
				languageCode: 'fr',
				difficultyLevel: 'beginner' as const,
				word: 'eau',
				meaning: 'water',
				exampleSentence: "L'eau est froide.",
			},
			{
				languageCode: 'fr',
				difficultyLevel: 'intermediate' as const,
				word: 'apprendre',
				meaning: 'to learn',
				exampleSentence: "J'aime apprendre de nouvelles langues.",
			},
			// English intermediate
			{
				languageCode: 'en',
				difficultyLevel: 'intermediate' as const,
				word: 'however',
				meaning: 'used to introduce a contrast',
				exampleSentence: 'I tried; however, I did not succeed.',
			},
			{
				languageCode: 'en',
				difficultyLevel: 'advanced' as const,
				word: 'nevertheless',
				meaning: 'in spite of that',
				exampleSentence: 'It was difficult; nevertheless, we finished on time.',
			},
		];

		const insertedVocab = await db
			.insert(vocabularyItem)
			.values(vocabRows)
			.onConflictDoNothing()
			.returning();

		const vocabIds = insertedVocab.length > 0 ? insertedVocab : await db.select({ id: vocabularyItem.id }).from(vocabularyItem).limit(vocabRows.length);
		appLogger.info(`[SEED] Vocabulary items: ${vocabIds.length} available`);

		// --- User vocabulary progress (link learners to some vocab) ---
		if (vocabIds.length >= 3) {
			await db
				.insert(userVocabularyProgress)
				.values([
					{
						userId: SEED_USER_IDS.learner1,
						vocabularyId: vocabIds[0].id,
						masteryLevel: 85,
						lastPracticedAt: new Date(),
					},
					{
						userId: SEED_USER_IDS.learner1,
						vocabularyId: vocabIds[1].id,
						masteryLevel: 40,
						lastPracticedAt: new Date(Date.now() - 86400 * 1000),
					},
					{
						userId: SEED_USER_IDS.learner2,
						vocabularyId: vocabIds[0].id,
						masteryLevel: 100,
						lastPracticedAt: new Date(),
					},
				])
				.onConflictDoUpdate({
					target: [userVocabularyProgress.userId, userVocabularyProgress.vocabularyId],
					set: { masteryLevel: 85, lastPracticedAt: new Date(), updatedAt: new Date() },
				});
			appLogger.info('[SEED] User vocabulary progress created/updated');
		}

		// --- Conversation sessions + messages (free AI chat) ---
		const existingSessions = await db
			.select({ id: conversationSession.id })
			.from(conversationSession)
			.where(eq(conversationSession.userId, SEED_USER_IDS.learner1))
			.limit(1);

		if (existingSessions.length === 0) {
			const [s1] = await db
				.insert(conversationSession)
				.values({
					userId: SEED_USER_IDS.learner1,
					languageCode: 'es',
					status: 'active',
					totalMessages: 3,
					totalTokensUsed: 120,
				})
				.returning();
			if (s1) {
				await db.insert(conversationMessage).values([
					{ sessionId: s1.id, role: 'system', content: 'You are a helpful Spanish tutor.', tokenCount: 10 },
					{ sessionId: s1.id, role: 'user', content: 'How do I say "I am learning Spanish"?', tokenCount: 8 },
					{ sessionId: s1.id, role: 'assistant', content: 'You say: "Estoy aprendiendo español."', tokenCount: 12 },
				]);
			}

			const [s2] = await db
				.insert(conversationSession)
				.values({
					userId: SEED_USER_IDS.learner1,
					languageCode: 'fr',
					status: 'closed',
					totalMessages: 2,
					totalTokensUsed: 50,
					closedAt: new Date(),
				})
				.returning();
			if (s2) {
				await db.insert(conversationMessage).values([
					{ sessionId: s2.id, role: 'user', content: 'What does "bonjour" mean?', tokenCount: 6 },
					{ sessionId: s2.id, role: 'assistant', content: '"Bonjour" means "hello" or "good day" in French.', tokenCount: 12 },
				]);
			}
			appLogger.info('[SEED] Conversation sessions and messages created');
		}

		// --- Usage (daily + monthly) for one user ---
		const dateStr = todayDateStr();
		const { year, month } = currentYearMonth();
		await db
			.insert(userUsageDaily)
			.values({
				userId: SEED_USER_IDS.learner1,
				usageDate: dateStr,
				messageCount: 15,
				tokenCount: 400,
				sessionCount: 2,
			})
			.onConflictDoUpdate({
				target: [userUsageDaily.userId, userUsageDaily.usageDate],
				set: { messageCount: 15, tokenCount: 400, sessionCount: 2 },
			});
		await db
			.insert(userUsageMonthly)
			.values({
				userId: SEED_USER_IDS.learner1,
				usageYear: year,
				usageMonth: month,
				sessionCount: 5,
			})
			.onConflictDoUpdate({
				target: [userUsageMonthly.userId, userUsageMonthly.usageYear, userUsageMonthly.usageMonth],
				set: { sessionCount: 5 },
			});
		appLogger.info('[SEED] Usage records created/updated');

		// --- Free subscription status ---
		await db
			.insert(freeSubscriptionStatus)
			.values({
				userId: SEED_USER_IDS.learner1,
				planType: 'free',
			})
			.onConflictDoUpdate({
				target: [freeSubscriptionStatus.userId],
				set: { planType: 'free', updatedAt: new Date() },
			});
		appLogger.info('[SEED] Free subscription status set');

		// --- Practice sessions + recordings ---
		const existingPractice = await db
			.select({ id: practiceSession.id })
			.from(practiceSession)
			.where(eq(practiceSession.userId, SEED_USER_IDS.learner1))
			.limit(1);
		if (existingPractice.length === 0) {
			const [ps1] = await db
				.insert(practiceSession)
				.values({
					userId: SEED_USER_IDS.learner1,
					type: 'speaking',
					languageCode: 'es',
				})
				.returning();
			if (ps1) {
				await db.insert(practiceRecording).values({
					sessionId: ps1.id,
					s3Key: 'seed/recordings/speaking-es-001.ogg',
					durationSeconds: 12,
					pronunciationScore: 78,
					aiFeedback: { score: 78, tips: ['Try to elongate the "r" in "correr".'] },
				});
			}
			appLogger.info('[SEED] Practice sessions and recordings created');
		}

		// --- Quizzes + questions + attempts ---
		const existingQuizzes = await db.select({ id: quiz.id }).from(quiz).limit(1);
		let quizIdToUse: string | null = null;
		if (existingQuizzes.length > 0) {
			quizIdToUse = existingQuizzes[0].id;
		} else {
			const [q1] = await db
				.insert(quiz)
				.values({
					languageCode: 'es',
					difficultyLevel: 'beginner',
				})
				.returning();
			if (q1) {
				quizIdToUse = q1.id;
				await db.insert(quizQuestion).values([
					{
						quizId: q1.id,
						questionText: 'What does "hola" mean?',
						options: ['Hello', 'Goodbye', 'Thanks', 'Please'],
						correctAnswerIndex: 0,
					},
					{
						quizId: q1.id,
						questionText: 'What is "agua" in English?',
						options: ['Fire', 'Water', 'Earth', 'Air'],
						correctAnswerIndex: 1,
					},
					{
						quizId: q1.id,
						questionText: 'How do you say "book" in Spanish?',
						options: ['mesa', 'libro', 'casa', 'silla'],
						correctAnswerIndex: 1,
					},
				]);
			}
			appLogger.info('[SEED] Quiz and questions created');
		}

		if (quizIdToUse) {
			const existingAttempt = await db
				.select()
				.from(quizAttempt)
				.where(eq(quizAttempt.userId, SEED_USER_IDS.learner1))
				.limit(1);
			if (existingAttempt.length === 0) {
				await db.insert(quizAttempt).values({
					userId: SEED_USER_IDS.learner1,
					quizId: quizIdToUse,
					score: '66.67',
					completedAt: new Date(),
				});
				appLogger.info('[SEED] Quiz attempt created');
			}
		}

		// --- Favorites ---
		if (vocabIds.length > 0) {
			await db
				.insert(favoriteItem)
				.values([
					{ userId: SEED_USER_IDS.learner1, itemType: 'vocabulary', itemId: vocabIds[0].id },
					{ userId: SEED_USER_IDS.learner1, itemType: 'vocabulary', itemId: vocabIds[1].id },
				])
				.onConflictDoNothing({ target: [favoriteItem.userId, favoriteItem.itemType, favoriteItem.itemId] });
			if (quizIdToUse) {
				await db
					.insert(favoriteItem)
					.values({ userId: SEED_USER_IDS.learner1, itemType: 'quiz', itemId: quizIdToUse })
					.onConflictDoNothing({ target: [favoriteItem.userId, favoriteItem.itemType, favoriteItem.itemId] });
			}
			appLogger.info('[SEED] Favorites created');
		}

		appLogger.info('[SEED] Database seeding completed successfully');
	} catch (error) {
		appLogger.error({ error }, '[SEED] Seeding failed');
		throw error;
	} finally {
		process.exit(0);
	}
}

seed();
