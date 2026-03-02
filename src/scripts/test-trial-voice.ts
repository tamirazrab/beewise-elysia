import WebSocket from 'ws';

const BASE_URL = process.env.VOICE_BASE_URL ?? 'http://localhost:3000';
const TRIAL_DEVICE_ID = process.env.VOICE_TRIAL_DEVICE_ID ?? 'test-device-voice-001';

async function createTrialVoiceSession() {
	const response = await fetch(`${BASE_URL}/api/trial/voice/session`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'X-Trial-Device-Id': TRIAL_DEVICE_ID,
		},
		body: JSON.stringify({
			language_code: 'en',
			trial_device_id: TRIAL_DEVICE_ID,
		}),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(
			`Failed to create trial voice session: ${response.status} ${response.statusText} - ${text}`,
		);
	}

	return (await response.json()) as { session_id: string; ws_url: string; token: string };
}

// Very small dummy PCM payload (not real speech, just to drive the pipeline)
function buildDummyPcmChunk(): string {
	const samples = 1600; // 0.1s at 16kHz
	const buffer = new ArrayBuffer(samples * 2);
	const view = new DataView(buffer);
	for (let i = 0; i < samples; i++) {
		const sample = i % 2 === 0 ? 1000 : -1000;
		view.setInt16(i * 2, sample, true);
	}
	return Buffer.from(buffer).toString('base64');
}

async function main() {
	console.log('[trial-voice-test] Creating trial voice session...');
	const { session_id, ws_url } = await createTrialVoiceSession();
	console.log('[trial-voice-test] Session created:', { session_id, ws_url });

	console.log('[trial-voice-test] Connecting WebSocket...');
	const ws = new WebSocket(ws_url);

	ws.on('open', () => {
		console.log('[trial-voice-test] WebSocket open, sending audio chunks...');
		const base64Chunk = buildDummyPcmChunk();

		let sent = 0;
		const interval = setInterval(() => {
			if (ws.readyState !== WebSocket.OPEN) {
				clearInterval(interval);
				return;
			}
			if (sent >= 10) {
				console.log('[trial-voice-test] Sent 10 chunks, closing WebSocket...');
				clearInterval(interval);
				ws.close(1000, 'test-complete');
				return;
			}
			ws.send(JSON.stringify({ audio: base64Chunk }));
			sent += 1;
			console.log(`[trial-voice-test] Sent chunk #${sent}`);
		}, 100);
	});

	ws.on('message', (data) => {
		try {
			const parsed = JSON.parse(data.toString());
			console.log('[trial-voice-test] Received event:', parsed);
		} catch {
			console.log('[trial-voice-test] Received raw:', data.toString());
		}
	});

	ws.on('error', (err) => {
		console.error('[trial-voice-test] WebSocket error:', err);
	});

	ws.on('close', (code, reason) => {
		console.log(
			'[trial-voice-test] WebSocket closed:',
			code,
			typeof reason === 'string' ? reason : reason.toString(),
		);
		process.exit(0);
	});
}

main().catch((err) => {
	console.error('[trial-voice-test] Failed:', err);
	process.exit(1);
});

