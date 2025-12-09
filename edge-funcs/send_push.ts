// Edge Function: send_push
// Responsabilidad: helper para enviar notificaciones Expo push.

import * as Sentry from '@sentry/node';
import { isCircuitOpen, recordFailure } from './_shared';

const SENTRY_DSN = process.env.SENTRY_DSN;
Sentry.init({ dsn: SENTRY_DSN, tracesSampleRate: 0.1 });

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const TIMEOUT_MS = 8000;

interface PushPayload {
  to: string | string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

async function withTimeout<T>(promise: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Timeout')))),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req: Request): Promise<Response> {
  try {
    if (isCircuitOpen()) return new Response('Servicio temporalmente pausado', { status: 503 });
    const body = (await req.json()) as PushPayload;
    if (!body.to || !body.title || !body.body) {
      return new Response('Payload incompleto', { status: 400 });
    }

    const pushResponse = await withTimeout(
      fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    );

    if (!pushResponse.ok) {
      const text = await pushResponse.text();
      throw new Error(`Expo push error: ${text}`);
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    recordFailure();
    Sentry.captureException(err);
    const message = err instanceof Error ? err.message : 'Error inesperado';
    return new Response(JSON.stringify({ error: message }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

