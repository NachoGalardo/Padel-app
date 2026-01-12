import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { BrowserRouter } from 'react-router-dom';
import { useEffect } from 'react';
import * as Sentry from '@sentry/react';
import { AppRoutes } from './routes';
import { AuthProvider } from './providers/AuthProvider';
import { TenantProvider } from './providers/TenantProvider';
import { ErrorBoundaryProvider } from './providers/ErrorBoundaryProvider';
import { Toaster } from './components/ui/Toaster';
import { OfflineBanner } from './components/ui/OfflineBanner';
import { LoadingOverlay } from './components/ui/LoadingStates';
import { useUIStore } from './stores/uiStore';
import { AppError, isAppError } from './lib/errors';
import { defaultQueryConfig } from './lib/api';

// Initialize Sentry
if (import.meta.env.PROD && import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration(),
    ],
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    environment: import.meta.env.MODE,
    beforeSend(event, hint) {
      // Enrich error with AppError metadata
      const error = hint.originalException;
      if (isAppError(error)) {
        event.tags = {
          ...event.tags,
          error_code: error.code,
          error_status: error.status.toString(),
        };
        event.extra = {
          ...event.extra,
          requestId: error.requestId,
          retryable: error.retryable,
        };
      }
      return event;
    },
  });
}

// Configure React Query with AppError support
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 30, // 30 minutes
      retry: defaultQueryConfig.retry,
      retryDelay: defaultQueryConfig.retryDelay,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: (failureCount, error) => {
        // Solo retry para errores retryables
        if (error instanceof AppError) {
          return error.retryable && failureCount < 2;
        }
        return false;
      },
    },
  },
});

export function App() {
  const globalLoading = useUIStore((state) => state.globalLoading);

  useEffect(() => {
    // Log app initialization
    console.log('[App] Initialized', {
      env: import.meta.env.MODE,
      version: import.meta.env.VITE_APP_VERSION ?? 'dev',
    });
  }, []);

  return (
    <ErrorBoundaryProvider
      onError={(error, errorInfo) => {
        console.error('[App] Error caught:', error, errorInfo);
      }}
    >
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <TenantProvider>
              {/* Global UI states */}
              <OfflineBanner />
              <LoadingOverlay visible={globalLoading} />
              
              {/* Main app */}
              <AppRoutes />
              
              {/* Toasts */}
              <Toaster />
            </TenantProvider>
          </AuthProvider>
        </BrowserRouter>
        {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
      </QueryClientProvider>
    </ErrorBoundaryProvider>
  );
}

