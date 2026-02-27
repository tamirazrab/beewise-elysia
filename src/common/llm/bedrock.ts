import { BedrockRuntimeClient, ConverseCommand, type Message } from '@aws-sdk/client-bedrock-runtime';
import { env } from '@common/config/env';
import { recordExternalCall } from '@common/otel/metrics';
import { record } from '@elysiajs/opentelemetry';

let bedrockClient: BedrockRuntimeClient | null = null;

export function getBedrockClient(): BedrockRuntimeClient {
	if (bedrockClient) {
		return bedrockClient;
	}

	const accessKeyId = env.AWS_ACCESS_KEY_ID;
	const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;

	if (!accessKeyId || !secretAccessKey) {
		throw new Error(
			'AWS credentials not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in environment variables.',
		);
	}

	bedrockClient = new BedrockRuntimeClient({
		region: env.AWS_REGION,
		credentials: {
			accessKeyId,
			secretAccessKey,
		},
	});

	return bedrockClient;
}

export function estimateTokenCountSync(text: string): number {
	return Math.ceil(text.length / 4);
}

export async function estimateTokenCount(text: string): Promise<number> {
	return estimateTokenCountSync(text);
}

export interface BedrockResponse {
	content: string;
	tokensUsed: number;
	costUsd: number;
}

export async function invokeBedrockChat(
	messages: Array<{ role: string; content: string }>,
	systemPrompt: string,
): Promise<BedrockResponse> {
	// In test mode, return a deterministic stub response to avoid real AWS calls.
	if (env.NODE_ENV === 'test') {
		const combined = [systemPrompt, ...messages.map((m) => m.content)].join('\n').slice(0, 200);
		const tokensUsed = estimateTokenCountSync(combined);
		return {
			content: `[stubbed-bedrock-response]: ${combined}`,
			tokensUsed,
			costUsd: 0,
		};
	}

	const start = Date.now();
	try {
		const result = await record('bedrock.converse', async () => {
			const converseMessages: Message[] = messages
				.filter((msg) => msg.role !== 'system')
				.map((msg): Message => ({
					role: msg.role === 'user' ? 'user' : 'assistant',
					content: [{ text: msg.content }],
				}));

			const allText = `${systemPrompt}\n\n${messages.map((m) => m.content).join('\n')}`;
			const estimatedInputTokens = estimateTokenCountSync(allText);

			const command = new ConverseCommand({
				modelId: env.BEDROCK_MODEL_ID,
				system: [{ text: systemPrompt }],
				messages: converseMessages,
				inferenceConfig: {
					maxTokens: 1000,
					temperature: 0.7,
					topP: 0.9,
				},
			});

			const client = getBedrockClient();
			const response = await client.send(command);

			const outputText =
				response.output?.message?.content
					?.filter((block: any) => block.text != null)
					.map((block: any) => block.text)
					.join('') || '';

			const outputTokens = estimateTokenCountSync(outputText);
			const totalTokens = estimatedInputTokens + outputTokens;
			const costUsd = (totalTokens / 1000) * Number.parseFloat(env.BEDROCK_COST_PER_1K_TOKENS);

			return {
				content: outputText.trim(),
				tokensUsed: totalTokens,
				costUsd,
			};
		});
		recordExternalCall('bedrock', Date.now() - start, true);
		return result;
	} catch (e) {
		recordExternalCall('bedrock', Date.now() - start, false);
		throw e;
	}
}

