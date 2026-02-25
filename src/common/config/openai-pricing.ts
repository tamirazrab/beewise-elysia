/**
 * OpenAI model pricing per 1M tokens.
 * Input / Cached input / Output in USD per million tokens.
 * Used to compute cost from usage (prompt_tokens, completion_tokens, optional cached).
 */

export interface PricePer1M {
	/** USD per 1M input (non-cached) tokens */
	input: number;
	/** USD per 1M cached input tokens (optional; if missing, use input for all prompt tokens) */
	cachedInput?: number;
	/** USD per 1M output tokens */
	output: number;
}

/** Text LLM (chat/completion) models – for paid AI chat */
export const TEXT_LLM_PRICING: Record<string, PricePer1M> = {
	'gpt-5.2': { input: 1.75, cachedInput: 0.175, output: 14.0 },
	'gpt-5.1': { input: 1.25, cachedInput: 0.125, output: 10.0 },
	'gpt-5': { input: 1.25, cachedInput: 0.125, output: 10.0 },
	'gpt-5-mini': { input: 0.25, cachedInput: 0.025, output: 2.0 },
	'gpt-5-nano': { input: 0.05, cachedInput: 0.005, output: 0.4 },
	'gpt-5.2-chat-latest': { input: 1.75, cachedInput: 0.175, output: 14.0 },
	'gpt-5.1-chat-latest': { input: 1.25, cachedInput: 0.125, output: 10.0 },
	'gpt-5-chat-latest': { input: 1.25, cachedInput: 0.125, output: 10.0 },
	'gpt-5.3-codex': { input: 1.75, cachedInput: 0.175, output: 14.0 },
	'gpt-5.2-codex': { input: 1.75, cachedInput: 0.175, output: 14.0 },
	'gpt-5.1-codex-max': { input: 1.25, cachedInput: 0.125, output: 10.0 },
	'gpt-5.1-codex': { input: 1.25, cachedInput: 0.125, output: 10.0 },
	'gpt-5-codex': { input: 1.25, cachedInput: 0.125, output: 10.0 },
	'gpt-5.2-pro': { input: 21.0, output: 168.0 },
	'gpt-5-pro': { input: 15.0, output: 120.0 },
	'gpt-4.1': { input: 2.0, cachedInput: 0.5, output: 8.0 },
	'gpt-4.1-mini': { input: 0.4, cachedInput: 0.1, output: 1.6 },
	'gpt-4.1-nano': { input: 0.1, cachedInput: 0.025, output: 0.4 },
	'gpt-4o': { input: 2.5, cachedInput: 1.25, output: 10.0 },
	'gpt-4o-2024-05-13': { input: 5.0, output: 15.0 },
	'gpt-4o-mini': { input: 0.15, cachedInput: 0.075, output: 0.6 },
	'o1': { input: 15.0, cachedInput: 7.5, output: 60.0 },
	'o1-pro': { input: 150.0, output: 600.0 },
	'o3-pro': { input: 20.0, output: 80.0 },
	'o3': { input: 2.0, cachedInput: 0.5, output: 8.0 },
	'o3-deep-research': { input: 10.0, cachedInput: 2.5, output: 40.0 },
	'o4-mini': { input: 1.1, cachedInput: 0.275, output: 4.4 },
	'o4-mini-deep-research': { input: 2.0, cachedInput: 0.5, output: 8.0 },
	'o3-mini': { input: 1.1, cachedInput: 0.55, output: 4.4 },
	'o1-mini': { input: 1.1, cachedInput: 0.55, output: 4.4 },
	'gpt-5.1-codex-mini': { input: 0.25, cachedInput: 0.025, output: 2.0 },
	'codex-mini-latest': { input: 1.5, cachedInput: 0.375, output: 6.0 },
	'gpt-5-search-api': { input: 1.25, cachedInput: 0.125, output: 10.0 },
	'gpt-4o-mini-search-preview': { input: 0.15, output: 0.6 },
	'gpt-4o-search-preview': { input: 2.5, output: 10.0 },
	'computer-use-preview': { input: 3.0, output: 12.0 },
};

/** Audio models – for voice/audio features */
export const AUDIO_PRICING: Record<string, PricePer1M> = {
	'gpt-audio': { input: 2.5, output: 10.0 },
	'gpt-audio-1.5': { input: 2.5, output: 10.0 },
	'gpt-audio-mini': { input: 0.6, output: 2.4 },
	'gpt-4o-audio-preview': { input: 2.5, output: 10.0 },
	'gpt-4o-mini-audio-preview': { input: 0.15, output: 0.6 },
};

/** Realtime chat models */
export const REALTIME_PRICING: Record<string, PricePer1M> = {
	'gpt-realtime': { input: 4.0, cachedInput: 0.4, output: 16.0 },
	'gpt-realtime-1.5': { input: 4.0, cachedInput: 0.4, output: 16.0 },
	'gpt-realtime-mini': { input: 0.6, cachedInput: 0.06, output: 2.4 },
	'gpt-4o-realtime-preview': { input: 5.0, cachedInput: 2.5, output: 20.0 },
	'gpt-4o-mini-realtime-preview': { input: 0.6, cachedInput: 0.3, output: 2.4 },
};

const PER_1M = 1_000_000;

/**
 * Compute cost in USD for text LLM usage.
 * Prices are per 1M tokens; cached input uses cachedInput rate when available.
 */
export function getTextLlmCost(
	modelId: string,
	inputTokens: number,
	outputTokens: number,
	cachedInputTokens = 0,
): number {
	const prices = TEXT_LLM_PRICING[modelId];
	if (!prices) {
		return 0;
	}
	const nonCachedInput = Math.max(0, inputTokens - cachedInputTokens);
	const inputCost =
		(nonCachedInput / PER_1M) * prices.input +
		(prices.cachedInput != null ? (cachedInputTokens / PER_1M) * prices.cachedInput : (cachedInputTokens / PER_1M) * prices.input);
	const outputCost = (outputTokens / PER_1M) * prices.output;
	return inputCost + outputCost;
}

/**
 * Compute cost in USD for audio model usage (same token units: per 1M).
 */
export function getAudioCost(
	modelId: string,
	inputTokens: number,
	outputTokens: number,
	cachedInputTokens = 0,
): number {
	const prices = AUDIO_PRICING[modelId];
	if (!prices) {
		return 0;
	}
	const nonCachedInput = Math.max(0, inputTokens - cachedInputTokens);
	const inputCost =
		(nonCachedInput / PER_1M) * prices.input +
		(prices.cachedInput != null ? (cachedInputTokens / PER_1M) * prices.cachedInput : (cachedInputTokens / PER_1M) * prices.input);
	const outputCost = (outputTokens / PER_1M) * prices.output;
	return inputCost + outputCost;
}

/**
 * Compute cost in USD for realtime model usage (per 1M tokens).
 */
export function getRealtimeCost(
	modelId: string,
	inputTokens: number,
	outputTokens: number,
	cachedInputTokens = 0,
): number {
	const prices = REALTIME_PRICING[modelId];
	if (!prices) {
		return 0;
	}
	const nonCachedInput = Math.max(0, inputTokens - cachedInputTokens);
	const inputCost =
		(nonCachedInput / PER_1M) * prices.input +
		(prices.cachedInput != null ? (cachedInputTokens / PER_1M) * prices.cachedInput : (cachedInputTokens / PER_1M) * prices.input);
	const outputCost = (outputTokens / PER_1M) * prices.output;
	return inputCost + outputCost;
}
