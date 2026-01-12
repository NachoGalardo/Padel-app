/**
 * =============================================================================
 * CLIENTE API CON MANEJO DE ERRORES Y RETRY
 * =============================================================================
 * 
 * Wrapper sobre fetch que:
 * - Transforma errores a AppError
 * - Retry automático para errores transitorios
 * - Manejo de offline
 * - Headers de tenant automáticos
 */

import { supabase, getSession } from './supabase';
import {
  AppError,
  NetworkError,
  TimeoutError,
  AuthenticationError,
  errorFromCode,
} from './errors';
import { useTenantStore } from '@/stores/tenantStore';

// =============================================================================
// TYPES
// =============================================================================

interface ApiRequestConfig {
  /** Timeout en ms (default: 30000) */
  timeout?: number;
  /** Número de reintentos (default: 3) */
  retries?: number;
  /** Headers adicionales */
  headers?: Record<string, string>;
  /** Idempotency key para POST/PUT/DELETE */
  idempotencyKey?: string;
  /** Skip retry (para operaciones no idempotentes) */
  skipRetry?: boolean;
}

interface ApiResponse<T> {
  data: T;
  headers: Headers;
  status: number;
}

// =============================================================================
// HELPERS
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateBackoff(attempt: number, baseDelay = 1000): number {
  const delay = baseDelay * Math.pow(2, attempt - 1);
  const jitter = Math.random() * 0.3 * delay;
  return Math.min(delay + jitter, 30000);
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

// =============================================================================
// FETCH WITH TIMEOUT
// =============================================================================

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeout: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new TimeoutError();
      }
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new NetworkError();
      }
    }
    throw error;
  }
}

// =============================================================================
// API CLIENT
// =============================================================================

class ApiClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = import.meta.env.VITE_SUPABASE_URL;
  }

  private async getHeaders(config: ApiRequestConfig): Promise<Headers> {
    const headers = new Headers({
      'Content-Type': 'application/json',
      ...config.headers,
    });

    // Auth token
    const session = await getSession();
    if (session?.access_token) {
      headers.set('Authorization', `Bearer ${session.access_token}`);
    }

    // Tenant ID
    const tenantId = useTenantStore.getState().currentTenant?.id;
    if (tenantId) {
      headers.set('X-Tenant-ID', tenantId);
    }

    // Idempotency key
    if (config.idempotencyKey) {
      headers.set('Idempotency-Key', config.idempotencyKey);
    }

    return headers;
  }

  private async handleResponse<T>(response: Response): Promise<ApiResponse<T>> {
    // Handle no content
    if (response.status === 204) {
      return {
        data: null as T,
        headers: response.headers,
        status: response.status,
      };
    }

    const contentType = response.headers.get('content-type');
    let data: unknown;

    if (contentType?.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    // Handle errors
    if (!response.ok) {
      const errorData = data as { error?: { code?: string; message?: string; requestId?: string } };
      throw errorFromCode(errorData.error?.code ?? 'UNKNOWN_ERROR', {
        technicalMessage: errorData.error?.message,
        requestId: errorData.error?.requestId,
        retryAfter: response.headers.get('Retry-After')
          ? parseInt(response.headers.get('Retry-After')!, 10)
          : undefined,
      });
    }

    return {
      data: (data as { data: T }).data ?? (data as T),
      headers: response.headers,
      status: response.status,
    };
  }

  async request<T>(
    method: string,
    endpoint: string,
    body?: unknown,
    config: ApiRequestConfig = {}
  ): Promise<ApiResponse<T>> {
    const {
      timeout = 30000,
      retries = 3,
      skipRetry = false,
    } = config;

    const url = endpoint.startsWith('http')
      ? endpoint
      : `${this.baseUrl}/functions/v1/${endpoint}`;

    const headers = await this.getHeaders(config);
    const options: RequestInit = {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    };

    let lastError: AppError | null = null;
    let attempt = 0;

    while (attempt < retries) {
      attempt++;

      try {
        const response = await fetchWithTimeout(url, options, timeout);
        return await this.handleResponse<T>(response);
      } catch (error) {
        if (error instanceof AppError) {
          lastError = error;

          // No retry para ciertos errores
          if (skipRetry || !error.retryable || error instanceof AuthenticationError) {
            throw error;
          }

          // Último intento
          if (attempt >= retries) {
            throw error;
          }

          // Esperar antes de reintentar
          const delay = error.retryDelay ?? calculateBackoff(attempt);
          await sleep(delay);
        } else {
          // Error desconocido
          throw AppError.fromNetworkError(error as Error);
        }
      }
    }

    throw lastError ?? new AppError({
      code: 'UNKNOWN_ERROR',
      status: 0,
      userTitle: 'Error',
      userMessage: 'Ocurrió un error inesperado',
      retryable: false,
    });
  }

  // Convenience methods
  async get<T>(endpoint: string, config?: ApiRequestConfig): Promise<T> {
    const response = await this.request<T>('GET', endpoint, undefined, config);
    return response.data;
  }

  async post<T>(endpoint: string, body?: unknown, config?: ApiRequestConfig): Promise<T> {
    const response = await this.request<T>('POST', endpoint, body, {
      ...config,
      idempotencyKey: config?.idempotencyKey ?? crypto.randomUUID(),
    });
    return response.data;
  }

  async put<T>(endpoint: string, body?: unknown, config?: ApiRequestConfig): Promise<T> {
    const response = await this.request<T>('PUT', endpoint, body, {
      ...config,
      idempotencyKey: config?.idempotencyKey ?? crypto.randomUUID(),
    });
    return response.data;
  }

  async patch<T>(endpoint: string, body?: unknown, config?: ApiRequestConfig): Promise<T> {
    const response = await this.request<T>('PATCH', endpoint, body, config);
    return response.data;
  }

  async delete<T>(endpoint: string, config?: ApiRequestConfig): Promise<T> {
    const response = await this.request<T>('DELETE', endpoint, undefined, {
      ...config,
      idempotencyKey: config?.idempotencyKey ?? crypto.randomUUID(),
    });
    return response.data;
  }
}

// Singleton
export const api = new ApiClient();

// =============================================================================
// REACT QUERY HELPERS
// =============================================================================

/**
 * Wrapper para usar con React Query que maneja errores correctamente
 */
export function queryFn<T>(fn: () => Promise<T>) {
  return async (): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw AppError.fromNetworkError(error as Error);
    }
  };
}

/**
 * Configuración default para React Query
 */
export const defaultQueryConfig = {
  retry: (failureCount: number, error: unknown) => {
    if (error instanceof AppError) {
      return error.retryable && failureCount < 3;
    }
    return failureCount < 3;
  },
  retryDelay: (attemptIndex: number, error: unknown) => {
    if (error instanceof AppError && error.retryDelay) {
      return error.retryDelay;
    }
    return calculateBackoff(attemptIndex + 1);
  },
};

