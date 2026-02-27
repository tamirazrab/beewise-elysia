import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { difficultyLevelEnum } from './vocabulary';

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

export type SpeakPracticeSentence = typeof speakPracticeSentence.$inferSelect;
export type NewSpeakPracticeSentence = typeof speakPracticeSentence.$inferInsert;
