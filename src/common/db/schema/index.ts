/**
 * Database Schema Exports
 *
 * - auth.ts: Better Auth required tables (DO NOT modify)
 * - free-ai-chat.ts: Free AI chat tables
 * - paid-ai-chat.ts: Paid AI chat tables
 * - vocabulary.ts: Vocabulary learning tables
 * - voice-chat.ts: Voice chat tables
 * - paid-voice.ts: Paid voice (OpenAI Realtime) tables
 * - trial.ts: Trial (unauthenticated) chat and voice tables
 * - anonymous-vocabulary.ts: Anonymous (device-id) vocabulary progress, favorites, practice, quiz
 */

export * from './auth';
export * from './anonymous-vocabulary';
export * from './free-ai-chat';
export * from './paid-ai-chat';
export * from './paid-voice';
export * from './vocabulary';
export * from './voice-chat';
export * from './trial';
