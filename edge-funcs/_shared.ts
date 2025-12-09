import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Pool, PoolClient } from 'pg';
import * as Sentry from '@sentry/node';

type Role = 'admin' | 'player';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const SENTRY_DSN = process.env.SENTRY_DSN;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
}

Sentry.init({ dsn: SENTRY_DSN, tracesSampleRate: 0.2 });

export const adminClient: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const pool = SUPABASE_DB_URL
  ? new Pool({ connectionString: SUPABASE_DB_URL, max: 5 })
  : null;

export const TIMEOUT_MS = 8000;
const FAILURE_WINDOW_MS = 60_000;
const FAILURE_THRESHOLD = 5;

let failureTimestamps: number[] = [];

export function isCircuitOpen(): boolean {
  const now = Date.now();
  failureTimestamps = failureTimestamps.filter((ts) => now - ts <= FAILURE_WINDOW_MS);
  return failureTimestamps.length >= FAILURE_THRESHOLD;
}

export function recordFailure() {
  failureTimestamps.push(Date.now());
}

export async function withTimeout<T>(promise: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
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

export async function getUserAndRole(token: string): Promise<{ userId: string; role: Role }> {
  const { data: userData, error: userError } = await adminClient.auth.getUser(token);
  if (userError || !userData?.user) throw new Error('No autorizado');
  const userId = userData.user.id;
  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();
  if (profileError || !profile) throw new Error('Perfil no encontrado');
  return { userId, role: profile.role as Role };
}

export function requireAdmin(role: Role) {
  if (role !== 'admin') throw new Error('Solo admin');
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  if (!pool) throw new Error('SUPABASE_DB_URL no configurado');
  const client = await pool.connect();
  try {
    await client.query('begin isolation level serializable');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

