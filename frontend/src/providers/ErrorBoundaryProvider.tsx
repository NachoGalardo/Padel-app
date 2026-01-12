import { Component, type ReactNode } from 'react';
import * as Sentry from '@sentry/react';
import { AppError, isAuthError } from '@/lib/errors';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error Boundary global que captura errores de React
 * 
 * Características:
 * - Captura errores de renderizado
 * - Reporta a Sentry
 * - Muestra UI de fallback amigable
 * - Permite recovery
 */
export class ErrorBoundaryProvider extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log to console
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);

    // Report to Sentry
    Sentry.withScope((scope) => {
      scope.setExtras({
        componentStack: errorInfo.componentStack,
      });
      
      if (error instanceof AppError) {
        scope.setTag('error_code', error.code);
        scope.setTag('error_status', error.status.toString());
        scope.setExtra('requestId', error.requestId);
      }

      Sentry.captureException(error);
    });

    // Call custom handler
    this.props.onError?.(error, errorInfo);

    // If auth error, redirect to login
    if (isAuthError(error)) {
      window.location.href = '/login';
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <ErrorFallback
          error={this.state.error}
          onReset={this.handleReset}
        />
      );
    }

    return this.props.children;
  }
}

// =============================================================================
// FALLBACK UI
// =============================================================================

interface ErrorFallbackProps {
  error: Error | null;
  onReset: () => void;
}

function ErrorFallback({ error, onReset }: ErrorFallbackProps) {
  const isAppErr = error instanceof AppError;
  const title = isAppErr ? error.userTitle : 'Algo salió mal';
  const message = isAppErr
    ? error.userMessage
    : 'Ocurrió un error inesperado. Por favor, recargá la página.';
  const requestId = isAppErr ? error.requestId : undefined;

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-950 p-4">
      <div className="max-w-md w-full">
        <div className="card text-center">
          {/* Icon */}
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-500/20 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-red-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>

          {/* Title */}
          <h1 className="text-2xl font-display font-bold text-surface-100 mb-2">
            {title}
          </h1>

          {/* Message */}
          <p className="text-surface-400 mb-6">{message}</p>

          {/* Request ID */}
          {requestId && (
            <p className="text-xs text-surface-600 mb-6 font-mono">
              ID: {requestId}
            </p>
          )}

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button onClick={onReset} className="btn-primary">
              Intentar de nuevo
            </button>
            <button
              onClick={() => window.location.reload()}
              className="btn-secondary"
            >
              Recargar página
            </button>
          </div>

          {/* Support link */}
          <p className="text-xs text-surface-500 mt-6">
            Si el problema persiste,{' '}
            <a href="mailto:soporte@padel.com" className="text-primary-400 hover:underline">
              contactá a soporte
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// HOC FOR FUNCTIONAL COMPONENTS
// =============================================================================

export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  fallback?: ReactNode
) {
  return function WithErrorBoundary(props: P) {
    return (
      <ErrorBoundaryProvider fallback={fallback}>
        <Component {...props} />
      </ErrorBoundaryProvider>
    );
  };
}

