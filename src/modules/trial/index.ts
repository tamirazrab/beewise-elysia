import { DEVICE_ID_HEADER } from '@common/utils/device-id';
import { Elysia, t } from 'elysia';
import * as service from './service';
import * as streamService from '@modules/voice-chat/stream-service';

const SUPPORTED_LANGUAGE_CODES = new Set([
	'en', 'es', 'zh', 'fr', 'ar', 'de', 'ja', 'pt', 'ko', 'hi', 'ur', 'bn',
]);

function getClientIP(request: Request): string {
	return (
		request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
		request.headers.get('x-real-ip') ||
		'127.0.0.1'
	);
}

/** Device ID from X-Trial-Device-Id, X-Device-Id (unified with free tier), or body. Same identity can be used for trial and free anonymous. */
function getTrialDeviceId(
	request: Request,
	body: { trial_device_id?: string } | undefined,
): string | null {
	const fromTrialHeader = request.headers.get('x-trial-device-id')?.trim();
	if (fromTrialHeader) return fromTrialHeader;
	const fromDeviceHeader = request.headers.get(DEVICE_ID_HEADER)?.trim();
	if (fromDeviceHeader) return fromDeviceHeader;
	return body?.trial_device_id?.trim() ?? null;
}

/**
 * Trial Module
 * Unauthenticated "taste" APIs for chat (Bedrock) and voice (Nova Sonic).
 * Identity by hashed device ID; per-IP abuse limits apply.
 */
export const trialModule = new Elysia({ prefix: '/api/trial' })
	// POST /api/trial/chat/sessions
	.post(
		'/chat/sessions',
		async ({ body, request, set }) => {
			const deviceId = getTrialDeviceId(request, body);
			if (!deviceId) {
				set.status = 400;
				return { error: 'Bad Request', message: 'X-Trial-Device-Id or X-Device-Id header (or trial_device_id in body) is required.' };
			}

			if (!SUPPORTED_LANGUAGE_CODES.has(body.language_code)) {
				set.status = 400;
				return {
					error: 'Bad Request',
					message: `language_code must be one of: ${[...SUPPORTED_LANGUAGE_CODES].sort().join(', ')}`,
				};
			}

			const ip = getClientIP(request);
			const ipHash = service.hashIp(ip);
			const trialIdHash = service.hashTrialDeviceId(deviceId);

			const abused = await service.checkIpAbuse(ipHash);
			if (abused) {
				set.status = 429;
				return {
					error: 'Too Many Requests',
					message: 'Too many trials from this network. Try again later or sign up.',
				};
			}

			try {
				const { sessionId } = await service.createTrialChatSession(trialIdHash, body.language_code, ipHash);
				return { session_id: sessionId };
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Trial limit reached.';
				if (message.includes('Trial used') || message.includes('Sign up')) {
					set.status = 429;
					return { error: 'Resource Exhausted', message };
				}
				set.status = 500;
				return { error: 'Internal Server Error', message: 'Failed to create session.' };
			}
		},
		{
			body: t.Object({
				language_code: t.String(),
				trial_device_id: t.Optional(t.String()),
			}),
			detail: {
				tags: ['Trial'],
				summary: 'Create trial chat session',
				description: 'Unauthenticated. Send X-Trial-Device-Id header or trial_device_id in body. Returns session_id for sending messages.',
			},
		},
	)

	// POST /api/trial/chat/sessions/:id/messages
	.post(
		'/chat/sessions/:id/messages',
		async ({ params, body, request, set }) => {
			const deviceId = getTrialDeviceId(request, body);
			if (!deviceId) {
				set.status = 400;
				return { error: 'Bad Request', message: 'X-Trial-Device-Id or X-Device-Id header (or trial_device_id in body) is required.' };
			}

			const trialIdHash = service.hashTrialDeviceId(deviceId);

			try {
				const result = await service.sendTrialChatMessage(trialIdHash, params.id, body.content);
				return { role: 'assistant', content: result.content, tokens_used: result.tokensUsed };
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Request failed.';
				if (message.includes('Trial used') || message.includes('Sign up')) {
					set.status = 429;
					return { error: 'Resource Exhausted', message };
				}
				if (message.includes('Session not found')) {
					set.status = 404;
					return { error: 'Not Found', message };
				}
				if (message.includes('too long')) {
					set.status = 400;
					return { error: 'Bad Request', message };
				}
				set.status = 500;
				return { error: 'Internal Server Error', message: 'Failed to send message.' };
			}
		},
		{
			params: t.Object({ id: t.String() }),
			body: t.Object({
				content: t.String(),
				trial_device_id: t.Optional(t.String()),
			}),
			detail: {
				tags: ['Trial'],
				summary: 'Send trial chat message',
				description: 'Send a user message and get assistant reply. Requires trial_device_id.',
			},
		},
	)

	// GET /api/trial/limits
	.get(
		'/limits',
		async ({ query, request, set }) => {
			const deviceId = query.trial_device_id?.trim() ?? request.headers.get('x-trial-device-id')?.trim();
			if (!deviceId) {
				set.status = 400;
				return { error: 'Bad Request', message: 'X-Trial-Device-Id header or trial_device_id query is required.' };
			}

			const trialIdHash = service.hashTrialDeviceId(deviceId);
			const limits = await service.getTrialLimits(trialIdHash);
			return limits;
		},
		{
			query: t.Object({
				trial_device_id: t.Optional(t.String()),
			}),
			detail: {
				tags: ['Trial'],
				summary: 'Get trial limits',
				description: 'Returns remaining chat messages, voice seconds, and exhausted status for this device.',
			},
		},
	)

	// POST /api/trial/voice/session
	.post(
		'/voice/session',
		async ({ body, request, set }) => {
			const deviceId = getTrialDeviceId(request, body);
			if (!deviceId) {
				set.status = 400;
				return { error: 'Bad Request', message: 'X-Trial-Device-Id or X-Device-Id header (or trial_device_id in body) is required.' };
			}

			const languageCode = body.language_code ?? 'en';
			if (!SUPPORTED_LANGUAGE_CODES.has(languageCode)) {
				set.status = 400;
				return { error: 'Bad Request', message: 'Unsupported language_code.' };
			}

			const ip = getClientIP(request);
			const ipHash = service.hashIp(ip);
			const trialIdHash = service.hashTrialDeviceId(deviceId);

			const abused = await service.checkIpAbuse(ipHash);
			if (abused) {
				set.status = 429;
				return {
					error: 'Too Many Requests',
					message: 'Too many trials from this network. Try again later or sign up.',
				};
			}

			try {
				const { sessionId } = await service.createTrialVoiceSession(trialIdHash, languageCode, ipHash);
				const token = await service.createTrialVoiceToken(trialIdHash, sessionId);

				let baseUrl: string;
				try {
					const url = new URL(request.url);
					baseUrl = `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`;
				} catch {
					baseUrl = 'ws://localhost:3000';
				}
				const wsUrl = `${baseUrl}/api/trial/voice/stream?token=${encodeURIComponent(token)}`;

				return { session_id: sessionId, ws_url: wsUrl, token };
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Trial limit reached.';
				if (message.includes('Trial used') || message.includes('Sign up')) {
					set.status = 429;
					return { error: 'Resource Exhausted', message };
				}
				set.status = 500;
				return { error: 'Internal Server Error', message: 'Failed to create voice session.' };
			}
		},
		{
			body: t.Object({
				language_code: t.Optional(t.String({ default: 'en' })),
				trial_device_id: t.Optional(t.String()),
			}),
			detail: {
				tags: ['Trial'],
				summary: 'Create trial voice session',
				description: 'Returns ws_url and token for WebSocket connection. Connect to stream audio.',
			},
		},
	)

	// WebSocket /api/trial/voice/stream
	.ws(
		'/voice/stream',
		{
			query: t.Object({
				token: t.String({ description: 'Short-lived JWT from POST /voice/session' }),
			}),
			open: async (ws) => {
				const token = (ws.data as { query?: { token?: string } })?.query?.token;
				if (!token) {
					ws.close(1008, 'Missing token');
					return;
				}

				const payload = await service.validateTrialVoiceToken(token);
				if (!payload) {
					ws.close(1008, 'Invalid or expired token');
					return;
				}

				const session = await service.getTrialVoiceSessionById(payload.sessionId, payload.trialIdHash);
				if (!session) {
					ws.close(1008, 'Session not found or already ended');
					return;
				}

				const trialIdHash = payload.trialIdHash;
				const sessionId = session.id;
				const languageCode = session.languageCode;
				const startedAt = Date.now();

				let audioQueue: streamService.AudioQueue | null = null;

				audioQueue = await streamService.runBedrockVoiceStream({
					userId: trialIdHash,
					sessionId,
					languageCode,
					onOutput: (event) => {
						try {
							ws.send(JSON.stringify(event));
						} catch {
							// Client may have disconnected
						}
					},
					onError: (err) => {
						try {
							ws.send(JSON.stringify({ error: err.message }));
						} catch {}
					},
					onEnd: () => {},
				});

				(ws.data as Record<string, unknown>).audioQueue = audioQueue;
				(ws.data as Record<string, unknown>).sessionInfo = {
					trialIdHash,
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
						base64 = message;
					}
				}
				if (base64) audioQueue.push(base64);
			},
			close: async (ws) => {
				const sessionInfo = (ws.data as Record<string, unknown>).sessionInfo as
					| { trialIdHash: string; sessionId: string; languageCode: string; startedAt: number }
					| undefined;
				const audioQueue = (ws.data as Record<string, unknown>).audioQueue as
					| streamService.AudioQueue
					| undefined;

				if (audioQueue) audioQueue.close();

				if (sessionInfo) {
					const secondsUsed = Math.round((Date.now() - sessionInfo.startedAt) / 1000);
					await service.recordTrialVoiceSessionEnd(
						sessionInfo.trialIdHash,
						sessionInfo.sessionId,
						secondsUsed,
					);
				}
			},
		},
		{
			detail: {
				tags: ['Trial'],
				summary: 'Trial voice stream WebSocket',
				description: 'Connect with ?token=<jwt>. Token from POST /voice/session. Send JSON { audio: "<base64>" } for PCM (16kHz, 16-bit, mono).',
			},
		},
	);
