import { env } from '@common/config/env';
import { withOptionalAuth } from '@common/middleware/auth-guard';
import { getClientIP } from '@common/utils/request-ip';
import { Elysia, t } from 'elysia';
import { db } from '@common/db';
import { voiceSession } from '@common/db/schema';
import { } from 'drizzle-orm';
import * as trialService from '@modules/trial/service';
import * as service from './service';
import * as streamService from './stream-service';

const SUPPORTED_LANGUAGE_CODES = new Set([
  'en', 'es', 'zh', 'fr', 'ar', 'de', 'ja', 'pt', 'ko', 'hi', 'ur', 'bn',
]);

/**
 * Voice Chat Module
 * Handles voice chat (logged-in or anonymous via X-Device-Id), limits and bidirectional streaming
 */
export const voiceChatModule = withOptionalAuth(new Elysia({ prefix: '/api/voice' }))
  // GET /api/voice/limits - Get voice limits (JWT or X-Device-Id)
  .get(
    '/limits',
    async ({ user, anonymousIdHash, set }: any) => {
      if (user) {
        const today = new Date().toISOString().split('T')[0];
        const secondsUsed = await service.getDailyVoiceSecondsUsed(user.id, today);
        return {
          daily_minutes_limit: service.VOICE_LIMITS.DAILY_MINUTES_PER_USER,
          daily_minutes_used: Math.round((secondsUsed / 60) * 10) / 10,
          daily_budget_cap_usd: service.VOICE_LIMITS.DAILY_BUDGET_USD,
          max_session_minutes: service.VOICE_LIMITS.MAX_SESSION_MINUTES,
          cost_per_minute_usd: service.VOICE_LIMITS.COST_PER_MINUTE_USD,
        };
      }
      if (anonymousIdHash) {
        const identity = await trialService.getOrCreateTrialIdentity(anonymousIdHash);
        const maxSeconds = env.FREE_ANONYMOUS_VOICE_MAX_SECONDS ?? 600;
        return {
          daily_minutes_limit: maxSeconds / 60,
          daily_minutes_used: Math.round((identity.voiceSecondsUsed / 60) * 10) / 10,
          daily_budget_cap_usd: 0,
          max_session_minutes: maxSeconds / 60,
          cost_per_minute_usd: 0,
        };
      }
      set.status = 401;
      return { error: 'Unauthorized', message: 'Send JWT or X-Device-Id.' };
    },
    {
      freeIdentity: true,
      detail: {
        tags: ['Voice Chat'],
        summary: 'Get voice limits',
        description: 'Get voice chat limits (JWT or X-Device-Id)',
      },
    },
  )

  // POST /api/voice/session - Create session and return WebSocket URL + token (JWT or X-Device-Id)
  .post(
    '/session',
    async ({ body, user, anonymousIdHash, set, request }: any) => {
      const languageCode = body.language_code || 'en';
      if (!SUPPORTED_LANGUAGE_CODES.has(languageCode)) {
        set.status = 400;
        return { error: 'Bad Request', message: 'Unsupported language_code' };
      }

      let baseUrl: string;
      try {
        const url = new URL(request.url);
        baseUrl = (url.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + url.host;
      } catch {
        baseUrl = 'ws://localhost:3000';
      }

      if (user) {
        const active = await service.getActiveVoiceSession(user.id);
        if (active) {
          set.status = 409;
          return { error: 'Conflict', message: 'You already have an active voice session' };
        }
        const maxSessionSeconds = service.VOICE_LIMITS.MAX_SESSION_MINUTES * 60;
        const estimatedCostMax = (maxSessionSeconds / 60) * service.VOICE_LIMITS.COST_PER_MINUTE_USD;
        const budgetCheck = await service.checkDailyBudget(estimatedCostMax);
        if (!budgetCheck.allowed) {
          set.status = 429;
          return { error: 'Resource Exhausted', message: budgetCheck.reason };
        }
        const minutesCheck = await service.checkDailyVoiceMinutes(user.id, maxSessionSeconds);
        if (!minutesCheck.allowed) {
          set.status = 429;
          return { error: 'Resource Exhausted', message: minutesCheck.reason };
        }
        const [session] = await db
          .insert(voiceSession)
          .values({ userId: user.id, languageCode })
          .returning();
        if (!session) {
          set.status = 500;
          return { error: 'Internal Server Error', message: 'Failed to create voice session' };
        }
        const token = await service.createSessionToken(user.id, session.id);
        const wsUrl = `${baseUrl}/api/voice/stream?token=${encodeURIComponent(token)}`;
        return { sessionId: session.id, wsUrl, token };
      }

      if (anonymousIdHash) {
        const ip = getClientIP(request);
        const ipHash = trialService.hashIp(ip);
        const abused = await trialService.checkIpAbuse(ipHash);
        if (abused) {
          set.status = 429;
          return { error: 'Too Many Requests', message: 'Too many identities from this network.' };
        }
        try {
          const { sessionId } = await trialService.createFreeAnonymousVoiceSession(
            anonymousIdHash,
            languageCode,
            ipHash,
          );
          const token = await trialService.createTrialVoiceToken(anonymousIdHash, sessionId);
          const wsUrl = `${baseUrl}/api/trial/voice/stream?token=${encodeURIComponent(token)}`;
          return { sessionId, wsUrl, token };
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to create session';
          if (msg.includes('limit')) {
            set.status = 429;
            return { error: 'Resource Exhausted', message: msg };
          }
          set.status = 500;
          return { error: 'Internal Server Error', message: msg };
        }
      }

      set.status = 401;
      return { error: 'Unauthorized', message: 'Send JWT or X-Device-Id.' };
    },
    {
      freeIdentity: true,
      body: t.Object({
        language_code: t.Optional(
          t.String({
            description: 'Optional ISO 639-1 language code (default: en)',
            default: 'fr',
          }),
        ),
      }),
      detail: {
        tags: ['Voice Chat'],
        summary: 'Start voice session',
        description:
          'Create a voice session (JWT or X-Device-Id). Connect to wsUrl with the token to stream audio.',
        requestBody: {
          content: {
            'application/json': {
              example: { language_code: 'fr' },
            },
          },
        },
      },
    },
  )

  // WebSocket /api/voice/stream - Bidirectional voice streaming (token auth via query)
  .ws(
    '/stream',
    {
      query: t.Object({
        token: t.String({ description: 'Short-lived JWT from POST /session' }),
      }),
      open: async (ws) => {
        const token = (ws.data as { query?: { token?: string } })?.query?.token;
        if (!token) {
          ws.close(1008, 'Missing token');
          return;
        }

        const payload = await service.validateSessionToken(token);
        if (!payload) {
          ws.close(1008, 'Invalid or expired token');
          return;
        }

        const session = await service.getVoiceSessionByIdAndUser(payload.sessionId, payload.sub);
        if (!session) {
          ws.close(1008, 'Session not found or already ended');
          return;
        }

        const userId = payload.sub;
        const sessionId = session.id;
        const languageCode = session.languageCode;
        const startedAt = Date.now();

        let audioQueue: streamService.AudioQueue | null = null;

        audioQueue = await streamService.runBedrockVoiceStream({
          userId,
          sessionId,
          languageCode,
          onOutput: (event) => {
            try {
              ws.send(JSON.stringify(event));
            } catch (err) {
              // Client may have disconnected
            }
          },
          onError: (err) => {
            try {
              ws.send(JSON.stringify({ error: err.message }));
            } catch { }
          },
          onEnd: () => {
            // Stream ended
          },
        });

        // Store audioQueue and session info on ws for message/close handlers
        (ws.data as Record<string, unknown>).audioQueue = audioQueue;
        (ws.data as Record<string, unknown>).sessionInfo = {
          userId,
          sessionId,
          languageCode,
          startedAt,
        };
      },
      message: async (ws, message) => {
        const audioQueue = (ws.data as Record<string, unknown>).audioQueue as
          | streamService.AudioQueue
          | undefined;
        if (!audioQueue) return;

        let base64: string | null = null;
        if (typeof message === 'string') {
          try {
            const parsed = JSON.parse(message) as { audio?: string };
            base64 = parsed.audio ?? null;
          } catch {
            base64 = message; // Assume raw base64
          }
        }
        if (base64) {
          audioQueue.push(base64);
        }
      },
      close: async (ws) => {
        const sessionInfo = (ws.data as Record<string, unknown>).sessionInfo as
          | { userId: string; sessionId: string; languageCode: string; startedAt: number }
          | undefined;
        const audioQueue = (ws.data as Record<string, unknown>).audioQueue as
          | streamService.AudioQueue
          | undefined;

        if (audioQueue) audioQueue.close();

        if (sessionInfo) {
          const secondsUsed = Math.round((Date.now() - sessionInfo.startedAt) / 1000);
          const costEstimateUsd =
            (secondsUsed / 60) * service.VOICE_LIMITS.COST_PER_MINUTE_USD;
          await service.recordVoiceSession(
            sessionInfo.userId,
            sessionInfo.sessionId,
            secondsUsed,
            costEstimateUsd,
            sessionInfo.languageCode,
          );
        }
      },
    },
    {
      detail: {
        tags: ['Voice Chat'],
        summary: 'Voice stream WebSocket',
        description:
          'Connect with ?token=<jwt>. Token from POST /session. Send JSON { audio: "<base64>" } for PCM audio (16kHz, 16-bit, mono).',
      },
    },
  );
