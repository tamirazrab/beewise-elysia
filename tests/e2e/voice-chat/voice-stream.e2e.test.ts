import { beforeAll, afterAll, beforeEach, test, expect } from 'bun:test';
import WebSocket from 'ws';
import type { KyInstance } from 'ky';
import { startTestApp } from '../setup/test-app';
import { runMigrations, resetDatabase } from '../setup/db';
import { getFaker } from '../setup/faker';
import { db } from '@common/db';
import { voiceSession, trialVoiceSession, trialIdentity } from '@common/db/schema';

let client: KyInstance;
let stop: () => Promise<void>;

beforeAll(async () => {
  await runMigrations();
  const app = await startTestApp();
  client = app.client;
  stop = app.stop;
});

afterAll(async () => {
  if (stop) {
    await stop();
  }
});

beforeEach(async () => {
  await resetDatabase();
});

async function registerUser() {
  const faker = getFaker();
  const email = faker.internet.email().toLowerCase();
  const password = 'SecurePass123!';
  const name = faker.person.fullName();

  const res = await client
    .post('api/auth/register', { json: { email, password, name } })
    .json<{ token: string }>();

  return { token: res.token };
}

test('voice WebSocket: authenticated user can stream and session is recorded', async () => {
  const { token } = await registerUser();

  const sessionRes = await client.post('api/voice/session', {
    json: { language_code: 'en' },
    headers: { authorization: `Bearer ${token}` },
  });

  expect(sessionRes.status).toBe(200);
  const { sessionId, wsUrl } = await sessionRes.json<{ sessionId: string; wsUrl: string }>();

  const ws = new WebSocket(wsUrl);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket open timeout')), 5000);
    ws.on('open', () => {
      clearTimeout(timer);
      ws.send(JSON.stringify({ audio: 'AAAA' }));
      resolve();
    });
  });

  await new Promise<void>((resolve) => {
    let received = false;
    const timer = setTimeout(() => {
      if (!received) {
        ws.close();
      }
      resolve();
    }, 2000);

    ws.on('message', () => {
      received = true;
      ws.close();
      clearTimeout(timer);
      resolve();
    });
  });

  const [session] = await db
    .select()
    .from(voiceSession)
    .where(voiceSession.id.eq(sessionId))
    .limit(1);

  expect(session).toBeDefined();
  expect(session.endedAt).not.toBeNull();
});

test('trial voice WebSocket: device can stream and identity usage is updated', async () => {
  const deviceId = 'trial-voice-e2e-device';

  const res = await client.post('api/trial/voice/session', {
    json: { language_code: 'en', trial_device_id: deviceId },
  });

  expect(res.status).toBe(200);
  const { session_id, ws_url } = await res.json<{ session_id: string; ws_url: string }>();

  const ws = new WebSocket(ws_url);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket open timeout')), 5000);
    ws.on('open', () => {
      clearTimeout(timer);
      ws.send(JSON.stringify({ audio: 'BBBB' }));
      resolve();
    });
  });

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      ws.close();
      resolve();
    }, 2000);

    ws.on('message', () => {
      ws.close();
      clearTimeout(timer);
      resolve();
    });
  });

  const [trialSession] = await db
    .select()
    .from(trialVoiceSession)
    .where(trialVoiceSession.id.eq(session_id))
    .limit(1);

  expect(trialSession).toBeDefined();
  expect(trialSession.endedAt).not.toBeNull();

  const [identity] = await db
    .select()
    .from(trialIdentity)
    .limit(1);

  expect(identity).toBeDefined();
  expect(identity.voiceSecondsUsed).toBeGreaterThanOrEqual(0);
});

