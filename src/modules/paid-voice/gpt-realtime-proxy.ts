import WebSocket from 'ws';
import { env } from '@common/config/env';
import { appLogger } from '@common/logger';

const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime?model=gpt-realtime';

const SUPPORTED_LANGUAGES: Record<string, string> = {
	en: 'English',
	es: 'Spanish',
	zh: 'Mandarin Chinese',
	fr: 'French',
	ar: 'Arabic',
	de: 'German',
	ja: 'Japanese',
	pt: 'Portuguese',
	ko: 'Korean',
	hi: 'Hindi',
	ur: 'Urdu',
	bn: 'Bengali',
};

function buildInstructions(languageCode: string): string {
	const languageName = SUPPORTED_LANGUAGES[languageCode] ?? languageCode;
	return `You are a helpful language learning assistant. The user is practicing ${languageName}.

Rules:
- Always respond in ${languageName} only. Do not switch to another language unless the user explicitly asks.
- Have natural conversations about any topic the user brings up; use the conversation to help them practice ${languageName}.
- When the user makes grammar, spelling, or word-choice mistakes, gently correct them: you can give the correct form and a brief explanation, then continue the conversation.
- Be encouraging and supportive. Help with vocabulary and phrasing when useful.
- Keep responses clear and at a level appropriate for a learner.`;
}

export interface GPTRealtimeProxyParams {
	languageCode: string;
	sendToClient: (data: string) => void;
	onClose: () => void;
	onError: (err: Error) => void;
}

/**
 * Opens a WebSocket to OpenAI Realtime API and forwards events.
 * Client sends { audio: "<base64>" }; we send input_audio_buffer.append to OpenAI.
 */
export function createGPTRealtimeProxy(params: GPTRealtimeProxyParams): {
	open: () => void;
	pushAudio: (base64: string) => void;
	close: () => void;
} {
	const { languageCode, sendToClient, onClose, onError } = params;
	const apiKey = env.OPENAI_API_KEY;

	if (!apiKey) {
		onError(new Error('OPENAI_API_KEY not configured'));
		return { open: () => {}, pushAudio: () => {}, close: () => {} };
	}

	let openaiWs: WebSocket | null = null;

	function open() {
		openaiWs = new WebSocket(OPENAI_REALTIME_URL, {
			headers: {
				Authorization: `Bearer ${apiKey}`,
			},
		});

		openaiWs.on('open', () => {
			const instructions = buildInstructions(languageCode);
			const sessionUpdate = {
				type: 'session.update',
				session: {
					modalities: ['text', 'audio'],
					instructions,
					voice: 'alloy',
					input_audio_format: 'pcm16',
					output_audio_format: 'pcm16',
					turn_detection: {
						type: 'server_vad',
						threshold: 0.5,
						prefix_padding_ms: 300,
						silence_duration_ms: 500,
					},
				},
			};
			openaiWs!.send(JSON.stringify(sessionUpdate));
		});

		openaiWs.on('message', (data: Buffer | string) => {
			const str = typeof data === 'string' ? data : data.toString('utf8');
			try {
				sendToClient(str);
			} catch (err) {
				appLogger.error({ err }, 'Paid voice: sendToClient failed');
			}
		});

		openaiWs.on('error', (err) => {
			appLogger.error({ err }, 'Paid voice: OpenAI WebSocket error');
			onError(err instanceof Error ? err : new Error(String(err)));
		});

		openaiWs.on('close', () => {
			openaiWs = null;
			onClose();
		});
	}

	function pushAudio(base64: string) {
		if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) return;
		const event = {
			type: 'input_audio_buffer.append',
			audio: base64,
		};
		openaiWs.send(JSON.stringify(event));
	}

	function close() {
		if (openaiWs) {
			openaiWs.close();
			openaiWs = null;
		}
		onClose();
	}

	return { open, pushAudio, close };
}
