import { withAuth } from '@common/middleware/auth-guard';
import { Elysia, t } from 'elysia';
import { db } from '@common/db';
import { paidVoiceSession } from '@common/db/schema';
import * as service from './service';
import { createGPTRealtimeProxy } from './gpt-realtime-proxy';

const SUPPORTED_LANGUAGE_CODES = new Set([
	'en', 'es', 'zh', 'fr', 'ar', 'de', 'ja', 'pt', 'ko', 'hi', 'ur', 'bn',
]);

/**
 * Paid Voice Module (OpenAI Realtime / GPT voice)
 * For paid users: real-time voice via OpenAI Realtime API
 */
export const paidVoiceModule = withAuth(new Elysia({ prefix: '/api/paid-voice' }))
	// POST /api/paid-voice/session - Create session and return WebSocket URL + token
	.post(
		'/session',
		async ({ body, user, set, request }: any) => {
			if (!user) {
				set.status = 401;
				return { error: 'Unauthorized', message: 'Please login first' };
			}

			const languageCode = body.language_code || 'en';
			if (!SUPPORTED_LANGUAGE_CODES.has(languageCode)) {
				set.status = 400;
				return { error: 'Bad Request', message: 'Unsupported language_code' };
			}

			const [session] = await db
				.insert(paidVoiceSession)
				.values({
					userId: user.id,
					languageCode,
				})
				.returning();

			if (!session) {
				set.status = 500;
				return { error: 'Internal Server Error', message: 'Failed to create paid voice session' };
			}

			const token = await service.createPaidVoiceSessionToken(user.id, session.id);

			let baseUrl: string;
			try {
				const url = new URL(request.url);
				baseUrl = (url.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + url.host;
			} catch {
				baseUrl = 'ws://localhost:3000';
			}
			const wsUrl = `${baseUrl}/api/paid-voice/stream?token=${encodeURIComponent(token)}`;

			return {
				sessionId: session.id,
				wsUrl,
				token,
				expected_audio_format: { rate: 24000, sampleSizeBits: 16, channelCount: 1 },
			};
		},
		{
			auth: true,
			body: t.Object({
				language_code: t.Optional(
					t.String({
						description: 'Optional ISO 639-1 language code (default: en)',
						default: 'en',
					}),
				),
			}),
			detail: {
				tags: ['Paid Voice'],
				summary: 'Start paid voice session',
				description:
					'Authenticated (paid). Create a GPT Realtime voice session. Connect to wsUrl and send { audio: "<base64>" } (24kHz PCM).',
				requestBody: {
					content: {
						'application/json': {
							example: { language_code: 'en' },
						},
					},
				},
			},
		},
	)

	// WebSocket /api/paid-voice/stream - GPT Realtime proxy (token auth via query)
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

				const payload = await service.validatePaidVoiceSessionToken(token);
				if (!payload) {
					ws.close(1008, 'Invalid or expired token');
					return;
				}

				const session = await service.getPaidVoiceSessionByIdAndUser(payload.sessionId, payload.sub);
				if (!session) {
					ws.close(1008, 'Session not found or already ended');
					return;
				}

				const userId = payload.sub;
				const sessionId = session.id;
				const languageCode = session.languageCode;
				const startedAt = Date.now();

				const proxy = createGPTRealtimeProxy({
					languageCode,
					sendToClient: (data: string) => {
						try {
							ws.send(data);
						} catch {}
					},
					onClose: () => {},
					onError: (err) => {
						try {
							ws.send(JSON.stringify({ error: err.message }));
						} catch {}
					},
				});

				proxy.open();

				(ws.data as Record<string, unknown>).proxy = proxy;
				(ws.data as Record<string, unknown>).sessionInfo = {
					userId,
					sessionId,
					languageCode,
					startedAt,
				};
			},
			message: async (ws, message) => {
				const proxy = (ws.data as Record<string, unknown>).proxy as
					| { pushAudio: (base64: string) => void }
					| undefined;
				if (!proxy) return;

				let base64: string | null = null;
				if (typeof message === 'string') {
					try {
						const parsed = JSON.parse(message) as { audio?: string };
						base64 = parsed.audio ?? null;
					} catch {
						base64 = message;
					}
				}
				if (base64) {
					proxy.pushAudio(base64);
				}
			},
			close: async (ws) => {
				const sessionInfo = (ws.data as Record<string, unknown>).sessionInfo as
					| { userId: string; sessionId: string; languageCode: string; startedAt: number }
					| undefined;
				const proxy = (ws.data as Record<string, unknown>).proxy as
					| { close: () => void }
					| undefined;

				if (proxy) proxy.close();

				if (sessionInfo) {
					const secondsUsed = Math.round((Date.now() - sessionInfo.startedAt) / 1000);
					const costEstimateUsd =
						(secondsUsed / 60) * service.PAID_VOICE_COST_PER_MINUTE_USD;
					await service.recordPaidVoiceSession(
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
				tags: ['Paid Voice'],
				summary: 'Paid voice stream WebSocket',
				description:
					'Connect with ?token=<jwt>. Token from POST /api/paid-voice/session. Send JSON { audio: "<base64>" } for PCM (24kHz). Receives OpenAI Realtime events (e.g. response.output_audio.delta).',
			},
		},
	);
