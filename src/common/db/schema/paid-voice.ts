import { pgTable, text, timestamp, uuid, integer, decimal } from 'drizzle-orm/pg-core';
import { user } from './auth';

/**
 * Paid Voice (OpenAI Realtime) - sessions and usage
 */

export const paidVoiceSession = pgTable('paid_voice_session', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	startedAt: timestamp('started_at').notNull().defaultNow(),
	endedAt: timestamp('ended_at'),
	secondsUsed: integer('seconds_used').notNull().default(0),
	costEstimateUsd: decimal('cost_estimate_usd', { precision: 12, scale: 6 }).notNull().default('0'),
	languageCode: text('language_code').notNull(),
});

export type PaidVoiceSession = typeof paidVoiceSession.$inferSelect;
export type NewPaidVoiceSession = typeof paidVoiceSession.$inferInsert;
