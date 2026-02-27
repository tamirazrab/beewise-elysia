import { appLogger } from '@common/logger';
import { getCurrentSpan } from '@elysiajs/opentelemetry';
import { Elysia } from 'elysia';

export const requestLogger = () =>
	new Elysia()
		.onRequest(({ store }) => {
			(store as { startTime?: number }).startTime = Date.now();
		})
		.onAfterResponse(({ request, set, store }) => {
			const url = new URL(request.url);
			const startTime = (store as { startTime?: number }).startTime;
			const durationMs = startTime != null ? Date.now() - startTime : 0;
			const statusCode = typeof set.status === 'number' ? set.status : 200;
			const span = getCurrentSpan();
			const traceId = span?.spanContext().traceId;
			const spanId = span?.spanContext().spanId;

			appLogger.info({
				method: request.method,
				path: url.pathname,
				status_code: statusCode,
				duration_ms: durationMs,
				...(traceId && { trace_id: traceId }),
				...(spanId && { span_id: spanId }),
			});
		});
