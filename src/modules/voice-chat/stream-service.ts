import {
  BedrockRuntimeClient,
  InvokeModelWithBidirectionalStreamCommand,
  type InvokeModelWithBidirectionalStreamInput,
} from '@aws-sdk/client-bedrock-runtime';
import { NodeHttp2Handler } from '@smithy/node-http-handler';
import { env } from '@common/config/env';
import { appLogger } from '@common/logger';
import { recordExternalCall } from '@common/otel/metrics';
import { getCurrentSpan } from '@elysiajs/opentelemetry';

function toError(err: unknown): Error {
  if (err instanceof Error) return err;

  if (err && typeof err === 'object') {
    const anyErr = err as { message?: unknown; name?: unknown };
    let message: string;
    if (typeof anyErr.message === 'string' && anyErr.message.length > 0) {
      message = anyErr.message;
    } else {
      try {
        message = JSON.stringify(err);
      } catch {
        message = String(err);
      }
    }
    const error = new Error(message);
    if (typeof anyErr.name === 'string' && anyErr.name.length > 0) {
      error.name = anyErr.name;
    }
    return error;
  }

  if (typeof err === 'string') return new Error(err);
  return new Error(String(err));
}

/**
 * Voice Chat Stream Service
 * Bridges WebSocket client with AWS Bedrock Nova Sonic bidirectional stream.
 *
 * Modeled after the official AWS Bedrock example:
 *   - Uses NodeHttp2Handler for proper HTTP/2 bidirectional streaming
 *   - 24 kHz output audio for high quality
 *   - Structured event dispatch (contentStart, textOutput, audioOutput, etc.)
 *   - Tool configuration support (extensible)
 *   - Proper session lifecycle with close-sequence delays
 */

/* ------------------------------------------------------------------ */
/*  Bedrock Client (fresh-per-session with cached fallback)            */
/* ------------------------------------------------------------------ */

let cachedBedrockClient: BedrockRuntimeClient | null = null;

/**
 * Reset the cached Bedrock client. Called when a transient HTTP/2 error
 * is detected so the next call gets a fresh connection.
 */
function resetBedrockClient(): void {
  if (cachedBedrockClient) {
    cachedBedrockClient.destroy();
    cachedBedrockClient = null;
    appLogger.info('Bedrock client reset due to connection error');
  }
}

/**
 * Create a fresh BedrockRuntimeClient with an HTTP/2 handler.
 * Each voice session gets its own client to avoid stale HTTP/2 sessions.
 */
function createBedrockClient(): BedrockRuntimeClient {
  const accessKeyId = env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      'AWS credentials not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.',
    );
  }

  // Use HTTP/2 handler for reliable bidirectional streaming (matching AWS example)
  const nodeHttp2Handler = new NodeHttp2Handler({
    requestTimeout: 300_000,
    sessionTimeout: 300_000,
    disableConcurrentStreams: false,
    maxConcurrentStreams: 20,
  });

  return new BedrockRuntimeClient({
    region: env.AWS_REGION,
    credentials: { accessKeyId, secretAccessKey },
    requestHandler: nodeHttp2Handler,
  });
}

/** Detect transient HTTP/2 connection errors that are safe to retry */
function isTransientHttp2Error(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('HTTP/2 stream is abnormally aborted') ||
    msg.includes('GOAWAY') ||
    msg.includes('ERR_HTTP2_STREAM_ERROR') ||
    msg.includes('ECONNRESET') ||
    msg.includes('socket hang up')
  );
}

/* ------------------------------------------------------------------ */
/*  Constants & Configuration                                          */
/* ------------------------------------------------------------------ */

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

/** Audio input configuration (what the client sends) */
const AUDIO_INPUT_CONFIG = {
  audioType: 'SPEECH' as const,
  encoding: 'base64',
  mediaType: 'audio/lpcm' as const,
  sampleRateHertz: 16000,
  sampleSizeBits: 16,
  channelCount: 1,
};

/** Audio output configuration (what Bedrock returns) — 24 kHz for high quality */
const AUDIO_OUTPUT_CONFIG = {
  ...AUDIO_INPUT_CONFIG,
  sampleRateHertz: 24000,
  voiceId: 'tiffany',
};

const TEXT_CONFIG = { mediaType: 'text/plain' as const };

/** Default inference configuration */
const INFERENCE_CONFIG = {
  maxTokens: 1024,
  topP: 0.9,
  temperature: 0.7,
};

/** Empty tool schema for extensibility — add real tools here later */
const DEFAULT_TOOL_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {},
  required: [],
});

export function buildVoiceSystemPrompt(languageCode: string): string {
  const languageName = SUPPORTED_LANGUAGES[languageCode] ?? languageCode;
  return `You are a helpful language learning assistant. The user is practicing ${languageName}.

Rules:
- Always respond in ${languageName} only. Do not switch to another language unless the user explicitly asks.
- Have natural conversations about any topic the user brings up; use the conversation to help them practice ${languageName}.
- When the user makes grammar, spelling, or word-choice mistakes, gently correct them: you can give the correct form and a brief explanation, then continue the conversation.
- Be encouraging and supportive. Help with vocabulary and phrasing when useful.
- Keep responses short, generally two or three sentences for chatty scenarios.
- Keep responses clear and at a level appropriate for a learner.`;
}

/* ------------------------------------------------------------------ */
/*  Event helpers                                                      */
/* ------------------------------------------------------------------ */

function toBytes(obj: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj));
}

/** Typed output events dispatched to WebSocket clients */
export type VoiceStreamEvent =
  | { type: 'contentStart'; data: Record<string, unknown> }
  | { type: 'textOutput'; data: Record<string, unknown> }
  | { type: 'audioOutput'; data: Record<string, unknown> }
  | { type: 'toolUse'; data: Record<string, unknown> }
  | { type: 'toolEnd'; data: Record<string, unknown> }
  | { type: 'contentEnd'; data: Record<string, unknown> }
  | { type: 'streamComplete'; data: { timestamp: string } }
  | { type: 'error'; data: { message: string; details?: string } }
  | { type: 'unknown'; data: Record<string, unknown> };

/* ------------------------------------------------------------------ */
/*  Input event flow (Nova Sonic v1 protocol)                          */
/* ------------------------------------------------------------------ */

/**
 * Generator that yields the initialization events in correct order:
 *   sessionStart → promptStart → systemPrompt (contentStart+textInput+contentEnd) → audioContentStart
 */
function* createInitEvents(systemPrompt: string, promptName: string, audioContentName: string) {
  // 1. sessionStart
  yield toBytes({
    event: {
      sessionStart: {
        inferenceConfiguration: INFERENCE_CONFIG,
      },
    },
  });

  // 2. promptStart — includes output configs and tool configuration
  yield toBytes({
    event: {
      promptStart: {
        promptName,
        textOutputConfiguration: TEXT_CONFIG,
        audioOutputConfiguration: AUDIO_OUTPUT_CONFIG,
        toolUseOutputConfiguration: {
          mediaType: 'application/json',
        },
        toolConfiguration: {
          tools: [
            {
              toolSpec: {
                name: 'getDateAndTimeTool',
                description: 'Get information about the current date and time.',
                inputSchema: {
                  json: DEFAULT_TOOL_SCHEMA,
                },
              },
            },
          ],
        },
      },
    },
  });

  // 3. System prompt: contentStart → textInput → contentEnd
  const systemContentName = `${audioContentName}-system`;
  yield toBytes({
    event: {
      contentStart: {
        promptName,
        contentName: systemContentName,
        type: 'TEXT',
        interactive: false,
        role: 'SYSTEM',
        textInputConfiguration: TEXT_CONFIG,
      },
    },
  });

  yield toBytes({
    event: {
      textInput: {
        promptName,
        contentName: systemContentName,
        content: systemPrompt,
      },
    },
  });

  yield toBytes({
    event: {
      contentEnd: {
        promptName,
        contentName: systemContentName,
      },
    },
  });

  // 4. Audio content start (USER, interactive=true for real-time)
  yield toBytes({
    event: {
      contentStart: {
        promptName,
        contentName: audioContentName,
        type: 'AUDIO',
        interactive: true,
        role: 'USER',
        audioInputConfiguration: AUDIO_INPUT_CONFIG,
      },
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Audio Queue                                                        */
/* ------------------------------------------------------------------ */

export interface AudioQueue {
  chunks: string[];
  closed: boolean;
  resolve: (() => void) | null;
  push: (base64Audio: string) => void;
  close: () => void;
}

const MAX_QUEUE_SIZE = 200;

export function createAudioQueue(): AudioQueue {
  const state = {
    chunks: [] as string[],
    closed: false,
    resolve: null as (() => void) | null,
  };

  return {
    get chunks() { return state.chunks; },
    get closed() { return state.closed; },
    get resolve() { return state.resolve; },
    set resolve(v) { state.resolve = v; },
    push(base64Audio: string) {
      if (state.closed) return;
      // Drop oldest chunk if queue is full to prevent memory issues
      if (state.chunks.length >= MAX_QUEUE_SIZE) {
        state.chunks.shift();
        appLogger.warn('Audio queue full, dropping oldest chunk');
      }
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

/* ------------------------------------------------------------------ */
/*  Input stream (async iterable for Bedrock command)                  */
/* ------------------------------------------------------------------ */

/** Create async iterable: init events → audio from queue → close events */
function createInputStream(
  systemPrompt: string,
  audioQueue: AudioQueue,
): AsyncIterable<InvokeModelWithBidirectionalStreamInput> {
  const promptName = crypto.randomUUID();
  const audioContentName = `audio-${crypto.randomUUID()}`;
  const initEvents = [...createInitEvents(systemPrompt, promptName, audioContentName)];

  return {
    async *[Symbol.asyncIterator]() {
      // Yield all initialization events
      for (const bytes of initEvents) {
        yield { chunk: { bytes } };
      }

      // Stream audio chunks from queue
      while (true) {
        if (audioQueue.chunks.length > 0) {
          const base64Content = audioQueue.chunks.shift()!;
          yield {
            chunk: {
              bytes: toBytes({
                event: {
                  audioInput: {
                    promptName,
                    contentName: audioContentName,
                    content: base64Content,
                  },
                },
              }),
            },
          };
        } else if (audioQueue.closed) {
          break;
        } else {
          // Wait for new audio data
          await new Promise<void>((resolve) => {
            audioQueue.resolve = resolve;
          });
        }
      }

      // Close sequence with delays (matching AWS example pattern):
      // contentEnd → promptEnd → sessionEnd
      yield {
        chunk: {
          bytes: toBytes({
            event: { contentEnd: { promptName, contentName: audioContentName } },
          }),
        },
      };
      await new Promise((resolve) => setTimeout(resolve, 500));

      yield {
        chunk: {
          bytes: toBytes({
            event: { promptEnd: { promptName } },
          }),
        },
      };
      await new Promise((resolve) => setTimeout(resolve, 300));

      yield {
        chunk: {
          bytes: toBytes({ event: { sessionEnd: {} } }),
        },
      };
      await new Promise((resolve) => setTimeout(resolve, 300));
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Tool processing                                                    */
/* ------------------------------------------------------------------ */

async function processToolUse(toolName: string, _toolUseContent: any): Promise<object> {
  const tool = toolName.toLowerCase();

  switch (tool) {
    case 'getdateandtimetool': {
      const date = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
      const pstDate = new Date(date);
      return {
        date: pstDate.toISOString().split('T')[0],
        year: pstDate.getFullYear(),
        month: pstDate.getMonth() + 1,
        day: pstDate.getDate(),
        dayOfWeek: pstDate.toLocaleString('en-US', { weekday: 'long' }).toUpperCase(),
        timezone: 'PST',
        formattedTime: pstDate.toLocaleTimeString('en-US', {
          hour12: true,
          hour: '2-digit',
          minute: '2-digit',
        }),
      };
    }
    default:
      appLogger.warn({ toolName }, `Unsupported tool: ${tool}`);
      throw new Error(`Tool ${tool} not supported`);
  }
}

/* ------------------------------------------------------------------ */
/*  Response stream processing                                         */
/* ------------------------------------------------------------------ */

function parseAndDispatchResponseEvent(
  jsonResponse: Record<string, any>,
  onOutput: (event: VoiceStreamEvent) => void,
  toolState: { toolUseContent: any; toolUseId: string; toolName: string },
  sendToolResult: (toolUseId: string, result: any) => void,
) {
  const event = jsonResponse['event'];
  if (!event) {
    onOutput({ type: 'unknown', data: jsonResponse });
    return;
  }

  if (event.contentStart) {
    onOutput({ type: 'contentStart', data: event.contentStart });
  } else if (event.textOutput) {
    onOutput({ type: 'textOutput', data: event.textOutput });
  } else if (event.audioOutput) {
    onOutput({ type: 'audioOutput', data: event.audioOutput });
  } else if (event.toolUse) {
    onOutput({ type: 'toolUse', data: event.toolUse });
    // Store tool use information for when contentEnd(TOOL) arrives
    toolState.toolUseContent = event.toolUse;
    toolState.toolUseId = event.toolUse.toolUseId;
    toolState.toolName = event.toolUse.toolName;
  } else if (event.contentEnd && event.contentEnd.type === 'TOOL') {
    // Tool use completed — process tool and send result back
    onOutput({
      type: 'toolEnd',
      data: {
        toolUseContent: toolState.toolUseContent,
        toolUseId: toolState.toolUseId,
        toolName: toolState.toolName,
      },
    });

    processToolUse(toolState.toolName, toolState.toolUseContent)
      .then((result) => {
        sendToolResult(toolState.toolUseId, result);
      })
      .catch((err) => {
        appLogger.error({ err, toolName: toolState.toolName }, 'Tool use processing failed');
      });
  } else if (event.contentEnd) {
    onOutput({ type: 'contentEnd', data: event.contentEnd });
  } else {
    // Handle any other event types
    const eventKeys = Object.keys(event);
    if (eventKeys.length > 0) {
      onOutput({ type: 'unknown', data: event });
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Main entry point                                                   */
/* ------------------------------------------------------------------ */

export interface StreamSessionParams {
  userId: string;
  sessionId: string;
  languageCode: string;
  onOutput: (event: VoiceStreamEvent) => void;
  onError: (err: Error) => void;
  onEnd: () => void;
}

const MAX_RETRIES = 2;

export async function runBedrockVoiceStream(params: StreamSessionParams): Promise<AudioQueue> {
  const { userId, sessionId, languageCode, onOutput, onError, onEnd } = params;
  const audioQueue = createAudioQueue();

  const systemPrompt = buildVoiceSystemPrompt(languageCode);

  // In test mode, avoid real Bedrock calls and emit stub events.
  if (env.NODE_ENV === 'test') {
    (async () => {
      try {
        onOutput({
          type: 'contentStart',
          data: {
            event: 'stubbed_voice_start',
            userId,
            sessionId,
            languageCode,
            systemPromptPreview: systemPrompt.slice(0, 40),
          },
        });
      } catch (err) {
        onError(toError(err));
      } finally {
        audioQueue.close();
        onEnd();
      }
    })();
    return audioQueue;
  }

  (async () => {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          appLogger.info(
            { userId, sessionId, attempt },
            `Retrying Bedrock voice stream (attempt ${attempt + 1}/${MAX_RETRIES + 1})`,
          );
          // Brief backoff before retry
          await new Promise((r) => setTimeout(r, 500 * attempt));
        }

        // Create a fresh client for each attempt to avoid stale HTTP/2 sessions
        const client = createBedrockClient();
        const inputStream = createInputStream(systemPrompt, audioQueue);
        const command = new InvokeModelWithBidirectionalStreamCommand({
          modelId: env.BEDROCK_NOVA_SONIC_MODEL_ID,
          body: inputStream,
        });

        // Tool state tracked across response events
        const toolState = {
          toolUseContent: null as any,
          toolUseId: '',
          toolName: '',
        };

        // This helper sends tool results back into the input stream via the audio queue mechanism.
        // In a full implementation you'd inject these into the async iterable; for now we log them.
        const sendToolResult = (toolUseId: string, result: any) => {
          appLogger.info(
            { toolUseId, result },
            'Tool result (logging only — tool result injection not yet wired)',
          );
        };

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
              parseAndDispatchResponseEvent(json, onOutput, toolState, sendToolResult);
            } catch {
              onOutput({ type: 'unknown', data: { raw: text } });
            }
          } else if (event.modelStreamErrorException) {
            onOutput({
              type: 'error',
              data: {
                message: event.modelStreamErrorException.message ?? 'Model stream error',
                details: 'modelStreamErrorException',
              },
            });
            onError(
              toError({
                name: 'ModelStreamError',
                message: event.modelStreamErrorException.message,
              }),
            );
          } else if (event.internalServerException) {
            onOutput({
              type: 'error',
              data: {
                message: event.internalServerException.message ?? 'Internal server error',
                details: 'internalServerException',
              },
            });
            onError(
              toError({
                name: 'InternalServerException',
                message: event.internalServerException.message,
              }),
            );
          } else if (event.throttlingException) {
            onError(
              toError({
                name: 'ThrottlingException',
                message: (event as any).throttlingException.message,
              }),
            );
          } else if (event.validationException) {
            onError(
              toError({
                name: 'ValidationException',
                message: (event as any).validationException.message,
              }),
            );
          }
        }

        // Stream completed successfully — no retry needed
        onOutput({
          type: 'streamComplete',
          data: { timestamp: new Date().toISOString() },
        });
        return;
      } catch (err) {
        lastError = toError(err);

        // Reset cached client on any HTTP/2 error (safety net)
        resetBedrockClient();

        if (isTransientHttp2Error(err) && attempt < MAX_RETRIES) {
          appLogger.warn(
            { err: lastError, userId, sessionId, attempt },
            'Transient HTTP/2 error — will retry',
          );
          continue;
        }

        // Non-retryable error or retries exhausted
        break;
      }
    }

    // All retries failed or non-retryable error
    if (lastError) {
      recordExternalCall('bedrock_voice', 0, false);
      const span = getCurrentSpan();
      if (span) {
        span.recordException(lastError);
        span.setStatus({ code: 2, message: lastError.message });
      }
      appLogger.error({ err: lastError, userId, sessionId }, 'Bedrock voice stream error (retries exhausted)');
      onError(lastError);
    }
  })().finally(() => {
    audioQueue.close();
    onEnd();
  });

  return audioQueue;
}
