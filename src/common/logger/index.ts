import { env } from '@common/config/env';
import { context, trace } from '@opentelemetry/api';
import pino from 'pino';

const isTest = process.env.NODE_ENV === 'test'; // Bun sets this during `bun test`

function otelMixin(): Record<string, string | undefined> {
  const span = trace.getSpan(context.active());
  if (!span) return {};
  const { traceId, spanId } = span.spanContext();
  return { trace_id: traceId, span_id: spanId };
}

export const appLogger = pino({
  level: isTest ? 'silent' : (env.LOG_LEVEL ?? 'info'),
  mixin: otelMixin,
  transport:
    env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
});
