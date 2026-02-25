import {
	pgTable,
	text,
	timestamp,
	uuid,
	integer,
	jsonb,
	decimal,
} from 'drizzle-orm/pg-core';
import { vocabularyItem, quiz, practiceTypeEnum, favoriteTypeEnum } from './vocabulary';

/**
 * Anonymous (device-id) scoped vocabulary data for free-tier users without an account.
 * On signup with device_id, rows are migrated to user_* tables and user.linkedAnonymousIdHash is set.
 */

export const anonymousVocabularyProgress = pgTable(
	'anonymous_vocabulary_progress',
	{
		anonymousIdHash: text('anonymous_id_hash').notNull(),
		vocabularyId: uuid('vocabulary_id')
			.notNull()
			.references(() => vocabularyItem.id, { onDelete: 'cascade' }),
		masteryLevel: integer('mastery_level').notNull().default(0),
		lastPracticedAt: timestamp('last_practiced_at'),
		createdAt: timestamp('created_at').notNull().defaultNow(),
		updatedAt: timestamp('updated_at').notNull().defaultNow(),
	},
	(table) => ({
		pk: { primaryKey: { columns: [table.anonymousIdHash, table.vocabularyId] } },
	}),
);

export const anonymousPracticeSession = pgTable('anonymous_practice_session', {
	id: uuid('id').primaryKey().defaultRandom(),
	anonymousIdHash: text('anonymous_id_hash').notNull(),
	type: practiceTypeEnum('type').notNull(),
	languageCode: text('language_code').notNull(),
	createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const anonymousPracticeRecording = pgTable('anonymous_practice_recording', {
	id: uuid('id').primaryKey().defaultRandom(),
	sessionId: uuid('session_id')
		.notNull()
		.references(() => anonymousPracticeSession.id, { onDelete: 'cascade' }),
	s3Key: text('s3_key').notNull(),
	durationSeconds: integer('duration_seconds'),
	pronunciationScore: integer('pronunciation_score'),
	aiFeedback: jsonb('ai_feedback'),
	createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const anonymousQuizAttempt = pgTable('anonymous_quiz_attempt', {
	id: uuid('id').primaryKey().defaultRandom(),
	anonymousIdHash: text('anonymous_id_hash').notNull(),
	quizId: uuid('quiz_id')
		.notNull()
		.references(() => quiz.id, { onDelete: 'cascade' }),
	score: decimal('score', { precision: 5, scale: 2 }).notNull(),
	completedAt: timestamp('completed_at').notNull().defaultNow(),
});

export const anonymousFavoriteItem = pgTable(
	'anonymous_favorite_item',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		anonymousIdHash: text('anonymous_id_hash').notNull(),
		itemType: favoriteTypeEnum('item_type').notNull(),
		itemId: uuid('item_id').notNull(),
		createdAt: timestamp('created_at').notNull().defaultNow(),
	},
	(table) => ({
		uniqueAnonymousItem: { unique: { columns: [table.anonymousIdHash, table.itemType, table.itemId] } },
	}),
);

export type AnonymousVocabularyProgress = typeof anonymousVocabularyProgress.$inferSelect;
export type NewAnonymousVocabularyProgress = typeof anonymousVocabularyProgress.$inferInsert;
export type AnonymousPracticeSession = typeof anonymousPracticeSession.$inferSelect;
export type NewAnonymousPracticeSession = typeof anonymousPracticeSession.$inferInsert;
export type AnonymousPracticeRecording = typeof anonymousPracticeRecording.$inferSelect;
export type NewAnonymousPracticeRecording = typeof anonymousPracticeRecording.$inferInsert;
export type AnonymousQuizAttempt = typeof anonymousQuizAttempt.$inferSelect;
export type NewAnonymousQuizAttempt = typeof anonymousQuizAttempt.$inferInsert;
export type AnonymousFavoriteItem = typeof anonymousFavoriteItem.$inferSelect;
export type NewAnonymousFavoriteItem = typeof anonymousFavoriteItem.$inferInsert;
