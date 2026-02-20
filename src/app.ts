import { env } from '@common/config/env';
import { cors } from '@elysiajs/cors';
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
import { vocabularyModule } from '@modules/vocabulary';
import { voiceChatModule } from '@modules/voice-chat';
import { Elysia } from 'elysia';
import { appLogger } from './common/logger';
import { authRateLimit, globalRateLimit } from './common/middleware/rate-limiter';
import { requestLogger } from './common/middleware/request-logger';

/**
 * Application composition root.
 *
 * Registers global middleware, OpenAPI/Scalar documentation,
 * error handling, and feature modules.
 * * @see https://elysiajs.com/concepts/plugin.html
 */
export const createApp = () => {
	const app = new Elysia()
		.use(requestLogger)
		.use(globalRateLimit)
		.use(
			cors({
				origin: env.CORS_ORIGIN,
				credentials: true,
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
							'**Getting started:** Use `POST /api/auth/sign-in/email` to sign in (or sign up with `POST /api/auth/sign-up/email`). ' +
							'Protected routes require the session cookie. Request bodies in the Scalar client are prefilled with realistic examples for quick testing.\n\n' +
							'Auth: [Better Auth](https://better-auth.com)',
					},
					tags: [
						{ name: 'Health', description: 'Liveness and readiness checks' },
						{ name: 'Auth', description: 'Sign up, sign in, sign out, password reset (Better Auth)' },
						{ name: 'Free AI Chat', description: 'Free-tier conversation sessions and messages' },
						{ name: 'Paid AI Chat', description: 'Paid-tier AI chat sessions and usage' },
						{ name: 'Vocabulary', description: 'Vocabulary items CRUD (admin) and listing' },
						{ name: 'Progress', description: 'User vocabulary progress and review items' },
						{ name: 'Practice', description: 'Speaking/listening practice sessions and recordings' },
						{ name: 'Quiz', description: 'Quizzes, questions, and attempt submission' },
						{ name: 'Favorites', description: 'Favorite vocabulary items and quizzes' },
						{ name: 'Voice Chat', description: 'Voice session limits and session start' },
					],
				},
				scalarConfig: {
					theme: 'purple',
				},
			}),
		)
		.onError(({ code, error, set }) => {
			const errorMessage = error instanceof Error ? error.message : String(error);

			appLogger.error({
				code,
				error: errorMessage,
				stack: env.NODE_ENV === 'development' && error instanceof Error ? error.stack : undefined,
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
				} catch {}

				return {
					error: 'Validation error',
					message: parsedMessage,
				};
			}

			set.status = 500;
			return {
				error: 'Internal server error',
				message: env.NODE_ENV === 'development' ? errorMessage : undefined,
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
		.use(vocabularyModule)
		.use(voiceChatModule);

	if (env.ENABLE_AUTH) {
		app.use(authRateLimit);
		app.use(authModule);
		appLogger.info('[AUTH] Authentication module enabled');
	} else {
		appLogger.info('[AUTH] Authentication disabled (ENABLE_AUTH=false)');
	}

	return app;
};
