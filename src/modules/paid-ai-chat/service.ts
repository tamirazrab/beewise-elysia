import { getTextLlmCost } from '@common/config/openai-pricing';
import { env } from '@common/config/env';
import OpenAI from 'openai';

/**
 * Paid AI Chat Service
 * Handles OpenAI integration for paid-tier chat.
 * Cost is computed from per-1M token pricing (see openai-pricing.ts).
 */

const openai = new OpenAI({
	apiKey: env.OPENAI_API_KEY,
});

export interface OpenAIResponse {
	content: string;
	tokensUsed: number;
	costUsd: number;
}

const SYSTEM_PROMPT = `You are a helpful language learning assistant. 
Help users practice their target language through conversation.
Be encouraging, correct mistakes gently, and provide explanations when appropriate.`;

export async function invokeOpenAI(
	messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
): Promise<OpenAIResponse> {
	const response = await openai.chat.completions.create({
		model: env.OPENAI_MODEL,
		messages: messages.map((msg) => ({
			role: msg.role,
			content: msg.content,
		})),
		temperature: 1,
	});

	const choice = response.choices[0];
	if (!choice || !choice.message) {
		throw new Error('No response from OpenAI');
	}

	const inputTokens = response.usage?.prompt_tokens ?? 0;
	const outputTokens = response.usage?.completion_tokens ?? 0;
	const totalTokens = inputTokens + outputTokens;

	const usage = response.usage as { prompt_tokens_details?: { cached_tokens?: number } } | undefined;
	const cachedInputTokens = usage?.prompt_tokens_details?.cached_tokens ?? 0;

	let costUsd = getTextLlmCost(env.OPENAI_MODEL, inputTokens, outputTokens, cachedInputTokens);
	if (costUsd === 0 && totalTokens > 0) {
		costUsd =
			(inputTokens / 1_000_000) * Number.parseFloat(env.OPENAI_INPUT_COST_PER_1M) +
			(outputTokens / 1_000_000) * Number.parseFloat(env.OPENAI_OUTPUT_COST_PER_1M);
	}

	return {
		content: choice.message.content || '',
		tokensUsed: totalTokens,
		costUsd,
	};
}

export { SYSTEM_PROMPT };
