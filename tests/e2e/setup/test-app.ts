import { createApp } from '../../src/app';
import ky, { type KyInstance } from 'ky';

export interface TestApp {
	baseUrl: string;
	client: KyInstance;
	stop: () => Promise<void>;
}

/**
 * Start a real Elysia app instance on a random port and
 * return a ky client preconfigured with that base URL.
 */
export async function startTestApp(): Promise<TestApp> {
	const app = createApp();
	const server = app.listen({ port: 0 });
	const port = server.server.port;
	const baseUrl = `http://127.0.0.1:${port}`;

	const client = ky.create({
		prefixUrl: baseUrl,
		retry: 0,
	});

	return {
		baseUrl,
		client,
		stop: async () => {
			await server.stop();
		},
	};
}

