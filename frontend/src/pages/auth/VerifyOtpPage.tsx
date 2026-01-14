/**
 * =============================================================================
 * PÁGINA DE VERIFICACIÓN OTP
 * =============================================================================
 * 
 * Verificación de código enviado por email o SMS.
 * Incluye reenvío y cuenta regresiva.
 */

import { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { validate, otpSchema } from '@/lib/validations';
import { Button, LinkButton } from '@/components/ui/Button';
import { FormField, OtpInput } from '@/components/ui/FormField';

const RESEND_COOLDOWN = 60; // segundos

interface LocationState {
  type: 'email' | 'phone';
  contact: string;
}

export default function VerifyOtpPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { verifyOtp, signInWithEmail, signInWithPhone, isLoading } = useAuth();

  const state = location.state as LocationState | null;
  
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(RESEND_COOLDOWN);
  const [isResending, setIsResending] = useState(false);

  // Redirect si no hay state
  if (!state?.type || !state?.contact) {
    return <Navigate to="/login" replace />;
  }

  // Cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    
    const timer = setInterval(() => {
      setResendCooldown((prev) => prev - 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Auto-submit cuando se completa el código
  useEffect(() => {
    if (otp.length === 6) {
      handleVerify();
    }
  }, [otp]);

  const handleVerify = useCallback(async () => {
    setError('');

    const validation = validate(otpSchema, { otp });
    if (!validation.success) {
      setError(validation.errors?.otp ?? 'Código inválido');
      return;
    }

    const success = await verifyOtp(otp, state.type, state.contact);
    if (!success) {
      setOtp(''); // Limpiar para reintentar
    }
  }, [otp, state, verifyOtp]);

  const handleResend = useCallback(async () => {
    setIsResending(true);
    setError('');

    const success = state.type === 'email'
      ? await signInWithEmail(state.contact)
      : await signInWithPhone(state.contact);

    if (success) {
      setResendCooldown(RESEND_COOLDOWN);
    }

    setIsResending(false);
  }, [state, signInWithEmail, signInWithPhone]);

  const handleChangeMethod = () => {
    navigate('/login');
  };

  const maskedContact = state.type === 'email'
    ? maskEmail(state.contact)
    : maskPhone(state.contact);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-surface-950 via-surface-900 to-surface-950">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/2 -right-1/2 w-full h-full bg-gradient-to-bl from-primary-500/10 to-transparent rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-600 shadow-lg shadow-primary-500/30 mb-4">
            {state.type === 'email' ? (
              <MailCheckIcon className="w-8 h-8 text-white" />
            ) : (
              <MessageIcon className="w-8 h-8 text-white" />
            )}
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">
            Verificá tu {state.type === 'email' ? 'email' : 'teléfono'}
          </h1>
          <p className="text-surface-400">
            {state.type === 'email' ? (
              <>Ingresá el código del link que enviamos a <strong className="text-surface-200">{maskedContact}</strong></>
            ) : (
              <>Ingresá el código de 6 dígitos que enviamos a <strong className="text-surface-200">{maskedContact}</strong></>
            )}
          </p>
        </div>

        {/* Card */}
        <div className="bg-surface-900/80 backdrop-blur-xl border border-surface-800 rounded-2xl p-6 shadow-xl">
          <form onSubmit={(e) => { e.preventDefault(); handleVerify(); }} className="space-y-6">
            <FormField
              label="Código de verificación"
              error={error}
            >
              <OtpInput
                value={otp}
                onChange={setOtp}
                error={!!error}
                disabled={isLoading}
              />
            </FormField>

            <Button
              type="submit"
              fullWidth
              isLoading={isLoading}
              size="lg"
              disabled={otp.length !== 6}
            >
              Verificar
            </Button>
          </form>

          {/* Resend */}
          <div className="mt-6 text-center">
            {resendCooldown > 0 ? (
              <p className="text-sm text-surface-400">
                Podés reenviar en{' '}
                <span className="font-mono text-surface-200">
                  {formatTime(resendCooldown)}
                </span>
              </p>
            ) : (
              <Button
                variant="ghost"
                onClick={handleResend}
                isLoading={isResending}
              >
                Reenviar código
              </Button>
            )}
          </div>

          {/* Change method */}
          <div className="mt-4 pt-4 border-t border-surface-800 text-center">
            <LinkButton variant="secondary" onClick={handleChangeMethod}>
              ← Usar otro método
            </LinkButton>
          </div>
        </div>

        {/* Tips */}
        <div className="mt-6 p-4 bg-surface-800/50 rounded-xl border border-surface-700">
          <h3 className="text-sm font-medium text-surface-200 mb-2">
            ¿No recibiste el código?
          </h3>
          <ul className="text-xs text-surface-400 space-y-1">
            <li>• Revisá tu carpeta de spam</li>
            <li>• Verificá que el {state.type === 'email' ? 'email' : 'número'} sea correcto</li>
            <li>• Esperá unos segundos y reenviá</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// HELPERS
// =============================================================================

function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  if (local.length <= 3) return `${local.slice(0, 1)}***@${domain}`;
  return `${local.slice(0, 2)}***${local.slice(-1)}@${domain}`;
}

function maskPhone(phone: string): string {
  const clean = phone.replace(/\D/g, '');
  if (clean.length <= 4) return '****';
  return `***${clean.slice(-4)}`;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// =============================================================================
// ICONS
// =============================================================================

function MailCheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function MessageIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  );
}

