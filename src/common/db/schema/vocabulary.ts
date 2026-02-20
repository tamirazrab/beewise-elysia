import { pgEnum, pgTable, text, timestamp, uuid, integer, jsonb, decimal } from 'drizzle-orm/pg-core';
import { user } from './auth';

/**
 * Vocabulary tables - items, progress, practice sessions, quizzes, favorites
 */

export const difficultyLevelEnum = pgEnum('difficulty_level', ['beginner', 'intermediate', 'advanced']);
export const practiceTypeEnum = pgEnum('practice_type', ['speaking', 'listening']);
export const favoriteTypeEnum = pgEnum('favorite_type', ['vocabulary', 'quiz']);

export const vocabularyItem = pgTable('vocabulary_item', {
	id: uuid('id').primaryKey().defaultRandom(),
	languageCode: text('language_code').notNull(),
	difficultyLevel: difficultyLevelEnum('difficulty_level').notNull(),
	word: text('word').notNull(),
	meaning: text('meaning').notNull(),
	exampleSentence: text('example_sentence'),
	audioUrl: text('audio_url'),
	deletedAt: timestamp('deleted_at'),
	createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const userVocabularyProgress = pgTable('user_vocabulary_progress', {
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	vocabularyId: uuid('vocabulary_id')
		.notNull()
		.references(() => vocabularyItem.id, { onDelete: 'cascade' }),
	masteryLevel: integer('mastery_level').notNull().default(0),
	lastPracticedAt: timestamp('last_practiced_at'),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
	pk: { primaryKey: { columns: [table.userId, table.vocabularyId] } },
}));

export const practiceSession = pgTable('practice_session', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	type: practiceTypeEnum('type').notNull(),
	languageCode: text('language_code').notNull(),
	createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const practiceRecording = pgTable('practice_recording', {
	id: uuid('id').primaryKey().defaultRandom(),
	sessionId: uuid('session_id')
		.notNull()
		.references(() => practiceSession.id, { onDelete: 'cascade' }),
	s3Key: text('s3_key').notNull(),
	durationSeconds: integer('duration_seconds'),
	pronunciationScore: integer('pronunciation_score'),
	aiFeedback: jsonb('ai_feedback'),
	createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const quiz = pgTable('quiz', {
	id: uuid('id').primaryKey().defaultRandom(),
	languageCode: text('language_code').notNull(),
	difficultyLevel: difficultyLevelEnum('difficulty_level').notNull(),
	deletedAt: timestamp('deleted_at'),
	createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const quizQuestion = pgTable('quiz_question', {
	id: uuid('id').primaryKey().defaultRandom(),
	quizId: uuid('quiz_id')
		.notNull()
		.references(() => quiz.id, { onDelete: 'cascade' }),
	questionText: text('question_text').notNull(),
	options: jsonb('options').notNull(), // Array of strings
	correctAnswerIndex: integer('correct_answer_index').notNull(),
	createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const quizAttempt = pgTable('quiz_attempt', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	quizId: uuid('quiz_id')
		.notNull()
		.references(() => quiz.id, { onDelete: 'cascade' }),
	score: decimal('score', { precision: 5, scale: 2 }).notNull(),
	completedAt: timestamp('completed_at').notNull().defaultNow(),
});

export const favoriteItem = pgTable('favorite_item', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	itemType: favoriteTypeEnum('item_type').notNull(),
	itemId: uuid('item_id').notNull(),
	createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
	uniqueUserItem: { unique: { columns: [table.userId, table.itemType, table.itemId] } },
}));

export type VocabularyItem = typeof vocabularyItem.$inferSelect;
export type NewVocabularyItem = typeof vocabularyItem.$inferInsert;
export type UserVocabularyProgress = typeof userVocabularyProgress.$inferSelect;
export type NewUserVocabularyProgress = typeof userVocabularyProgress.$inferInsert;
export type PracticeSession = typeof practiceSession.$inferSelect;
export type NewPracticeSession = typeof practiceSession.$inferInsert;
export type PracticeRecording = typeof practiceRecording.$inferSelect;
export type NewPracticeRecording = typeof practiceRecording.$inferInsert;
export type Quiz = typeof quiz.$inferSelect;
export type NewQuiz = typeof quiz.$inferInsert;
export type QuizQuestion = typeof quizQuestion.$inferSelect;
export type NewQuizQuestion = typeof quizQuestion.$inferInsert;
export type QuizAttempt = typeof quizAttempt.$inferSelect;
export type NewQuizAttempt = typeof quizAttempt.$inferInsert;
export type FavoriteItem = typeof favoriteItem.$inferSelect;
export type NewFavoriteItem = typeof favoriteItem.$inferInsert;
