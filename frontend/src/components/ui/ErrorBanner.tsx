import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { type AppError, isNetworkError, isAuthError } from '@/lib/errors';

interface ErrorBannerProps {
  error: AppError;
  onRetry?: () => void;
  onDismiss?: () => void;
  className?: string;
}

/**
 * Banner de error con mensaje humano y acciones
 * 
 * Características:
 * - Iconos según tipo de error
 * - Botón de retry si es retryable
 * - Countdown para rate limit
 * - Request ID para soporte
 */
export function ErrorBanner({ error, onRetry, onDismiss, className }: ErrorBannerProps): JSX.Element {
  const err = error as any;
  const [countdown, setCountdown] = useState<number | null>(null);

  // Countdown para rate limit
  useEffect(() => {
    if (err.code === 'RATE_LIMIT' && err.retryDelay) {
      const seconds = Math.ceil(err.retryDelay / 1000);
      setCountdown(seconds);

      const interval = setInterval(() => {
        setCountdown((prev) => {
          if (prev === null || prev <= 1) {
            clearInterval(interval);
            return null;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(interval);
    }

    return undefined;
  }, [err.code, err.retryDelay]);

  const getIcon = (): JSX.Element => {
    if (isNetworkError(err)) {
      return <WifiOffIcon className="w-5 h-5" />;
    }
    if (isAuthError(err)) {
      return <LockIcon className="w-5 h-5" />;
    }
    if (err.code === 'RATE_LIMIT') {
      return <ClockIcon className="w-5 h-5" />;
    }
    if (err.status >= 500) {
      return <ServerIcon className="w-5 h-5" />;
    }
    return <AlertIcon className="w-5 h-5" />;
  };

  const getColorClasses = (): string => {
    if (isNetworkError(err)) {
      return 'bg-yellow-500/10 border-yellow-500/50 text-yellow-200';
    }
    if (err.status >= 500) {
      return 'bg-red-500/10 border-red-500/50 text-red-200';
    }
    return 'bg-red-500/10 border-red-500/50 text-red-200';
  };

  const showRetry = err.retryable && onRetry && countdown === null;

  return (
    <div
      className={cn(
        'rounded-lg border p-4 animate-slide-down',
        getColorClasses(),
        className
      )}
      role="alert"
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="flex-shrink-0 mt-0.5">{getIcon()}</div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold">{err.userTitle}</h3>
          <p className="text-sm opacity-90 mt-1">{err.userMessage}</p>

          {/* Countdown */}
          {countdown !== null && (
            <p className="text-sm mt-2 opacity-75">
              Podés reintentar en {countdown} segundo{countdown !== 1 ? 's' : ''}
            </p>
          )}

          {/* Request ID */}
          {err.requestId && (
            <p className="text-xs mt-2 opacity-50 font-mono">
              ID: {err.requestId}
            </p>
          )}

          {/* Actions */}
          {(showRetry || err.suggestedAction) && (
            <div className="flex items-center gap-3 mt-3">
              {showRetry && (
                <button
                  onClick={onRetry}
                  className="text-sm font-medium underline underline-offset-2 hover:no-underline"
                >
                  {err.suggestedAction ?? 'Reintentar'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Dismiss button */}
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="flex-shrink-0 p-1 rounded hover:bg-white/10 transition-colors"
            aria-label="Cerrar"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Banner inline más compacto para formularios
 */
export function InlineErrorBanner({
  error,
  className,
}: {
  error: AppError;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-lg',
        'bg-red-500/10 border border-red-500/30 text-red-300 text-sm',
        className
      )}
      role="alert"
    >
      <AlertIcon className="w-4 h-4 flex-shrink-0" />
      <span>{error.userMessage}</span>
    </div>
  );
}

// Icons
function AlertIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
      />
    </svg>
  );
}

function WifiOffIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414"
      />
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
      />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function ServerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"
      />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

