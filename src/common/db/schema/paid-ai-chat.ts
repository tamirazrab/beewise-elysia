import { pgTable, text, timestamp, uuid, integer, decimal } from 'drizzle-orm/pg-core';
import { user } from './auth';

/**
 * Paid AI Chat tables - sessions and usage tracking
 */

export const paidAISession = pgTable('paid_ai_session', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	languageCode: text('language_code').notNull(),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	lastMessageAt: timestamp('last_message_at').notNull().defaultNow(),
});

export const paidAIUsage = pgTable('paid_ai_usage', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	sessionId: uuid('session_id').references(() => paidAISession.id, { onDelete: 'set null' }),
	tokensUsed: integer('tokens_used').notNull(),
	costUsd: decimal('cost_usd', { precision: 10, scale: 6 }).notNull(),
	createdAt: timestamp('created_at').notNull().defaultNow(),
});

export type PaidAISession = typeof paidAISession.$inferSelect;
export type NewPaidAISession = typeof paidAISession.$inferInsert;
export type PaidAIUsage = typeof paidAIUsage.$inferSelect;
export type NewPaidAIUsage = typeof paidAIUsage.$inferInsert;
