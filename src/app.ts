import { env } from '@common/config/env';
import { cors } from '@elysiajs/cors';
import { jwt } from '@elysiajs/jwt';
import { swagger } from '@elysiajs/swagger';
import { authModule } from '@modules/auth';
import { healthModule } from '@modules/health';
import {
  freeAIChatModule,
  usageModule,
  limitsModule,
  subscriptionStatusModule,
} from '@modules/free-ai-chat';
import { paidAIChatModule, paidUsageModule } from '@modules/paid-ai-chat';
import { paidVoiceModule } from '@modules/paid-voice';
import { vocabularyModule } from '@modules/vocabulary';
import { speakPracticeModule } from '@modules/speak-practice';
import { voiceChatModule } from '@modules/voice-chat';
import { trialModule } from '@modules/trial';
import { Elysia } from 'elysia';
import { opentelemetry, getCurrentSpan } from '@elysiajs/opentelemetry';
import { appLogger } from './common/logger';
import { authRateLimit, globalRateLimit, trialRateLimit } from './common/middleware/rate-limiter';
import { requestLogger } from './common/middleware/request-logger';
import { opentelemetryPluginOptions } from './instrumentation';
import { recordHttpRequest, recordHttpError } from '@common/otel/metrics';

/**
 * Application composition root.
 *
 * Registers global middleware, OpenAPI/Scalar documentation,
 * error handling, and feature modules.
 * * @see https://elysiajs.com/concepts/plugin.html
 */
export const createApp = () => {
  const app = new Elysia()
    .use(opentelemetry(opentelemetryPluginOptions as Parameters<typeof opentelemetry>[0]))
    .trace(async ({ context, set, onAfterResponse, onError }) => {
      const route = new URL(context.request.url).pathname || '/';
      onAfterResponse(({ onStop }) => {
        onStop(({ elapsed }) => {
          const code = typeof set.status === 'number' ? set.status : 200;
          recordHttpRequest(elapsed, route, code);
        });
      });
      onError(({ onStop }) => {
        onStop(({ error }) => {
          if (error != null) {
            const code = typeof set.status === 'number' ? set.status : 500;
            recordHttpError(route, code);
          }
        });
      });
    })
    .use(requestLogger)
    .use(globalRateLimit)
    .use(
      cors({
        origin: env.CORS_ORIGIN,
        credentials: true,
      }),
    )
    .use(
      jwt({
        name: 'jwt',
        secret: env.JWT_SECRET!,
        exp: '7d',
      }),
    )
    // ---  API Documentation (open at /docs) ---
    .use(
      swagger({
        path: '/docs',
        documentation: {
          info: {
            title: 'Beewise API',
            version: '1.0.0',
            description:
              'Language learning API: vocabulary, progress, practice, quizzes, and AI chat.\n\n' +
              '**Auth (JWT):** Call **POST /api/auth/login** with `{ "email", "password" }` to get **{ "token": "ey..." }**. ' +
              'Send **Authorization: Bearer &lt;token&gt;** on all protected routes. No cookie or session; JWT only (@elysiajs/jwt). Sign-up: POST /api/auth/sign-up/email.\n\n' +
              'Request bodies are prefilled with realistic default JSON.',
          },
          tags: [
            { name: 'Health', description: 'Liveness and readiness checks' },
            { name: 'Auth', description: 'Sign up, sign in, sign out, password reset (Better Auth)' },
            { name: 'Free AI Chat', description: 'Free-tier conversation sessions and messages' },
            { name: 'Paid AI Chat', description: 'Paid-tier AI chat sessions and usage' },
            { name: 'Vocabulary', description: 'Vocabulary items CRUD (admin) and listing' },
            { name: 'Speak Practice', description: 'Sentence practice by language and level' },
            { name: 'Progress', description: 'User vocabulary progress and review items' },
            { name: 'Practice', description: 'Speaking/listening practice sessions and recordings' },
            { name: 'Quiz', description: 'Quizzes, questions, and attempt submission' },
            { name: 'Favorites', description: 'Favorite vocabulary items and quizzes' },
            { name: 'Voice Chat', description: 'Voice session limits and session start (free, Nova Sonic)' },
            { name: 'Paid Voice', description: 'Paid-tier voice via OpenAI Realtime (GPT)' },
            { name: 'Trial', description: 'Unauthenticated trial chat (Bedrock) and voice (Nova Sonic); device ID + per-IP limits' },
          ],
        },
        scalarConfig: {
          theme: 'purple',
          // Persist auth state (e.g. after login) so protected routes work when testing from /docs
          persistAuth: true,
        },
      }),
    )
    .onError(({ code, error, set }) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const span = getCurrentSpan();
      if (span) {
        span.recordException(error instanceof Error ? error : new Error(errorMessage));
        span.setStatus({ code: 2, message: errorMessage });
      }
      appLogger.error({
        code,
        error: errorMessage,
        stack: env.APP_ENV === 'local' && error instanceof Error ? error.stack : undefined,
      });

      if (code === 'NOT_FOUND') {
        set.status = 404;
        return { error: 'Route not found' };
      }

      if (code === 'VALIDATION') {
        set.status = 400;

        let parsedMessage = errorMessage;
        try {
          if (typeof errorMessage === 'string' && errorMessage.startsWith('{')) {
            parsedMessage = JSON.parse(errorMessage);
          }
        } catch { }

        return {
          error: 'Validation error',
          message: parsedMessage,
        };
      }

      set.status = 500;
      return {
        error: 'Internal server error',
        message: env.APP_ENV === 'local' ? errorMessage : undefined,
      };
    })

    // Root endpoint - API info
    .get('/', () => ({
      name: 'Elysia Production API',
      version: '1.0.0',
      docs: '/docs',
      health: '/health',
    }))

    // Feature modules
    .use(healthModule)
    .use(freeAIChatModule)
    .use(usageModule)
    .use(limitsModule)
    .use(subscriptionStatusModule)
    .use(paidAIChatModule)
    .use(paidUsageModule)
    .use(paidVoiceModule)
    .use(vocabularyModule)
    .use(speakPracticeModule)
    .use(voiceChatModule)
    .use(trialRateLimit)
    .use(trialModule);

  if (env.ENABLE_AUTH) {
    app.use(authRateLimit);
    app.use(authModule);
    appLogger.info('[AUTH] Authentication module enabled');
  } else {
    appLogger.info('[AUTH] Authentication disabled (ENABLE_AUTH=false)');
  }

  return app;
};
