import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { difficultyLevelEnum } from './vocabulary';

/**
 * Level order for progression: beginner → intermediate → advanced
 */
export const LEVEL_ORDER = ['beginner', 'intermediate', 'advanced'] as const;
export type SpeakPracticeLevel = (typeof LEVEL_ORDER)[number];

/**
 * Speak Practice - sentences for practice by language and level
 */
export const speakPracticeSentence = pgTable('speak_practice_sentence', {
  id: uuid('id').primaryKey().defaultRandom(),
  sentence: text('sentence').notNull(),
  languageCode: text('language_code').notNull(),
  level: difficultyLevelEnum('level').notNull(),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/**
 * User completion of speak-practice sentences (authenticated users)
 */
export const userSpeakPracticeCompletion = pgTable('user_speak_practice_completion', {
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  sentenceId: uuid('sentence_id')
    .notNull()
    .references(() => speakPracticeSentence.id, { onDelete: 'cascade' }),
  completedAt: timestamp('completed_at').notNull().defaultNow(),
}, (table) => ({
  pk: { primaryKey: { columns: [table.userId, table.sentenceId] } },
}));

/**
 * Anonymous completion of speak-practice sentences (device-id users)
 */
export const anonymousSpeakPracticeCompletion = pgTable('anonymous_speak_practice_completion', {
  anonymousIdHash: text('anonymous_id_hash').notNull(),
  sentenceId: uuid('sentence_id')
    .notNull()
    .references(() => speakPracticeSentence.id, { onDelete: 'cascade' }),
  completedAt: timestamp('completed_at').notNull().defaultNow(),
}, (table) => ({
  pk: { primaryKey: { columns: [table.anonymousIdHash, table.sentenceId] } },
}));

export type SpeakPracticeSentence = typeof speakPracticeSentence.$inferSelect;
export type NewSpeakPracticeSentence = typeof speakPracticeSentence.$inferInsert;
export type UserSpeakPracticeCompletion = typeof userSpeakPracticeCompletion.$inferSelect;
export type NewUserSpeakPracticeCompletion = typeof userSpeakPracticeCompletion.$inferInsert;
export type AnonymousSpeakPracticeCompletion = typeof anonymousSpeakPracticeCompletion.$inferSelect;
export type NewAnonymousSpeakPracticeCompletion = typeof anonymousSpeakPracticeCompletion.$inferInsert;
