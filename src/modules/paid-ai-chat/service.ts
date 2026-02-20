import { env } from '@common/config/env';
import OpenAI from 'openai';

/**
 * Paid AI Chat Service
 * Handles OpenAI integration for paid-tier chat
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
		temperature: 0.7,
	});

	const choice = response.choices[0];
	if (!choice || !choice.message) {
		throw new Error('No response from OpenAI');
	}

	const inputTokens = response.usage?.prompt_tokens || 0;
	const outputTokens = response.usage?.completion_tokens || 0;
	const totalTokens = inputTokens + outputTokens;

	const costUsd =
		(inputTokens / 1000) * parseFloat(env.OPENAI_INPUT_COST_PER_1K) +
		(outputTokens / 1000) * parseFloat(env.OPENAI_OUTPUT_COST_PER_1K);

	return {
		content: choice.message.content || '',
		tokensUsed: totalTokens,
		costUsd,
	};
}

export { SYSTEM_PROMPT };
