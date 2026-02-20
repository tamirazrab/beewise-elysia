import { pgTable, text, timestamp, uuid, integer, decimal } from 'drizzle-orm/pg-core';
import { user } from './auth';

/**
 * Voice Chat tables - usage tracking and sessions
 */

export const voiceUsageDaily = pgTable('voice_usage_daily', {
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	usageDate: text('usage_date').notNull(), // Stored as DATE string (YYYY-MM-DD)
	secondsUsed: integer('seconds_used').notNull().default(0),
	costEstimateUsd: decimal('cost_estimate_usd', { precision: 12, scale: 6 }).notNull().default('0'),
	sessionCount: integer('session_count').notNull().default(0),
}, (table) => ({
	pk: { primaryKey: { columns: [table.userId, table.usageDate] } },
}));

export const voiceSession = pgTable('voice_session', {
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

export type VoiceUsageDaily = typeof voiceUsageDaily.$inferSelect;
export type NewVoiceUsageDaily = typeof voiceUsageDaily.$inferInsert;
export type VoiceSession = typeof voiceSession.$inferSelect;
export type NewVoiceSession = typeof voiceSession.$inferInsert;
