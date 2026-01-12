/**
 * =============================================================================
 * HOOK DE AUTENTICACIÓN
 * =============================================================================
 */

import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { useToast } from '@/stores/uiStore';
import { AppError, AuthenticationError } from '@/lib/errors';

interface UseAuthReturn {
  // State
  isLoading: boolean;
  error: AppError | null;
  
  // Actions
  signInWithEmail: (email: string) => Promise<boolean>;
  signInWithPhone: (phone: string) => Promise<boolean>;
  verifyOtp: (token: string, type: 'email' | 'phone', contact: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

export function useAuth(): UseAuthReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const navigate = useNavigate();
  const { logout } = useAuthStore();
  const toast = useToast();

  const clearError = useCallback(() => setError(null), []);

  /**
   * Enviar magic link por email
   */
  const signInWithEmail = useCallback(async (email: string): Promise<boolean> => {
    setIsLoading(true);
    setError(null);

    try {
      const { error: authError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (authError) {
        throw new AuthenticationError(authError.message);
      }

      toast.success('Email enviado', 'Revisá tu casilla de correo');
      return true;
    } catch (err) {
      const appError = err instanceof AppError 
        ? err 
        : new AuthenticationError('No se pudo enviar el email');
      setError(appError);
      toast.error(appError.userTitle, appError.userMessage);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  /**
   * Enviar OTP por SMS
   */
  const signInWithPhone = useCallback(async (phone: string): Promise<boolean> => {
    setIsLoading(true);
    setError(null);

    try {
      // Formatear número con código de país
      const formattedPhone = phone.startsWith('+') ? phone : `+54${phone}`;

      const { error: authError } = await supabase.auth.signInWithOtp({
        phone: formattedPhone,
      });

      if (authError) {
        throw new AuthenticationError(authError.message);
      }

      toast.success('Código enviado', 'Revisá los SMS de tu teléfono');
      return true;
    } catch (err) {
      const appError = err instanceof AppError 
        ? err 
        : new AuthenticationError('No se pudo enviar el SMS');
      setError(appError);
      toast.error(appError.userTitle, appError.userMessage);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  /**
   * Verificar código OTP
   */
  const verifyOtp = useCallback(async (
    token: string,
    type: 'email' | 'phone',
    contact: string
  ): Promise<boolean> => {
    setIsLoading(true);
    setError(null);

    try {
      const verifyOptions = type === 'email'
        ? { email: contact, token, type: 'email' as const }
        : { phone: contact.startsWith('+') ? contact : `+54${contact}`, token, type: 'sms' as const };

      const { error: authError } = await supabase.auth.verifyOtp(verifyOptions);

      if (authError) {
        throw new AuthenticationError(
          authError.message.includes('expired')
            ? 'El código expiró. Solicitá uno nuevo.'
            : 'Código incorrecto. Verificá e intentá de nuevo.'
        );
      }

      toast.success('¡Bienvenido!', 'Sesión iniciada correctamente');
      navigate('/dashboard');
      return true;
    } catch (err) {
      const appError = err instanceof AppError 
        ? err 
        : new AuthenticationError('No se pudo verificar el código');
      setError(appError);
      toast.error(appError.userTitle, appError.userMessage);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [navigate, toast]);

  /**
   * Cerrar sesión
   */
  const signOut = useCallback(async (): Promise<void> => {
    setIsLoading(true);

    try {
      await supabase.auth.signOut();
      logout();
      navigate('/login');
      toast.info('Sesión cerrada', 'Hasta pronto');
    } catch (err) {
      console.error('Sign out error:', err);
      // Forzar logout local aunque falle el servidor
      logout();
      navigate('/login');
    } finally {
      setIsLoading(false);
    }
  }, [logout, navigate, toast]);

  return {
    isLoading,
    error,
    signInWithEmail,
    signInWithPhone,
    verifyOtp,
    signOut,
    clearError,
  };
}

