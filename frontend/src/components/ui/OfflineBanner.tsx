import { cn } from '@/lib/utils';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

/**
 * Banner global que aparece cuando no hay conexión
 * 
 * Características:
 * - Se muestra automáticamente cuando está offline
 * - Muestra "reconectado" brevemente al volver online
 * - Sticky en la parte superior
 */
export function OfflineBanner() {
  const { isOnline, wasOffline } = useOnlineStatus();

  // No mostrar nada si está online y no estuvo offline recientemente
  if (isOnline && !wasOffline) {
    return null;
  }

  return (
    <div
      className={cn(
        'fixed top-0 left-0 right-0 z-50',
        'px-4 py-2 text-center text-sm font-medium',
        'transition-all duration-300 animate-slide-down',
        isOnline
          ? 'bg-green-600 text-white'
          : 'bg-yellow-600 text-yellow-50'
      )}
      role="alert"
    >
      {isOnline ? (
        <span className="flex items-center justify-center gap-2">
          <CheckIcon className="w-4 h-4" />
          Conexión restablecida
        </span>
      ) : (
        <span className="flex items-center justify-center gap-2">
          <WifiOffIcon className="w-4 h-4" />
          Sin conexión a internet
        </span>
      )}
    </div>
  );
}

/**
 * Indicador compacto de estado de conexión
 */
export function ConnectionIndicator() {
  const { isOnline } = useOnlineStatus();

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 text-xs',
        isOnline ? 'text-green-400' : 'text-yellow-400'
      )}
    >
      <span
        className={cn(
          'w-2 h-2 rounded-full',
          isOnline ? 'bg-green-400' : 'bg-yellow-400 animate-pulse'
        )}
      />
      {isOnline ? 'Conectado' : 'Sin conexión'}
    </div>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
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

