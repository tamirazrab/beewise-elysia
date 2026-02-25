import { pgTable, text, timestamp, uuid, integer, decimal } from 'drizzle-orm/pg-core';

/**
 * Trial (unauthenticated) tables - identity keyed by hashed device ID, chat and voice usage
 */

export const trialIdentity = pgTable('trial_identity', {
	id: uuid('id').primaryKey().defaultRandom(),
	trialIdHash: text('trial_id_hash').notNull().unique(),
	firstSeenAt: timestamp('first_seen_at').notNull().defaultNow(),
	firstSeenIpHash: text('first_seen_ip_hash'),
	chatSessionsUsed: integer('chat_sessions_used').notNull().default(0),
	chatMessagesUsed: integer('chat_messages_used').notNull().default(0),
	voiceSessionsUsed: integer('voice_sessions_used').notNull().default(0),
	voiceSecondsUsed: integer('voice_seconds_used').notNull().default(0),
	exhaustedAt: timestamp('exhausted_at'),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const trialConversationSession = pgTable('trial_conversation_session', {
	id: uuid('id').primaryKey().defaultRandom(),
	trialIdHash: text('trial_id_hash').notNull(),
	languageCode: text('language_code').notNull(),
	createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const trialConversationMessage = pgTable('trial_conversation_message', {
	id: uuid('id').primaryKey().defaultRandom(),
	sessionId: uuid('session_id')
		.notNull()
		.references(() => trialConversationSession.id, { onDelete: 'cascade' }),
	role: text('role').notNull(),
	content: text('content').notNull(),
	tokenCount: integer('token_count').notNull().default(0),
	createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const trialVoiceSession = pgTable('trial_voice_session', {
	id: uuid('id').primaryKey().defaultRandom(),
	trialIdHash: text('trial_id_hash').notNull(),
	languageCode: text('language_code').notNull(),
	startedAt: timestamp('started_at').notNull().defaultNow(),
	endedAt: timestamp('ended_at'),
	secondsUsed: integer('seconds_used').notNull().default(0),
	costEstimateUsd: decimal('cost_estimate_usd', { precision: 12, scale: 6 }).notNull().default('0'),
});

export type TrialIdentity = typeof trialIdentity.$inferSelect;
export type NewTrialIdentity = typeof trialIdentity.$inferInsert;
export type TrialConversationSession = typeof trialConversationSession.$inferSelect;
export type NewTrialConversationSession = typeof trialConversationSession.$inferInsert;
export type TrialConversationMessage = typeof trialConversationMessage.$inferSelect;
export type NewTrialConversationMessage = typeof trialConversationMessage.$inferInsert;
export type TrialVoiceSession = typeof trialVoiceSession.$inferSelect;
export type NewTrialVoiceSession = typeof trialVoiceSession.$inferInsert;
