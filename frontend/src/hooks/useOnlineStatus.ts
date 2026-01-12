import { useState, useEffect, useCallback } from 'react';

interface OnlineStatus {
  isOnline: boolean;
  wasOffline: boolean;
  lastOnline: Date | null;
  checkConnection: () => Promise<boolean>;
}

/**
 * Hook para detectar estado de conexión
 * 
 * Características:
 * - Detecta cambios de navigator.onLine
 * - Verifica conexión real con ping al servidor
 * - Trackea si estuvo offline (para mostrar "reconectado")
 */
export function useOnlineStatus(): OnlineStatus {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [wasOffline, setWasOffline] = useState(false);
  const [lastOnline, setLastOnline] = useState<Date | null>(
    navigator.onLine ? new Date() : null
  );

  // Verificar conexión real haciendo ping
  const checkConnection = useCallback(async (): Promise<boolean> => {
    try {
      // Intentar hacer un request pequeño
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch('/api/health', {
        method: 'HEAD',
        signal: controller.signal,
        cache: 'no-store',
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setLastOnline(new Date());
      // Si estaba offline, marcar para mostrar "reconectado"
      if (!isOnline) {
        setWasOffline(true);
        // Limpiar flag después de 5 segundos
        setTimeout(() => setWasOffline(false), 5000);
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Verificar estado inicial
    if (navigator.onLine) {
      checkConnection().then((connected) => {
        if (!connected) {
          setIsOnline(false);
        }
      });
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [isOnline, checkConnection]);

  return {
    isOnline,
    wasOffline,
    lastOnline,
    checkConnection,
  };
}

