import { env } from '@common/config/env';
import { appLogger } from '@common/logger';
import { getClientIP } from '@common/utils/request-ip';
import { Elysia } from 'elysia';
import { LRUCache } from 'lru-cache';

const globalCache = new LRUCache<string, number[]>({
	max: 10000,
	ttl: env.RATE_LIMIT_WINDOW_MS ?? 60000,
});

// Auth cache
const authCache = new LRUCache<string, number[]>({
	max: 1000,
	ttl: env.AUTH_RATE_LIMIT_WINDOW_MS ?? 60000,
});

export const createRateLimiter = (options: {
	max: number;
	windowMs: number;
	cache: LRUCache<string, number[]>;
	skip?: (req: Request) => boolean;
}) => {
	return new Elysia().onRequest(({ request, set }) => {
		// Skip if rate limiting is disabled
		if (!env.ENABLE_RATE_LIMITER) return;
		if (options.skip?.(request)) return;

		const ip = getClientIP(request);
		const now = Date.now();
		const timestamps = options.cache.get(ip) || [];

		const valid = timestamps.filter((ts) => now - ts < options.windowMs);
		valid.push(now);

		if (valid.length > options.max) {
			if (env.APP_ENV === 'local') {
				appLogger.warn(
					`[RATE_LIMIT] IP ${ip} blocked (limit: ${options.max}/${options.windowMs}ms)`,
				);
			}
			set.status = 429;
			return {
				error: 'Too Many Requests',
				message: 'Rate limit exceeded. Please try again later.',
			};
		}

		options.cache.set(ip, valid);
	});
};

export const globalRateLimit = createRateLimiter({
	max: env.RATE_LIMIT_MAX ?? 100,
	windowMs: env.RATE_LIMIT_WINDOW_MS ?? 60000,
	cache: globalCache,
	skip: (req) => {
		if (req.method === 'OPTIONS') return true;
		const path = new URL(req.url).pathname;
		return path === '/health' || path.startsWith('/api/auth');
	},
});

export const authRateLimit = createRateLimiter({
	max: env.AUTH_RATE_LIMIT_MAX ?? 10,
	windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS ?? 60000,
	cache: authCache,
});

// Trial: per-IP hourly and daily caps on session creation only
const trialHourlyCache = new LRUCache<string, number[]>({
	max: 50000,
	ttl: 60 * 60 * 1000, // 1 hour
});

const trialDailyCache = new LRUCache<string, number[]>({
	max: 50000,
	ttl: 24 * 60 * 60 * 1000, // 24 hours
});

const isTrialSessionCreation = (req: Request): boolean => {
	if (req.method !== 'POST') return false;
	const path = new URL(req.url).pathname;
	return path === '/api/trial/chat/sessions' || path === '/api/trial/voice/session';
};

export const trialRateLimit = new Elysia().onRequest(({ request, set }) => {
	if (!env.ENABLE_RATE_LIMITER) return;
	if (!isTrialSessionCreation(request)) return;

	const ip = getClientIP(request);
	const now = Date.now();

	const hourlyTimestamps = trialHourlyCache.get(ip) || [];
	const hourlyValid = hourlyTimestamps.filter((ts) => now - ts < 60 * 60 * 1000);
	hourlyValid.push(now);
	if (hourlyValid.length > (env.TRIAL_RATE_LIMIT_PER_IP_PER_HOUR ?? 10)) {
		set.status = 429;
		return {
			error: 'Too Many Requests',
			message: 'Too many trial sessions from this network. Try again later or sign up.',
		};
	}
	trialHourlyCache.set(ip, hourlyValid);

	const dailyTimestamps = trialDailyCache.get(ip) || [];
	const dailyValid = dailyTimestamps.filter((ts) => now - ts < 24 * 60 * 60 * 1000);
	dailyValid.push(now);
	if (dailyValid.length > (env.TRIAL_RATE_LIMIT_PER_IP_PER_DAY ?? 30)) {
		set.status = 429;
		return {
			error: 'Too Many Requests',
			message: 'Too many trial sessions from this network. Try again later or sign up.',
		};
	}
	trialDailyCache.set(ip, dailyValid);
});
