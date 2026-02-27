import {
	BedrockRuntimeClient,
	InvokeModelWithBidirectionalStreamCommand,
	type InvokeModelWithBidirectionalStreamInput,
} from '@aws-sdk/client-bedrock-runtime';
import { env } from '@common/config/env';
import { appLogger } from '@common/logger';
import { recordExternalCall } from '@common/otel/metrics';
import { getCurrentSpan } from '@elysiajs/opentelemetry';

/**
 * Voice Chat Stream Service
 * Bridges WebSocket client with AWS Bedrock Nova Sonic bidirectional stream
 * Uses Nova Sonic v1 input event flow: sessionStart -> promptStart -> contentStart -> content -> contentEnd -> ...
 */

let bedrockClient: BedrockRuntimeClient | null = null;

function getBedrockClient(): BedrockRuntimeClient {
	if (bedrockClient) return bedrockClient;

	const accessKeyId = env.AWS_ACCESS_KEY_ID;
	const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;

	if (!accessKeyId || !secretAccessKey) {
		throw new Error(
			'AWS credentials not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.',
		);
	}

	bedrockClient = new BedrockRuntimeClient({
		region: env.AWS_REGION,
		credentials: { accessKeyId, secretAccessKey },
	});

	return bedrockClient;
}

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

export function buildVoiceSystemPrompt(languageCode: string): string {
	const languageName = SUPPORTED_LANGUAGES[languageCode] ?? languageCode;
	return `You are a helpful language learning assistant. The user is practicing ${languageName}.

Rules:
- Always respond in ${languageName} only. Do not switch to another language unless the user explicitly asks.
- Have natural conversations about any topic the user brings up; use the conversation to help them practice ${languageName}.
- When the user makes grammar, spelling, or word-choice mistakes, gently correct them: you can give the correct form and a brief explanation, then continue the conversation.
- Be encouraging and supportive. Help with vocabulary and phrasing when useful.
- Keep responses clear and at a level appropriate for a learner.`;
}

function toBytes(obj: Record<string, unknown>): Uint8Array {
	return new TextEncoder().encode(JSON.stringify(obj));
}

/** Nova Sonic v1 input event flow */
function* createInitEvents(systemPrompt: string, promptName: string, contentName: string) {
	// 1. sessionStart
	yield toBytes({
		event: {
			sessionStart: {
				inferenceConfiguration: {
					maxTokens: 1024,
					topP: 0.9,
					temperature: 0.7,
				},
			},
		},
	});

	// 2. promptStart
	yield toBytes({
		event: {
			promptStart: {
				promptName,
				textOutputConfiguration: { mediaType: 'text/plain' },
				audioOutputConfiguration: {
					mediaType: 'audio/lpcm',
					sampleRateHertz: 16000,
					sampleSizeBits: 16,
					channelCount: 1,
					voiceId: 'amy',
					encoding: 'base64',
					audioType: 'SPEECH',
				},
			},
		},
	});

	// 3. contentStart for system prompt (TEXT, SYSTEM)
	yield toBytes({
		event: {
			contentStart: {
				promptName,
				contentName: `${contentName}-system`,
				type: 'TEXT',
				interactive: false,
				role: 'SYSTEM',
				textInputConfiguration: { mediaType: 'text/plain' },
			},
		},
	});

	// 4. textInput with system prompt
	yield toBytes({
		event: {
			textInput: {
				promptName,
				contentName: `${contentName}-system`,
				content: systemPrompt,
			},
		},
	});

	// 5. contentEnd for system prompt
	yield toBytes({
		event: {
			contentEnd: {
				promptName,
				contentName: `${contentName}-system`,
			},
		},
	});

	// 6. contentStart for audio (USER)
	yield toBytes({
		event: {
			contentStart: {
				promptName,
				contentName,
				type: 'AUDIO',
				interactive: true,
				role: 'USER',
				audioInputConfiguration: {
					mediaType: 'audio/lpcm',
					sampleRateHertz: 16000,
					sampleSizeBits: 16,
					channelCount: 1,
					audioType: 'SPEECH',
					encoding: 'base64',
				},
			},
		},
	});
}

/** Create async iterable: init events, then audio from queue, then close events */
function createInputStream(
	systemPrompt: string,
	audioQueue: { chunks: string[]; closed: boolean; resolve: (() => void) | null },
): AsyncIterable<InvokeModelWithBidirectionalStreamInput> {
	const promptName = crypto.randomUUID();
	const contentName = `audio-${crypto.randomUUID()}`;
	const initEvents = [...createInitEvents(systemPrompt, promptName, contentName)];

	return {
		async *[Symbol.asyncIterator]() {
			for (const bytes of initEvents) {
				yield { chunk: { bytes } };
			}

			while (true) {
				if (audioQueue.chunks.length > 0) {
					const base64Content = audioQueue.chunks.shift()!;
					yield {
						chunk: {
							bytes: toBytes({
								event: {
									audioInput: {
										promptName,
										contentName,
										content: base64Content,
									},
								},
							}),
						},
					};
				} else if (audioQueue.closed) {
					break;
				} else {
					await new Promise<void>((resolve) => {
						audioQueue.resolve = resolve;
					});
				}
			}

			// Close sequence: contentEnd -> promptEnd -> sessionEnd
			yield {
				chunk: {
					bytes: toBytes({
						event: { contentEnd: { promptName, contentName } },
					}),
				},
			};
			yield {
				chunk: {
					bytes: toBytes({
						event: { promptEnd: { promptName } },
					}),
				},
			};
			yield {
				chunk: {
					bytes: toBytes({ event: { sessionEnd: {} } }),
				},
			};
		},
	};
}

export interface StreamSessionParams {
	userId: string;
	sessionId: string;
	languageCode: string;
	onOutput: (event: Record<string, unknown>) => void;
	onError: (err: Error) => void;
	onEnd: () => void;
}

export interface AudioQueue {
	chunks: string[];
	closed: boolean;
	resolve: (() => void) | null;
	push: (base64Audio: string) => void;
	close: () => void;
}

export function createAudioQueue(): AudioQueue {
	const state = {
		chunks: [] as string[],
		closed: false,
		resolve: null as (() => void) | null,
	};

	return {
		...state,
		push(base64Audio: string) {
			if (state.closed) return;
			state.chunks.push(base64Audio);
			if (state.resolve) {
				const r = state.resolve;
				state.resolve = null;
				r();
			}
		},
		close() {
			state.closed = true;
			if (state.resolve) {
				state.resolve();
			}
		},
	};
}

export async function runBedrockVoiceStream(params: StreamSessionParams): Promise<AudioQueue> {
	const { userId, sessionId, languageCode, onOutput, onError, onEnd } = params;
	const audioQueue = createAudioQueue();

	const systemPrompt = buildVoiceSystemPrompt(languageCode);

	// In test mode, avoid real Bedrock calls and emit stub events.
	if (env.NODE_ENV === 'test') {
		(async () => {
			try {
				onOutput({
					event: 'stubbed_voice_start',
					userId,
					sessionId,
					languageCode,
					systemPromptPreview: systemPrompt.slice(0, 40),
				});
			} catch (err) {
				onError(err instanceof Error ? err : new Error(String(err)));
			} finally {
				audioQueue.close();
				onEnd();
			}
		})();
		return audioQueue;
	}

	const inputStream = createInputStream(systemPrompt, audioQueue);

	const client = getBedrockClient();
	const command = new InvokeModelWithBidirectionalStreamCommand({
		modelId: env.BEDROCK_NOVA_SONIC_MODEL_ID,
		body: inputStream,
	});

	(async () => {
		try {
			const response = await client.send(command);
			if (!response.body) {
				onError(new Error('No response body from Bedrock'));
				return;
			}

			for await (const event of response.body) {
				if (event.chunk?.bytes) {
					const text = new TextDecoder().decode(event.chunk.bytes);
					try {
						const json = JSON.parse(text) as Record<string, unknown>;
						onOutput(json);
					} catch {
						onOutput({ raw: text });
					}
				} else if (event.modelStreamErrorException) {
					onError(new Error(String(event.modelStreamErrorException.message)));
				} else if (event.internalServerException) {
					onError(new Error(String(event.internalServerException.message)));
				} else if (event.throttlingException) {
					onError(new Error(String(event.throttlingException.message)));
				} else if (event.validationException) {
					onError(new Error(String(event.validationException.message)));
				}
			}
		} catch (err) {
			recordExternalCall('bedrock_voice', 0, false);
			const span = getCurrentSpan();
			if (span) {
				span.recordException(err instanceof Error ? err : new Error(String(err)));
				span.setStatus({ code: 2, message: String(err) });
			}
			appLogger.error({ err, userId, sessionId }, 'Bedrock voice stream error');
			onError(err instanceof Error ? err : new Error(String(err)));
		} finally {
			audioQueue.close();
			onEnd();
		}
	})();

	return audioQueue;
}
