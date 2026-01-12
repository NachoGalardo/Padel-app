/**
 * =============================================================================
 * PÁGINA DE CALLBACK DE AUTENTICACIÓN
 * =============================================================================
 * 
 * Maneja el callback de magic links y OAuth.
 * Procesa el token y redirige según el estado del perfil.
 */

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Spinner } from '@/components/ui/LoadingStates';

type CallbackStatus = 'processing' | 'success' | 'error';

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<CallbackStatus>('processing');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    async function handleCallback() {
      try {
        // Supabase maneja el hash fragment automáticamente
        const { data: { session }, error } = await supabase.auth.getSession();

        if (error) {
          throw error;
        }

        if (!session) {
          // Puede que el token esté en el hash, intentar extraerlo
          const hashParams = new URLSearchParams(window.location.hash.substring(1));
          const accessToken = hashParams.get('access_token');
          const refreshToken = hashParams.get('refresh_token');

          if (accessToken && refreshToken) {
            const { error: setError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });

            if (setError) {
              throw setError;
            }
          } else {
            throw new Error('No se encontró una sesión válida');
          }
        }

        setStatus('success');

        // Verificar si el perfil está completo
        const { data: profile } = await supabase
          .from('profiles')
          .select('is_complete')
          .single();

        // Redirigir según estado del perfil
        setTimeout(() => {
          if (profile?.is_complete) {
            navigate('/dashboard', { replace: true });
          } else {
            navigate('/complete-profile', { replace: true });
          }
        }, 1000);

      } catch (error) {
        console.error('Auth callback error:', error);
        setStatus('error');
        setErrorMessage(
          error instanceof Error 
            ? error.message 
            : 'No se pudo completar la autenticación'
        );
      }
    }

    handleCallback();
  }, [navigate, searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-surface-950 via-surface-900 to-surface-950">
      <div className="text-center">
        {status === 'processing' && (
          <>
            <Spinner size="lg" className="mx-auto mb-4" />
            <h1 className="text-xl font-medium text-white mb-2">
              Verificando...
            </h1>
            <p className="text-surface-400">
              Estamos procesando tu inicio de sesión
            </p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
              <CheckIcon className="w-8 h-8 text-green-400" />
            </div>
            <h1 className="text-xl font-medium text-white mb-2">
              ¡Listo!
            </h1>
            <p className="text-surface-400">
              Redirigiendo...
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
              <XIcon className="w-8 h-8 text-red-400" />
            </div>
            <h1 className="text-xl font-medium text-white mb-2">
              Error de autenticación
            </h1>
            <p className="text-surface-400 mb-6">
              {errorMessage}
            </p>
            <a
              href="/login"
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-lg transition-colors"
            >
              Volver a intentar
            </a>
          </>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// ICONS
// =============================================================================

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

