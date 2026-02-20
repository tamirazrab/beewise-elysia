import { pgEnum, pgTable, text, timestamp, uuid, integer, decimal } from 'drizzle-orm/pg-core';
import { user } from './auth';

/**
 * Free AI Chat tables - conversation sessions, messages, usage tracking
 */

const sessionStatusEnum = pgEnum('session_status', ['active', 'closed']);
const planTypeEnum = pgEnum('plan_type', ['free', 'trial', 'expired']);

export const conversationSession = pgTable('conversation_session', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	languageCode: text('language_code').notNull(),
	totalMessages: integer('total_messages').notNull().default(0),
	totalTokensUsed: integer('total_tokens_used').notNull().default(0),
	aiCostEstimateUsd: decimal('ai_cost_estimate_usd', { precision: 10, scale: 6 }).notNull().default('0'),
	sessionDurationSeconds: integer('session_duration_seconds'),
	status: sessionStatusEnum('status').notNull().default('active'),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at').notNull().defaultNow(),
	closedAt: timestamp('closed_at'),
});

export const conversationMessage = pgTable('conversation_message', {
	id: uuid('id').primaryKey().defaultRandom(),
	sessionId: uuid('session_id')
		.notNull()
		.references(() => conversationSession.id, { onDelete: 'cascade' }),
	role: text('role').notNull(), // 'system', 'user', 'assistant'
	content: text('content').notNull(),
	tokenCount: integer('token_count').notNull().default(0),
	createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const userUsageDaily = pgTable('user_usage_daily', {
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	usageDate: text('usage_date').notNull(), // Stored as DATE string (YYYY-MM-DD)
	messageCount: integer('message_count').notNull().default(0),
	tokenCount: integer('token_count').notNull().default(0),
	sessionCount: integer('session_count').notNull().default(0),
}, (table) => ({
	pk: { primaryKey: { columns: [table.userId, table.usageDate] } },
}));

export const userUsageMonthly = pgTable('user_usage_monthly', {
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	usageYear: integer('usage_year').notNull(),
	usageMonth: integer('usage_month').notNull(),
	sessionCount: integer('session_count').notNull().default(0),
}, (table) => ({
	pk: { primaryKey: { columns: [table.userId, table.usageYear, table.usageMonth] } },
}));

export const freeSubscriptionStatus = pgTable('free_subscription_status', {
	userId: text('user_id')
		.primaryKey()
		.references(() => user.id, { onDelete: 'cascade' }),
	planType: planTypeEnum('plan_type').notNull(),
	trialEndsAt: timestamp('trial_ends_at'),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export type ConversationSession = typeof conversationSession.$inferSelect;
export type NewConversationSession = typeof conversationSession.$inferInsert;
export type ConversationMessage = typeof conversationMessage.$inferSelect;
export type NewConversationMessage = typeof conversationMessage.$inferInsert;
export type UserUsageDaily = typeof userUsageDaily.$inferSelect;
export type NewUserUsageDaily = typeof userUsageDaily.$inferInsert;
export type UserUsageMonthly = typeof userUsageMonthly.$inferSelect;
export type NewUserUsageMonthly = typeof userUsageMonthly.$inferInsert;
export type FreeSubscriptionStatus = typeof freeSubscriptionStatus.$inferSelect;
export type NewFreeSubscriptionStatus = typeof freeSubscriptionStatus.$inferInsert;
