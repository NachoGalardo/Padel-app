import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storage: localStorage,
  },
  global: {
    headers: {
      'x-app-version': import.meta.env.VITE_APP_VERSION ?? 'dev',
    },
  },
});

// Helper to get current session
export async function getSession() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  return session;
}

// Helper to get current user
export async function getUser() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw error;
  return user;
}

// Helper for authenticated API calls with tenant header
export async function fetchWithTenant<T>(
  endpoint: string,
  tenantId: string,
  options: RequestInit = {}
): Promise<T> {
  const session = await getSession();
  
  if (!session) {
    throw new Error('No authenticated session');
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      'X-Tenant-ID': tenantId,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw new ApiError(
      error.error?.code ?? 'UNKNOWN_ERROR',
      error.error?.message ?? 'An error occurred',
      response.status
    );
  }

  return response.json();
}

// Custom API Error
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

