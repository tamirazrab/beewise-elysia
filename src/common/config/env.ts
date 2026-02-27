import { type Static, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
/**
 * Environment configuration and validation.
 *
 * Validates all required environment variables at startup
 * to fail fast on misconfiguration.
 */

const EnvSchema = Type.Object({
	// Application
	NODE_ENV: Type.Union(
		[Type.Literal('development'), Type.Literal('production'), Type.Literal('test')],
		{
			default: 'development',
		},
	),
	/** Deployment environment: local (dev), staging (e.g. Coolify), production. Drives DB, auth, logging, CORS. */
	APP_ENV: Type.Union(
		[
			Type.Literal('local'),
			Type.Literal('staging'),
			Type.Literal('production'),
		],
		{ default: 'local' },
	),
	PORT: Type.Number({
		default: 3000,
	}),
	HOST: Type.String({
		default: '0.0.0.0',
	}),

	// Database
	DATABASE_URL: Type.String({
		description: 'PostgreSQL connection string',
		pattern: '^(postgres|postgresql)://.+',
		default: 'postgresql://localhost:5432/beewise',
	}),

  DB_SSL_CERT: Type.Optional(
    Type.String({
      description: 'SSL certificate content',
      default: '',
    }),
  ),

	// Authentication
	ENABLE_AUTH: Type.Boolean({
		default: true,
		description: 'Enable/disable Better Auth module',
	}),
	REQUIRE_EMAIL_VERIFICATION: Type.Boolean({
		default: false,
		description: 'Require email verification before login',
	}),

	// Better Auth (required if ENABLE_AUTH=true)
	BETTER_AUTH_SECRET: Type.Optional(
		Type.String({
			minLength: 32,
			description: 'Secret key for Better Auth (min 32 characters)',
			default: 'development-secret-min-32-characters-long',
		}),
	),
	BETTER_AUTH_URL: Type.Optional(
		Type.String({
			default: 'http://localhost:3000',
			description: 'Base URL for authentication callbacks',
			pattern: '^https?://.+',
		}),
	),
	JWT_SECRET: Type.Optional(
		Type.String({
			minLength: 1,
			description: 'Secret for @elysiajs/jwt (defaults to BETTER_AUTH_SECRET)',
			default: '',
		}),
	),

	// Logging
	LOG_LEVEL: Type.Union(
		[
			Type.Literal('fatal'),
			Type.Literal('error'),
			Type.Literal('warn'),
			Type.Literal('info'),
			Type.Literal('debug'),
			Type.Literal('trace'),
		],
		{
			default: 'info',
		},
	),

	// CORS
	CORS_ORIGIN: Type.Array(Type.String(), {
		description: 'Allowed CORS origins (comma-separated)',
		default: ['http://localhost:3000'],
	}),

	// Email (Optional - for email verification and password reset)
	RESEND_API_KEY: Type.Optional(
		Type.String({
			description: 'Resend API key for sending emails (optional - logs to console if not set)',
			default: '',
		}),
	),
	EMAIL_FROM: Type.String({
		description: 'Email sender address',
		default: 'noreply@example.com',
	}),

	// Rate Limiting
	ENABLE_RATE_LIMITER: Type.Boolean({
		default: true,
		description: 'Enable/disable rate limiting',
	}),
	RATE_LIMIT_WINDOW_MS: Type.Optional(
		Type.Number({
			description: 'Global rate limit window in milliseconds',
			default: 60000,
		}),
	),
	RATE_LIMIT_MAX: Type.Optional(
		Type.Number({
			description: 'Max requests per window',
			default: 100,
		}),
	),
	AUTH_RATE_LIMIT_WINDOW_MS: Type.Optional(
		Type.Number({
			description: 'Auth rate limit window in milliseconds',
			default: 60000,
		}),
	),
	AUTH_RATE_LIMIT_MAX: Type.Optional(
		Type.Number({
			description: 'Max auth requests per window',
			default: 10,
		}),
	),

	// AWS (for Bedrock and S3)
	AWS_ACCESS_KEY_ID: Type.Optional(
		Type.String({
			description: 'AWS access key ID for Bedrock and S3',
			default: '',
		}),
	),
	AWS_SECRET_ACCESS_KEY: Type.Optional(
		Type.String({
			description: 'AWS secret access key for Bedrock and S3',
			default: '',
		}),
	),
	AWS_REGION: Type.String({
		description: 'AWS region',
		default: 'us-east-1',
	}),
	S3_BUCKET_NAME: Type.String({
		description: 'S3 bucket name for practice recordings',
		default: 'beewise-practice-recordings',
	}),
	BEDROCK_MODEL_ID: Type.String({
		description: 'AWS Bedrock model ID',
		default: 'openai.gpt-oss-120b-1:0',
	}),
	BEDROCK_COST_PER_1K_TOKENS: Type.String({
		description: 'Bedrock cost per 1K tokens',
		default: '0.0001',
	}),
	BEDROCK_NOVA_SONIC_MODEL_ID: Type.String({
		description: 'Bedrock Nova Sonic model ID for voice chat',
		default: 'amazon.nova-sonic-v1:0',
	}),
	VOICE_WS_TOKEN_EXPIRY_SEC: Type.Number({
		description: 'Voice WebSocket token expiry in seconds',
		default: 300,
	}),

	// OpenAI (for paid AI chat)
	OPENAI_API_KEY: Type.Optional(
		Type.String({
			description: 'OpenAI API key',
			default: 'sk-proj-1234567890',
		}),
	),
	OPENAI_MODEL: Type.String({
		description: 'OpenAI model name',
		default: 'gpt-4o-mini',
	}),
	OPENAI_INPUT_COST_PER_1M: Type.String({
		description: 'OpenAI input cost per 1M tokens (fallback when model not in openai-pricing)',
		default: '0.15',
	}),
	OPENAI_OUTPUT_COST_PER_1M: Type.String({
		description: 'OpenAI output cost per 1M tokens (fallback when model not in openai-pricing)',
		default: '0.60',
	}),

	// OAuth (Google and Apple)
	GOOGLE_CLIENT_ID: Type.Optional(
		Type.String({
			description: 'Google OAuth client ID',
			default: '',
		}),
	),
	GOOGLE_CLIENT_SECRET: Type.Optional(
		Type.String({
			description: 'Google OAuth client secret',
			default: '',
		}),
	),
	APPLE_CLIENT_ID: Type.Optional(
		Type.String({
			description: 'Apple OAuth client ID',
			default: '',
		}),
	),
	APPLE_TEAM_ID: Type.Optional(
		Type.String({
			description: 'Apple Developer Team ID',
			default: '',
		}),
	),
	APPLE_KEY_ID: Type.Optional(
		Type.String({
			description: 'Apple Sign in with Apple key ID',
			default: '',
		}),
	),
	APPLE_PRIVATE_KEY: Type.Optional(
		Type.String({
			description: 'Apple .p8 private key content',
			default: '',
		}),
	),

	// Free AI Chat Limits
	DAILY_MESSAGE_LIMIT: Type.String({
		description: 'Daily message limit for free tier',
		default: '50',
	}),
	DAILY_TOKEN_LIMIT: Type.String({
		description: 'Daily token limit for free tier',
		default: '10000',
	}),
	MONTHLY_SESSION_LIMIT: Type.String({
		description: 'Monthly session limit for free tier',
		default: '10',
	}),
	MAX_MESSAGES_PER_SESSION: Type.String({
		description: 'Max messages per session',
		default: '20',
	}),
	MAX_TOKENS_PER_REQUEST: Type.String({
		description: 'Max tokens per request',
		default: '2000',
	}),
	CHAT_MESSAGE_MAX_CHARS: Type.Number({
		description: 'Max characters per user message in free and paid chat (LLM-style limit)',
		default: 4096,
	}),
	PAID_MAX_MESSAGES_IN_CONTEXT: Type.Number({
		description: 'Max conversation messages to send to OpenAI for paid chat context',
		default: 20,
	}),

	// Trial (unauthenticated) limits and abuse protection
	TRIAL_CHAT_MAX_SESSIONS: Type.Number({
		description: 'Max trial chat sessions per identity (lifetime)',
		default: 1,
	}),
	TRIAL_CHAT_MAX_MESSAGES: Type.Number({
		description: 'Max trial chat messages per identity (lifetime)',
		default: 5,
	}),
	TRIAL_CHAT_MAX_TOKENS_PER_REQUEST: Type.Number({
		description: 'Max tokens per trial chat message',
		default: 500,
	}),
	TRIAL_VOICE_MAX_SESSIONS: Type.Number({
		description: 'Max trial voice sessions per identity (lifetime)',
		default: 1,
	}),
	TRIAL_VOICE_MAX_SECONDS: Type.Number({
		description: 'Max trial voice seconds per identity (lifetime)',
		default: 90,
	}),
	TRIAL_RATE_LIMIT_PER_IP_PER_HOUR: Type.Number({
		description: 'Max trial session creations per IP per hour',
		default: 10,
	}),
	TRIAL_RATE_LIMIT_PER_IP_PER_DAY: Type.Number({
		description: 'Max trial session creations per IP per day (24h sliding)',
		default: 30,
	}),
	TRIAL_MAX_IDENTITIES_PER_IP_PER_DAY: Type.Number({
		description: 'Max distinct trial identities from same IP in 24h (abuse block)',
		default: 15,
	}),

	// Free anonymous (no login, X-Device-Id) limits – same tables as trial, higher caps
	FREE_ANONYMOUS_CHAT_MAX_SESSIONS: Type.Number({
		description: 'Max free anonymous chat sessions per identity (lifetime)',
		default: 20,
	}),
	FREE_ANONYMOUS_CHAT_MAX_MESSAGES: Type.Number({
		description: 'Max free anonymous chat messages per identity (lifetime)',
		default: 200,
	}),
	FREE_ANONYMOUS_CHAT_MAX_TOKENS_PER_REQUEST: Type.Number({
		description: 'Max tokens per free anonymous chat message',
		default: 2000,
	}),
	FREE_ANONYMOUS_VOICE_MAX_SESSIONS: Type.Number({
		description: 'Max free anonymous voice sessions per identity (lifetime)',
		default: 10,
	}),
	FREE_ANONYMOUS_VOICE_MAX_SECONDS: Type.Number({
		description: 'Max free anonymous voice seconds per identity (lifetime)',
		default: 600,
	}),

	// OpenTelemetry (SigNoz / OTLP)
	OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: Type.Optional(
		Type.String({
			description: 'OTLP traces endpoint (e.g. http://signoz:4318/v1/traces)',
			default: '',
		}),
	),
	OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: Type.Optional(
		Type.String({
			description: 'OTLP metrics endpoint (e.g. http://signoz:4318/v1/metrics)',
			default: '',
		}),
	),
	OTEL_SERVICE_NAME: Type.Optional(
		Type.String({
			description: 'Service name for telemetry resource',
			default: 'beewise-api',
		}),
	),
	OTEL_SERVICE_VERSION: Type.Optional(
		Type.String({
			description: 'Service version for telemetry resource',
			default: '1.0.0',
		}),
	),
});

export type Env = Static<typeof EnvSchema>;

export function validateEnv(): Env {
	const rawCorsOrigin = process.env['CORS_ORIGIN'];
	const corsOriginArray = rawCorsOrigin
		? rawCorsOrigin.split(',').map((origin) => origin.trim())
		: ['http://localhost:3000']; // Default fallback

	const nodeEnv = process.env['NODE_ENV'] || 'development';
	const appEnvRaw = process.env['APP_ENV'];
	const appEnv =
		appEnvRaw === 'staging' || appEnvRaw === 'production' || appEnvRaw === 'local'
			? appEnvRaw
			: nodeEnv === 'production'
				? 'production'
				: 'local';
	const rawEnv = {
		NODE_ENV: nodeEnv,
		APP_ENV: appEnv,
		PORT: Number(process.env['PORT'] ?? 3000),
		HOST: process.env['HOST'] || '0.0.0.0',
		DATABASE_URL: process.env['DATABASE_URL'] || 'postgresql://localhost:5432/beewise',
		ENABLE_AUTH: process.env['ENABLE_AUTH'] !== 'false',
		REQUIRE_EMAIL_VERIFICATION: process.env['REQUIRE_EMAIL_VERIFICATION'] === 'true',
		BETTER_AUTH_SECRET: process.env['BETTER_AUTH_SECRET'] || 'development-secret-min-32-characters-long',
		BETTER_AUTH_URL: process.env['BETTER_AUTH_URL'] || 'http://localhost:3000',
		JWT_SECRET:
			process.env['JWT_SECRET'] ||
			process.env['BETTER_AUTH_SECRET'] ||
			'development-secret-min-32-characters-long',
		LOG_LEVEL: process.env['LOG_LEVEL'] || 'info',
		CORS_ORIGIN: corsOriginArray,
		RESEND_API_KEY: process.env['RESEND_API_KEY'] ?? '',
		EMAIL_FROM: process.env['EMAIL_FROM'] || 'noreply@example.com',
		ENABLE_RATE_LIMITER: process.env['ENABLE_RATE_LIMITER'] !== 'false',
		RATE_LIMIT_WINDOW_MS: process.env['RATE_LIMIT_WINDOW_MS']
			? Number(process.env['RATE_LIMIT_WINDOW_MS'])
			: 60000,
		RATE_LIMIT_MAX: process.env['RATE_LIMIT_MAX']
			? Number(process.env['RATE_LIMIT_MAX'])
			: 100,
		AUTH_RATE_LIMIT_WINDOW_MS: process.env['AUTH_RATE_LIMIT_WINDOW_MS']
			? Number(process.env['AUTH_RATE_LIMIT_WINDOW_MS'])
			: 60000,
		AUTH_RATE_LIMIT_MAX: process.env['AUTH_RATE_LIMIT_MAX']
			? Number(process.env['AUTH_RATE_LIMIT_MAX'])
			: 10,
		AWS_ACCESS_KEY_ID: process.env['AWS_ACCESS_KEY_ID'] ?? '',
		AWS_SECRET_ACCESS_KEY: process.env['AWS_SECRET_ACCESS_KEY'] ?? '',
		AWS_REGION: process.env['AWS_REGION'] || 'us-east-1',
		S3_BUCKET_NAME: process.env['S3_BUCKET_NAME'] || 'beewise-practice-recordings',
		BEDROCK_MODEL_ID: process.env['BEDROCK_MODEL_ID'] || 'amazon.titan-text-lite-v1',
		BEDROCK_COST_PER_1K_TOKENS: process.env['BEDROCK_COST_PER_1K_TOKENS'] || '0.0001',
		BEDROCK_NOVA_SONIC_MODEL_ID: process.env['BEDROCK_NOVA_SONIC_MODEL_ID'] || 'amazon.nova-sonic-v1:0',
		VOICE_WS_TOKEN_EXPIRY_SEC: process.env['VOICE_WS_TOKEN_EXPIRY_SEC']
			? Number(process.env['VOICE_WS_TOKEN_EXPIRY_SEC'])
			: 300,
		OPENAI_API_KEY: process.env['OPENAI_API_KEY'] ?? 'sk-proj-1234567890',
		OPENAI_MODEL: process.env['OPENAI_MODEL'] || 'gpt-5-nano',
		OPENAI_INPUT_COST_PER_1M: process.env['OPENAI_INPUT_COST_PER_1M'] || '0.15',
		OPENAI_OUTPUT_COST_PER_1M: process.env['OPENAI_OUTPUT_COST_PER_1M'] || '0.60',
		GOOGLE_CLIENT_ID: process.env['GOOGLE_CLIENT_ID'] ?? '',
		GOOGLE_CLIENT_SECRET: process.env['GOOGLE_CLIENT_SECRET'] ?? '',
		APPLE_CLIENT_ID: process.env['APPLE_CLIENT_ID'] ?? '',
		APPLE_TEAM_ID: process.env['APPLE_TEAM_ID'] ?? '',
		APPLE_KEY_ID: process.env['APPLE_KEY_ID'] ?? '',
		APPLE_PRIVATE_KEY: process.env['APPLE_PRIVATE_KEY'] ?? '',
		DAILY_MESSAGE_LIMIT: process.env['DAILY_MESSAGE_LIMIT'] || '50',
		DAILY_TOKEN_LIMIT: process.env['DAILY_TOKEN_LIMIT'] || '10000',
		MONTHLY_SESSION_LIMIT: process.env['MONTHLY_SESSION_LIMIT'] || '10',
		MAX_MESSAGES_PER_SESSION: process.env['MAX_MESSAGES_PER_SESSION'] || '20',
		MAX_TOKENS_PER_REQUEST: process.env['MAX_TOKENS_PER_REQUEST'] || '2000',
		CHAT_MESSAGE_MAX_CHARS: process.env['CHAT_MESSAGE_MAX_CHARS']
			? Number(process.env['CHAT_MESSAGE_MAX_CHARS'])
			: 4096,
		PAID_MAX_MESSAGES_IN_CONTEXT: process.env['PAID_MAX_MESSAGES_IN_CONTEXT']
			? Number(process.env['PAID_MAX_MESSAGES_IN_CONTEXT'])
			: 20,
		TRIAL_CHAT_MAX_SESSIONS: process.env['TRIAL_CHAT_MAX_SESSIONS']
			? Number(process.env['TRIAL_CHAT_MAX_SESSIONS'])
			: 1,
		TRIAL_CHAT_MAX_MESSAGES: process.env['TRIAL_CHAT_MAX_MESSAGES']
			? Number(process.env['TRIAL_CHAT_MAX_MESSAGES'])
			: 5,
		TRIAL_CHAT_MAX_TOKENS_PER_REQUEST: process.env['TRIAL_CHAT_MAX_TOKENS_PER_REQUEST']
			? Number(process.env['TRIAL_CHAT_MAX_TOKENS_PER_REQUEST'])
			: 500,
		TRIAL_VOICE_MAX_SESSIONS: process.env['TRIAL_VOICE_MAX_SESSIONS']
			? Number(process.env['TRIAL_VOICE_MAX_SESSIONS'])
			: 1,
		TRIAL_VOICE_MAX_SECONDS: process.env['TRIAL_VOICE_MAX_SECONDS']
			? Number(process.env['TRIAL_VOICE_MAX_SECONDS'])
			: 90,
		TRIAL_RATE_LIMIT_PER_IP_PER_HOUR: process.env['TRIAL_RATE_LIMIT_PER_IP_PER_HOUR']
			? Number(process.env['TRIAL_RATE_LIMIT_PER_IP_PER_HOUR'])
			: 10,
		TRIAL_RATE_LIMIT_PER_IP_PER_DAY: process.env['TRIAL_RATE_LIMIT_PER_IP_PER_DAY']
			? Number(process.env['TRIAL_RATE_LIMIT_PER_IP_PER_DAY'])
			: 30,
		TRIAL_MAX_IDENTITIES_PER_IP_PER_DAY: process.env['TRIAL_MAX_IDENTITIES_PER_IP_PER_DAY']
			? Number(process.env['TRIAL_MAX_IDENTITIES_PER_IP_PER_DAY'])
			: 15,
		FREE_ANONYMOUS_CHAT_MAX_SESSIONS: process.env['FREE_ANONYMOUS_CHAT_MAX_SESSIONS']
			? Number(process.env['FREE_ANONYMOUS_CHAT_MAX_SESSIONS'])
			: 20,
		FREE_ANONYMOUS_CHAT_MAX_MESSAGES: process.env['FREE_ANONYMOUS_CHAT_MAX_MESSAGES']
			? Number(process.env['FREE_ANONYMOUS_CHAT_MAX_MESSAGES'])
			: 200,
		FREE_ANONYMOUS_CHAT_MAX_TOKENS_PER_REQUEST: process.env['FREE_ANONYMOUS_CHAT_MAX_TOKENS_PER_REQUEST']
			? Number(process.env['FREE_ANONYMOUS_CHAT_MAX_TOKENS_PER_REQUEST'])
			: 2000,
		FREE_ANONYMOUS_VOICE_MAX_SESSIONS: process.env['FREE_ANONYMOUS_VOICE_MAX_SESSIONS']
			? Number(process.env['FREE_ANONYMOUS_VOICE_MAX_SESSIONS'])
			: 10,
		FREE_ANONYMOUS_VOICE_MAX_SECONDS: process.env['FREE_ANONYMOUS_VOICE_MAX_SECONDS']
			? Number(process.env['FREE_ANONYMOUS_VOICE_MAX_SECONDS'])
			: 600,
		OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: process.env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'] ?? '',
		OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: process.env['OTEL_EXPORTER_OTLP_METRICS_ENDPOINT'] ?? '',
		OTEL_SERVICE_NAME: process.env['OTEL_SERVICE_NAME'] ?? 'beewise-api',
		OTEL_SERVICE_VERSION: process.env['OTEL_SERVICE_VERSION'] ?? '1.0.0',
	};

	// Validate against schema
	if (!Value.Check(EnvSchema, rawEnv)) {
		const errors = [...Value.Errors(EnvSchema, rawEnv)];
		const errorMessages = errors.map((error) => `  - ${error.path}: ${error.message}`).join('\n');

		throw new Error(`[ERROR] Environment validation failed:\n${errorMessages}`);
	}

	return Value.Decode(EnvSchema, rawEnv);
}

export const env = validateEnv();
