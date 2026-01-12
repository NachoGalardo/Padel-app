import { useState, useCallback, useRef } from 'react';
import { isRetryableError, type AppError } from '@/lib/errors';

interface RetryConfig {
  /** Máximo número de intentos */
  maxAttempts?: number;
  /** Delay base en ms */
  baseDelay?: number;
  /** Multiplicador para backoff exponencial */
  backoffMultiplier?: number;
  /** Máximo delay en ms */
  maxDelay?: number;
  /** Callback cuando se agotaron los intentos */
  onMaxAttemptsReached?: (error: AppError) => void;
  /** Callback en cada retry */
  onRetry?: (attempt: number, error: AppError) => void;
  /** Retry silencioso (sin notificar al usuario) */
  silent?: boolean;
}

interface RetryState {
  isRetrying: boolean;
  attempt: number;
  lastError: AppError | null;
  nextRetryAt: Date | null;
}

interface UseRetryResult<T> {
  execute: (fn: () => Promise<T>) => Promise<T>;
  state: RetryState;
  cancel: () => void;
  reset: () => void;
}

/**
 * Hook para ejecutar operaciones con retry automático
 * 
 * Características:
 * - Backoff exponencial con jitter
 * - Respeta retryDelay del error
 * - Cancellable
 * - Estado observable
 */
export function useRetry<T>(config: RetryConfig = {}): UseRetryResult<T> {
  const {
    maxAttempts = 3,
    baseDelay = 1000,
    backoffMultiplier = 2,
    maxDelay = 30000,
    onMaxAttemptsReached,
    onRetry,
    silent = false,
  } = config;

  const [state, setState] = useState<RetryState>({
    isRetrying: false,
    attempt: 0,
    lastError: null,
    nextRetryAt: null,
  });

  const cancelledRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setState((s) => ({ ...s, isRetrying: false, nextRetryAt: null }));
  }, []);

  const reset = useCallback(() => {
    cancel();
    cancelledRef.current = false;
    setState({
      isRetrying: false,
      attempt: 0,
      lastError: null,
      nextRetryAt: null,
    });
  }, [cancel]);

  const calculateDelay = useCallback(
    (attempt: number, error?: AppError): number => {
      // Usar delay del error si está disponible
      if (error?.retryDelay) {
        return Math.min(error.retryDelay, maxDelay);
      }

      // Backoff exponencial con jitter
      const exponentialDelay = baseDelay * Math.pow(backoffMultiplier, attempt - 1);
      const jitter = Math.random() * 0.3 * exponentialDelay; // ±30% jitter
      return Math.min(exponentialDelay + jitter, maxDelay);
    },
    [baseDelay, backoffMultiplier, maxDelay]
  );

  const execute = useCallback(
    async (fn: () => Promise<T>): Promise<T> => {
      cancelledRef.current = false;
      let attempt = 0;
      let lastError: AppError | null = null;

      while (attempt < maxAttempts) {
        attempt++;
        setState((s) => ({ ...s, attempt, isRetrying: attempt > 1 }));

        try {
          const result = await fn();
          // Éxito - resetear estado
          setState({
            isRetrying: false,
            attempt: 0,
            lastError: null,
            nextRetryAt: null,
          });
          return result;
        } catch (error) {
          if (cancelledRef.current) {
            throw error;
          }

          const appError = error as AppError;
          lastError = appError;

          setState((s) => ({ ...s, lastError: appError }));

          // Verificar si es retryable
          if (!isRetryableError(appError) || attempt >= maxAttempts) {
            if (attempt >= maxAttempts && onMaxAttemptsReached) {
              onMaxAttemptsReached(appError);
            }
            throw appError;
          }

          // Calcular delay y esperar
          const delay = calculateDelay(attempt, appError);
          const nextRetryAt = new Date(Date.now() + delay);

          setState((s) => ({ ...s, nextRetryAt }));

          if (onRetry && !silent) {
            onRetry(attempt, appError);
          }

          // Esperar antes del próximo intento
          await new Promise<void>((resolve) => {
            timeoutRef.current = setTimeout(resolve, delay);
          });

          if (cancelledRef.current) {
            throw lastError;
          }
        }
      }

      // No debería llegar aquí, pero por seguridad
      throw lastError ?? new Error('Max attempts reached');
    },
    [maxAttempts, calculateDelay, onMaxAttemptsReached, onRetry, silent]
  );

  return {
    execute,
    state,
    cancel,
    reset,
  };
}

/**
 * Hook simplificado para retry silencioso
 */
export function useSilentRetry<T>(maxAttempts = 3) {
  return useRetry<T>({
    maxAttempts,
    silent: true,
    baseDelay: 1000,
  });
}

