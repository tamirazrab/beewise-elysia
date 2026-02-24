import { withAuth } from '@common/middleware/auth-guard';
import { withAdmin } from '@common/middleware/admin-guard';
import { db } from '@common/db';
import {
	vocabularyItem,
	userVocabularyProgress,
	practiceSession,
	practiceRecording,
	quiz,
	quizQuestion,
	quizAttempt,
	favoriteItem,
} from '@common/db/schema';
import { Elysia, t } from 'elysia';
import { eq, and, desc, isNull, sql, or, lt, asc } from 'drizzle-orm';
import * as service from './service';
import { randomUUID } from 'crypto';

/**
 * Vocabulary Module
 *
 * Comprehensive vocabulary learning endpoints including:
 * - Vocabulary CRUD (admin only for create/update/delete)
 * - Progress tracking
 * - Practice sessions and recordings
 * - Quizzes and attempts
 * - Favorites
 */

// Type definitions
const difficultyLevelEnum = t.Union([
	t.Literal('beginner'),
	t.Literal('intermediate'),
	t.Literal('advanced'),
]);

const practiceTypeEnum = t.Union([t.Literal('speaking'), t.Literal('listening')]);

const favoriteTypeEnum = t.Union([t.Literal('vocabulary'), t.Literal('quiz')]);

// Schemas (with descriptions for API docs)
const createVocabularySchema = t.Object({
	languageCode: t.String({
		minLength: 2,
		maxLength: 5,
		description: 'ISO 639-1 language code (e.g. en, es, fr)',
	}),
	difficultyLevel: difficultyLevelEnum,
	word: t.String({ minLength: 1, description: 'The word or phrase in the target language' }),
	meaning: t.String({ minLength: 1, description: 'Meaning or translation' }),
	exampleSentence: t.Optional(t.Nullable(t.String({ description: 'Example sentence using the word' }))),
	audioUrl: t.Optional(t.Nullable(t.String({ description: 'Optional URL to pronunciation audio' }))),
});

const updateVocabularySchema = t.Object({
	languageCode: t.Optional(t.String({ minLength: 2, maxLength: 5, description: 'ISO 639-1 language code' })),
	difficultyLevel: t.Optional(difficultyLevelEnum),
	word: t.Optional(t.String({ minLength: 1 })),
	meaning: t.Optional(t.String({ minLength: 1 })),
	exampleSentence: t.Optional(t.Nullable(t.String())),
	audioUrl: t.Optional(t.Nullable(t.String())),
});

const updateProgressSchema = t.Object({
	masteryLevel: t.Number({
		minimum: 0,
		maximum: 100,
		description: 'Mastery level 0–100 for this vocabulary item',
	}),
});

const createPracticeSessionSchema = t.Object({
	type: practiceTypeEnum,
	languageCode: t.String({ minLength: 2, maxLength: 5, description: 'ISO 639-1 language code' }),
});

const createRecordingSchema = t.Object({
	durationSeconds: t.Optional(t.Nullable(t.Number({ description: 'Recording length in seconds' }))),
});

const createQuizSchema = t.Object({
	languageCode: t.String({ minLength: 2, maxLength: 5, description: 'ISO 639-1 language code' }),
	difficultyLevel: difficultyLevelEnum,
	questions: t.Array(
		t.Object({
			questionText: t.String({ minLength: 1 }),
			options: t.Array(t.String(), { minItems: 2 }),
			correctAnswerIndex: t.Number({ minimum: 0, description: 'Index of the correct option (0-based)' }),
		}),
		{ minItems: 1 },
	),
});

const generateQuizSchema = t.Object({
	languageCode: t.String({ minLength: 2, maxLength: 5, description: 'ISO 639-1 language code' }),
	difficultyLevel: difficultyLevelEnum,
	numQuestions: t.Optional(t.Number({ minimum: 1, maximum: 50, default: 10 })),
});

const submitQuizAttemptSchema = t.Object({
	answers: t.Array(t.Number(), {
		minItems: 1,
		description: 'Array of chosen option indices (0-based) per question, in order',
	}),
});

const addFavoriteSchema = t.Object({
	itemType: favoriteTypeEnum,
	itemId: t.String({ format: 'uuid', description: 'UUID of the vocabulary item or quiz' }),
});

export const vocabularyModule = withAdmin(
	withAuth(new Elysia({ prefix: '/api/vocabulary' })),
)
	// ==================== Vocabulary CRUD ====================

	// GET /api/vocabulary - List vocabulary items
	.get(
		'/',
		async ({ query, set }: any) => {
			const limit = query.limit || 20;
			const offset = query.offset || 0;

			const conditions = [isNull(vocabularyItem.deletedAt)];

			if (query.languageCode) {
				conditions.push(eq(vocabularyItem.languageCode, query.languageCode));
			}
			if (query.difficultyLevel) {
				conditions.push(eq(vocabularyItem.difficultyLevel, query.difficultyLevel));
			}

			const items = await db
				.select()
				.from(vocabularyItem)
				.where(and(...conditions))
				.orderBy(desc(vocabularyItem.createdAt))
				.limit(limit)
				.offset(offset);

			const [{ count }] = await db
				.select({ count: sql<number>`count(*)` })
				.from(vocabularyItem)
				.where(and(...conditions));

			return {
				items,
				total: Number(count),
			};
		},
		{
			query: t.Object({
				languageCode: t.Optional(t.String()),
				difficultyLevel: t.Optional(difficultyLevelEnum),
				limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
				offset: t.Optional(t.Number({ minimum: 0 })),
			}),
			detail: {
				tags: ['Vocabulary'],
				summary: 'List vocabulary items',
				description: 'Get paginated list of vocabulary items with optional filters',
			},
		},
	)

	// GET /api/vocabulary/search - Search vocabulary
	.get(
		'/search',
		async ({ query, set }: any) => {
			const limit = query.limit || 20;
			const searchQuery = query.query;

			if (!searchQuery || searchQuery.trim().length === 0) {
				set.status = 400;
				return { error: 'Bad Request', message: 'Query parameter is required' };
			}

			const conditions = [
				isNull(vocabularyItem.deletedAt),
				sql`to_tsvector('english', ${vocabularyItem.word}) @@ plainto_tsquery('english', ${searchQuery})`,
			];

			if (query.languageCode) {
				conditions.push(eq(vocabularyItem.languageCode, query.languageCode));
			}

			const items = await db
				.select()
				.from(vocabularyItem)
				.where(and(...conditions))
				.orderBy(
					sql`ts_rank(to_tsvector('english', ${vocabularyItem.word}), plainto_tsquery('english', ${searchQuery})) DESC`,
				)
				.limit(limit);

			return { items };
		},
		{
			query: t.Object({
				query: t.String({ minLength: 1 }),
				languageCode: t.Optional(t.String()),
				limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
			}),
			detail: {
				tags: ['Vocabulary'],
				summary: 'Search vocabulary',
				description: 'Search vocabulary items by word using full-text search',
			},
		},
	)

	// GET /api/vocabulary/:id - Get vocabulary item
	.get(
		'/:id',
		async ({ params, set }: any) => {
			const [item] = await db
				.select()
				.from(vocabularyItem)
				.where(and(eq(vocabularyItem.id, params.id), isNull(vocabularyItem.deletedAt)));

			if (!item) {
				set.status = 404;
				return { error: 'Not Found', message: 'Vocabulary item not found' };
			}

			return { data: item };
		},
		{
			params: t.Object({
				id: t.String({ format: 'uuid' }),
			}),
			detail: {
				tags: ['Vocabulary'],
				summary: 'Get vocabulary item',
				description: 'Get a single vocabulary item by ID',
			},
		},
	)

	// POST /api/vocabulary - Create vocabulary item (admin only)
	.post(
		'/',
		async ({ body, set }: any) => {
			const [item] = await db
				.insert(vocabularyItem)
				.values({
					languageCode: body.languageCode,
					difficultyLevel: body.difficultyLevel,
					word: body.word.trim(),
					meaning: body.meaning.trim(),
					exampleSentence: body.exampleSentence ?? null,
					audioUrl: body.audioUrl ?? null,
				})
				.returning();

			set.status = 201;
			return {
				message: 'Vocabulary item created successfully',
				data: item,
			};
		},
		{
			// auth: true,
			admin: true,
			body: createVocabularySchema,
			detail: {
				tags: ['Vocabulary'],
				summary: 'Create vocabulary item',
				description: 'Admin only. Create a new vocabulary item. Body prefilled with a realistic example.',
				requestBody: {
					content: {
						'application/json': {
							example: {
								languageCode: 'es',
								difficultyLevel: 'beginner',
								word: 'hola',
								meaning: 'hello',
								exampleSentence: '¡Hola! ¿Cómo estás?',
							},
						},
					},
				},
			},
		},
	)

	// PUT /api/vocabulary/:id - Update vocabulary item (admin only)
	.put(
		'/:id',
		async ({ params, body, set }: any) => {
			const [existing] = await db
				.select()
				.from(vocabularyItem)
				.where(and(eq(vocabularyItem.id, params.id), isNull(vocabularyItem.deletedAt)));

			if (!existing) {
				set.status = 404;
				return { error: 'Not Found', message: 'Vocabulary item not found' };
			}

			const updateData: any = {};
			if (body.languageCode !== undefined) updateData.languageCode = body.languageCode;
			if (body.difficultyLevel !== undefined) updateData.difficultyLevel = body.difficultyLevel;
			if (body.word !== undefined) updateData.word = body.word.trim();
			if (body.meaning !== undefined) updateData.meaning = body.meaning.trim();
			if (body.exampleSentence !== undefined) updateData.exampleSentence = body.exampleSentence;
			if (body.audioUrl !== undefined) updateData.audioUrl = body.audioUrl;

			const [item] = await db
				.update(vocabularyItem)
				.set(updateData)
				.where(eq(vocabularyItem.id, params.id))
				.returning();

			return {
				message: 'Vocabulary item updated successfully',
				data: item,
			};
		},
		{
			// auth: true,
			admin: true,
			params: t.Object({
				id: t.String({ format: 'uuid' }),
			}),
			body: updateVocabularySchema,
			detail: {
				tags: ['Vocabulary'],
				summary: 'Update vocabulary item',
				description: 'Admin only. Update an existing vocabulary item. Send only fields to change.',
				requestBody: {
					content: {
						'application/json': {
							example: { meaning: 'hello; hi', exampleSentence: 'Hola, buenos días.' },
						},
					},
				},
			},
		},
	)

	// DELETE /api/vocabulary/:id - Delete vocabulary item (admin only)
	.delete(
		'/:id',
		async ({ params, set }: any) => {
			const [existing] = await db
				.select()
				.from(vocabularyItem)
				.where(and(eq(vocabularyItem.id, params.id), isNull(vocabularyItem.deletedAt)));

			if (!existing) {
				set.status = 404;
				return { error: 'Not Found', message: 'Vocabulary item not found' };
			}

			await db
				.update(vocabularyItem)
				.set({ deletedAt: new Date() })
				.where(eq(vocabularyItem.id, params.id));

			return {
				message: 'Vocabulary item deleted successfully',
			};
		},
		{
			// auth: true,
			admin: true,
			params: t.Object({
				id: t.String({ format: 'uuid' }),
			}),
			detail: {
				tags: ['Vocabulary'],
				summary: 'Delete vocabulary item',
				description: 'Admin only - Soft delete a vocabulary item',
			},
		},
	)

	// ==================== Progress Endpoints ====================

	// GET /api/vocabulary/progress - Get user progress
	.get(
		'/progress',
		async ({ query, user, set }: any) => {
			const conditions = [eq(userVocabularyProgress.userId, user.id)];

			if (query.vocabularyId) {
				conditions.push(eq(userVocabularyProgress.vocabularyId, query.vocabularyId));
			}

			const progress = await db
				.select()
				.from(userVocabularyProgress)
				.where(and(...conditions))
				.orderBy(desc(userVocabularyProgress.updatedAt));

			return { progress };
		},
		{
			// auth: true,
			query: t.Object({
				vocabularyId: t.Optional(t.String({ format: 'uuid' })),
			}),
			detail: {
				tags: ['Progress'],
				summary: 'Get user progress',
				description: 'Get vocabulary progress for the authenticated user',
			},
		},
	)

	// PUT /api/vocabulary/progress/:vocabularyId - Update progress
	.put(
		'/progress/:vocabularyId',
		async ({ params, body, user, set }: any) => {
			const [progress] = await db
				.insert(userVocabularyProgress)
				.values({
					userId: user.id,
					vocabularyId: params.vocabularyId,
					masteryLevel: body.masteryLevel,
					lastPracticedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: [userVocabularyProgress.userId, userVocabularyProgress.vocabularyId],
					set: {
						masteryLevel: body.masteryLevel,
						lastPracticedAt: new Date(),
						updatedAt: new Date(),
					},
				})
				.returning();

			return {
				message: 'Progress updated successfully',
				data: progress,
			};
		},
		{
			// auth: true,
			params: t.Object({
				vocabularyId: t.String({ format: 'uuid' }),
			}),
			body: updateProgressSchema,
			detail: {
				tags: ['Progress'],
				summary: 'Update progress',
				description: 'Authenticated. Update or create vocabulary progress (mastery 0–100). Body prefilled.',
				requestBody: {
					content: {
						'application/json': {
							example: { masteryLevel: 75 },
						},
					},
				},
			},
		},
	)

	// GET /api/vocabulary/progress/review - Get review items
	.get(
		'/progress/review',
		async ({ user }: any) => {
			const sevenDaysAgo = new Date();
			sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

			const items = await db
				.select({
					id: vocabularyItem.id,
					languageCode: vocabularyItem.languageCode,
					difficultyLevel: vocabularyItem.difficultyLevel,
					word: vocabularyItem.word,
					meaning: vocabularyItem.meaning,
					exampleSentence: vocabularyItem.exampleSentence,
					audioUrl: vocabularyItem.audioUrl,
					createdAt: vocabularyItem.createdAt,
				})
				.from(vocabularyItem)
				.leftJoin(
					userVocabularyProgress,
					and(
						eq(vocabularyItem.id, userVocabularyProgress.vocabularyId),
						eq(userVocabularyProgress.userId, user.id),
					),
				)
				.where(
					and(
						isNull(vocabularyItem.deletedAt),
						or(
							isNull(userVocabularyProgress.masteryLevel),
							lt(userVocabularyProgress.masteryLevel, 80),
							isNull(userVocabularyProgress.lastPracticedAt),
							lt(userVocabularyProgress.lastPracticedAt, sevenDaysAgo),
						),
					),
				)
				.orderBy(asc(userVocabularyProgress.lastPracticedAt))
				.limit(20);

			return { items };
		},
		{
			// // auth: true,
			detail: {
				tags: ['Progress'],
				summary: 'Get review items',
				description: 'Get vocabulary items that need review (mastery < 80% or not practiced in 7 days)',
			},
		},
	)

	// ==================== Practice Session Endpoints ====================

	// POST /api/vocabulary/practice/sessions - Create practice session
	.post(
		'/practice/sessions',
		async ({ body, user, set }: any) => {
			const [session] = await db
				.insert(practiceSession)
				.values({
					userId: user.id,
					type: body.type,
					languageCode: body.languageCode,
				})
				.returning();

			set.status = 201;
			return {
				message: 'Practice session created successfully',
				data: session,
			};
		},
		{
			// // auth: true,
			body: createPracticeSessionSchema,
			detail: {
				tags: ['Practice'],
				summary: 'Create practice session',
				description: 'Authenticated. Create a new speaking or listening practice session. Body prefilled.',
				requestBody: {
					content: {
						'application/json': {
							example: { type: 'speaking', languageCode: 'es' },
						},
					},
				},
			},
		},
	)

	// GET /api/vocabulary/practice/sessions - List practice sessions
	.get(
		'/practice/sessions',
		async ({ query, user }: any) => {
			const limit = query.limit || 20;
			const offset = query.offset || 0;

			const sessions = await db
				.select()
				.from(practiceSession)
				.where(eq(practiceSession.userId, user.id))
				.orderBy(desc(practiceSession.createdAt))
				.limit(limit)
				.offset(offset);

			return { sessions };
		},
		{
			// auth: true,
			query: t.Object({
				limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
				offset: t.Optional(t.Number({ minimum: 0 })),
			}),
			detail: {
				tags: ['Practice'],
				summary: 'List practice sessions',
				description: 'Get paginated list of practice sessions for the authenticated user',
			},
		},
	)

	// GET /api/vocabulary/practice/sessions/:id - Get practice session
	.get(
		'/practice/sessions/:id',
		async ({ params, user, set }: any) => {
			const [session] = await db
				.select()
				.from(practiceSession)
				.where(and(eq(practiceSession.id, params.id), eq(practiceSession.userId, user.id)));

			if (!session) {
				set.status = 404;
				return { error: 'Not Found', message: 'Practice session not found' };
			}

			return { data: session };
		},
		{
			// auth: true,
			params: t.Object({
				id: t.String({ format: 'uuid' }),
			}),
			detail: {
				tags: ['Practice'],
				summary: 'Get practice session',
				description: 'Get a single practice session by ID',
			},
		},
	)

	// ==================== Practice Recording Endpoints ====================

	// POST /api/vocabulary/practice/sessions/:id/recordings - Create recording with upload URL
	.post(
		'/practice/sessions/:id/recordings',
		async ({ params, body, user, set }: any) => {
			const [session] = await db
				.select()
				.from(practiceSession)
				.where(and(eq(practiceSession.id, params.id), eq(practiceSession.userId, user.id)));

			if (!session) {
				set.status = 404;
				return { error: 'Not Found', message: 'Practice session not found' };
			}

			const recordingId = randomUUID();
			const s3Key = service.generateS3Key(user.id, params.id, recordingId);

			const [recording] = await db
				.insert(practiceRecording)
				.values({
					sessionId: params.id,
					s3Key,
					durationSeconds: body.durationSeconds ?? null,
				})
				.returning();

			const uploadUrl = await service.generateUploadSignedUrl(s3Key);

			set.status = 201;
			return {
				message: 'Recording created successfully',
				data: {
					recordingId: recording.id,
					uploadUrl,
				},
			};
		},
		{
			// auth: true,
			params: t.Object({
				id: t.String({ format: 'uuid' }),
			}),
			body: createRecordingSchema,
			detail: {
				tags: ['Practice'],
				summary: 'Create recording',
				description: 'Authenticated. Create a practice recording and get an S3 upload URL. Body prefilled.',
				requestBody: {
					content: {
						'application/json': {
							example: { durationSeconds: 12 },
						},
					},
				},
			},
		},
	)

	// GET /api/vocabulary/practice/sessions/:id/recordings - List recordings
	.get(
		'/practice/sessions/:id/recordings',
		async ({ params, user, set }: any) => {
			const [session] = await db
				.select()
				.from(practiceSession)
				.where(and(eq(practiceSession.id, params.id), eq(practiceSession.userId, user.id)));

			if (!session) {
				set.status = 404;
				return { error: 'Not Found', message: 'Practice session not found' };
			}

			const recordings = await db
				.select()
				.from(practiceRecording)
				.where(eq(practiceRecording.sessionId, params.id))
				.orderBy(desc(practiceRecording.createdAt));

			return { recordings };
		},
		{
			// auth: true,
			params: t.Object({
				id: t.String({ format: 'uuid' }),
			}),
			detail: {
				tags: ['Practice'],
				summary: 'List recordings',
				description: 'Get all recordings for a practice session',
			},
		},
	)

	// GET /api/vocabulary/practice/recordings/:id - Get recording with download URL
	.get(
		'/practice/recordings/:id',
		async ({ params, user, set }: any) => {
			const [recording] = await db
				.select({
					id: practiceRecording.id,
					sessionId: practiceRecording.sessionId,
					s3Key: practiceRecording.s3Key,
					durationSeconds: practiceRecording.durationSeconds,
					pronunciationScore: practiceRecording.pronunciationScore,
					aiFeedback: practiceRecording.aiFeedback,
					createdAt: practiceRecording.createdAt,
				})
				.from(practiceRecording)
				.innerJoin(practiceSession, eq(practiceRecording.sessionId, practiceSession.id))
				.where(
					and(eq(practiceRecording.id, params.id), eq(practiceSession.userId, user.id)),
				);

			if (!recording) {
				set.status = 404;
				return { error: 'Not Found', message: 'Recording not found' };
			}

			const downloadUrl = await service.generateDownloadSignedUrl(recording.s3Key);

			return {
				data: {
					...recording,
					downloadUrl,
				},
			};
		},
		{
			// auth: true,
			params: t.Object({
				id: t.String({ format: 'uuid' }),
			}),
			detail: {
				tags: ['Practice'],
				summary: 'Get recording',
				description: 'Get a recording with S3 download URL',
			},
		},
	)

	// ==================== Quiz Endpoints ====================

	// GET /api/vocabulary/quizzes - List quizzes
	.get(
		'/quizzes',
		async ({ query }: any) => {
			const limit = query.limit || 20;
			const offset = query.offset || 0;

			const conditions = [isNull(quiz.deletedAt)];

			if (query.languageCode) {
				conditions.push(eq(quiz.languageCode, query.languageCode));
			}
			if (query.difficultyLevel) {
				conditions.push(eq(quiz.difficultyLevel, query.difficultyLevel));
			}

			const quizzes = await db
				.select()
				.from(quiz)
				.where(and(...conditions))
				.orderBy(desc(quiz.createdAt))
				.limit(limit)
				.offset(offset);

			const [{ count }] = await db
				.select({ count: sql<number>`count(*)` })
				.from(quiz)
				.where(and(...conditions));

			return {
				quizzes,
				total: Number(count),
			};
		},
		{
			// auth: true,
			query: t.Object({
				languageCode: t.Optional(t.String()),
				difficultyLevel: t.Optional(difficultyLevelEnum),
				limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
				offset: t.Optional(t.Number({ minimum: 0 })),
			}),
			detail: {
				tags: ['Quiz'],
				summary: 'List quizzes',
				description: 'Get paginated list of quizzes with optional filters',
			},
		},
	)

	// GET /api/vocabulary/quizzes/:id - Get quiz with questions
	.get(
		'/quizzes/:id',
		async ({ params, set }: any) => {
			const [quizData] = await db
				.select()
				.from(quiz)
				.where(and(eq(quiz.id, params.id), isNull(quiz.deletedAt)));

			if (!quizData) {
				set.status = 404;
				return { error: 'Not Found', message: 'Quiz not found' };
			}

			const questions = await db
				.select()
				.from(quizQuestion)
				.where(eq(quizQuestion.quizId, params.id))
				.orderBy(asc(quizQuestion.createdAt));

			return {
				data: {
					...quizData,
					questions,
				},
			};
		},
		{
			// auth: true,
			params: t.Object({
				id: t.String({ format: 'uuid' }),
			}),
			detail: {
				tags: ['Quiz'],
				summary: 'Get quiz',
				description: 'Get a quiz with all its questions',
			},
		},
	)

	// POST /api/vocabulary/quizzes - Create quiz (admin only)
	.post(
		'/quizzes',
		async ({ body, set }: any) => {
			const [quizData] = await db
				.insert(quiz)
				.values({
					languageCode: body.languageCode,
					difficultyLevel: body.difficultyLevel,
				})
				.returning();

			const questions = await db
				.insert(quizQuestion)
				.values(
					body.questions.map((q: any) => ({
						quizId: quizData.id,
						questionText: q.questionText,
						options: q.options,
						correctAnswerIndex: q.correctAnswerIndex,
					})),
				)
				.returning();

			set.status = 201;
			return {
				message: 'Quiz created successfully',
				data: {
					...quizData,
					questions,
				},
			};
		},
		{
			// auth: true,
			admin: true,
			body: createQuizSchema,
			detail: {
				tags: ['Quiz'],
				summary: 'Create quiz',
				description: 'Admin only. Create a new quiz with questions. Body prefilled with a realistic example.',
				requestBody: {
					content: {
						'application/json': {
							example: {
								languageCode: 'es',
								difficultyLevel: 'beginner',
								questions: [
									{
										questionText: 'What does "hola" mean?',
										options: ['Hello', 'Goodbye', 'Thanks'],
										correctAnswerIndex: 0,
									},
									{
										questionText: 'What is "agua" in English?',
										options: ['Fire', 'Water', 'Earth'],
										correctAnswerIndex: 1,
									},
								],
							},
						},
					},
				},
			},
		},
	)

	// POST /api/vocabulary/quizzes/generate - Generate quiz (admin only)
	.post(
		'/quizzes/generate',
		async ({ body, set }: any) => {
			// TODO: Implement quiz generation logic
			set.status = 501;
			return {
				error: 'Not Implemented',
				message: 'Quiz generation is not yet implemented',
			};
		},
		{
			// auth: true,
			admin: true,
			body: generateQuizSchema,
			detail: {
				tags: ['Quiz'],
				summary: 'Generate quiz',
				description: 'Admin only. Generate a quiz using AI (not yet implemented). Body prefilled.',
				requestBody: {
					content: {
						'application/json': {
							example: { languageCode: 'es', difficultyLevel: 'beginner', numQuestions: 10 },
						},
					},
				},
			},
		},
	)

	// ==================== Quiz Attempt Endpoints ====================

	// POST /api/vocabulary/quizzes/:id/attempts - Submit quiz attempt
	.post(
		'/quizzes/:id/attempts',
		async ({ params, body, user, set }: any) => {
			const [quizData] = await db
				.select()
				.from(quiz)
				.where(and(eq(quiz.id, params.id), isNull(quiz.deletedAt)));

			if (!quizData) {
				set.status = 404;
				return { error: 'Not Found', message: 'Quiz not found' };
			}

			const questions = await db
				.select()
				.from(quizQuestion)
				.where(eq(quizQuestion.quizId, params.id))
				.orderBy(asc(quizQuestion.createdAt));

			if (questions.length !== body.answers.length) {
				set.status = 400;
				return {
					error: 'Bad Request',
					message: 'Number of answers does not match number of questions',
				};
			}

			let correctCount = 0;
			for (let i = 0; i < questions.length; i++) {
				if (questions[i].correctAnswerIndex === body.answers[i]) {
					correctCount++;
				}
			}

			const score = (correctCount / questions.length) * 100;

			const [attempt] = await db
				.insert(quizAttempt)
				.values({
					userId: user.id,
					quizId: params.id,
					score: score.toString(),
					completedAt: new Date(),
				})
				.returning();

			set.status = 201;
			return {
				message: 'Quiz attempt submitted successfully',
				data: attempt,
			};
		},
		{
			// auth: true,
			params: t.Object({
				id: t.String({ format: 'uuid' }),
			}),
			body: submitQuizAttemptSchema,
			detail: {
				tags: ['Quiz'],
				summary: 'Submit quiz attempt',
				description: 'Authenticated. Submit answer indices (0-based) for each question. Body prefilled.',
				requestBody: {
					content: {
						'application/json': {
							example: { answers: [0, 1, 2] },
						},
					},
				},
			},
		},
	)

	// GET /api/vocabulary/quizzes/attempts - List quiz attempts
	.get(
		'/quizzes/attempts',
		async ({ query, user }: any) => {
			const limit = query.limit || 20;

			const conditions = [eq(quizAttempt.userId, user.id)];

			if (query.quizId) {
				conditions.push(eq(quizAttempt.quizId, query.quizId));
			}

			const attempts = await db
				.select()
				.from(quizAttempt)
				.where(and(...conditions))
				.orderBy(desc(quizAttempt.completedAt))
				.limit(limit);

			return { attempts };
		},
		{
			// auth: true,
			query: t.Object({
				quizId: t.Optional(t.String({ format: 'uuid' })),
				limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
			}),
			detail: {
				tags: ['Quiz'],
				summary: 'List quiz attempts',
				description: 'Get quiz attempts for the authenticated user',
			},
		},
	)

	// ==================== Favorite Endpoints ====================

	// POST /api/vocabulary/favorites - Add favorite
	.post(
		'/favorites',
		async ({ body, user, set }: any) => {
			const [favorite] = await db
				.insert(favoriteItem)
				.values({
					userId: user.id,
					itemType: body.itemType,
					itemId: body.itemId,
				})
				.onConflictDoNothing({
					target: [favoriteItem.userId, favoriteItem.itemType, favoriteItem.itemId],
				})
				.returning();

			if (!favorite) {
				// Already exists, fetch it
				const [existing] = await db
					.select()
					.from(favoriteItem)
					.where(
						and(
							eq(favoriteItem.userId, user.id),
							eq(favoriteItem.itemType, body.itemType),
							eq(favoriteItem.itemId, body.itemId),
						),
					);

				set.status = 200;
				return {
					message: 'Favorite already exists',
					data: existing,
				};
			}

			set.status = 201;
			return {
				message: 'Favorite added successfully',
				data: favorite,
			};
		},
		{
			// auth: true,
			body: addFavoriteSchema,
			detail: {
				tags: ['Favorites'],
				summary: 'Add favorite',
				description: 'Authenticated. Add a vocabulary item or quiz to favorites. Body prefilled (replace itemId with a real UUID).',
				requestBody: {
					content: {
						'application/json': {
							example: { itemType: 'vocabulary', itemId: '00000000-0000-0000-0000-000000000001' },
						},
					},
				},
			},
		},
	)

	// DELETE /api/vocabulary/favorites/:itemType/:itemId - Remove favorite
	.delete(
		'/favorites/:itemType/:itemId',
		async ({ params, user }: any) => {
			await db
				.delete(favoriteItem)
				.where(
					and(
						eq(favoriteItem.userId, user.id),
						eq(favoriteItem.itemType, params.itemType),
						eq(favoriteItem.itemId, params.itemId),
					),
				);

			return {
				message: 'Favorite removed successfully',
			};
		},
		{
			// auth: true,
			params: t.Object({
				itemType: favoriteTypeEnum,
				itemId: t.String({ format: 'uuid' }),
			}),
			detail: {
				tags: ['Favorites'],
				summary: 'Remove favorite',
				description: 'Remove a vocabulary item or quiz from favorites',
			},
		},
	)

	// GET /api/vocabulary/favorites - List favorites
	.get(
		'/favorites',
		async ({ query, user }: any) => {
			const limit = query.limit || 20;

			const conditions = [eq(favoriteItem.userId, user.id)];

			if (query.itemType) {
				conditions.push(eq(favoriteItem.itemType, query.itemType));
			}

			const favorites = await db
				.select()
				.from(favoriteItem)
				.where(and(...conditions))
				.orderBy(desc(favoriteItem.createdAt))
				.limit(limit);

			return { favorites };
		},
		{
			// auth: true,
			query: t.Object({
				itemType: t.Optional(favoriteTypeEnum),
				limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
			}),
			detail: {
				tags: ['Favorites'],
				summary: 'List favorites',
				description: 'Get favorites for the authenticated user',
			},
		},
	);
