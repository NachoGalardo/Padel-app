/**
 * =============================================================================
 * PÁGINA DE LOGIN
 * =============================================================================
 * 
 * Login con magic link (email) o SMS (teléfono).
 * UX guiada con tabs y validación en tiempo real.
 */

import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { validate, loginSchema, phoneLoginSchema } from '@/lib/validations';
import { Button, LinkButton } from '@/components/ui/Button';
import { FormField, Input } from '@/components/ui/FormField';
import { cn } from '@/lib/utils';

type AuthMethod = 'email' | 'phone';

export default function LoginPage() {
  const navigate = useNavigate();
  const { signInWithEmail, signInWithPhone, isLoading } = useAuth();
  
  const [method, setMethod] = useState<AuthMethod>('email');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    if (method === 'email') {
      const validation = validate(loginSchema, { email });
      if (!validation.success) {
        setErrors(validation.errors ?? {});
        return;
      }
      
      const success = await signInWithEmail(email);
      if (success) {
        navigate('/auth/verify', { 
          state: { type: 'email', contact: email } 
        });
      }
    } else {
      const validation = validate(phoneLoginSchema, { phone });
      if (!validation.success) {
        setErrors(validation.errors ?? {});
        return;
      }
      
      const success = await signInWithPhone(validation.data!.phone);
      if (success) {
        navigate('/auth/verify', { 
          state: { type: 'phone', contact: validation.data!.phone } 
        });
      }
    }
  }, [method, email, phone, signInWithEmail, signInWithPhone, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-surface-950 via-surface-900 to-surface-950">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/2 -right-1/2 w-full h-full bg-gradient-to-bl from-primary-500/10 to-transparent rounded-full blur-3xl" />
        <div className="absolute -bottom-1/2 -left-1/2 w-full h-full bg-gradient-to-tr from-primary-600/5 to-transparent rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo & Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-600 shadow-lg shadow-primary-500/30 mb-4">
            <PadelIcon className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">
            Bienvenido a Padel App
          </h1>
          <p className="text-surface-400">
            Ingresá con tu email o teléfono
          </p>
        </div>

        {/* Card */}
        <div className="bg-surface-900/80 backdrop-blur-xl border border-surface-800 rounded-2xl p-6 shadow-xl">
          {/* Method Tabs */}
          <div className="flex bg-surface-800 rounded-lg p-1 mb-6">
            <TabButton
              active={method === 'email'}
              onClick={() => setMethod('email')}
            >
              <MailIcon className="w-4 h-4" />
              Email
            </TabButton>
            <TabButton
              active={method === 'phone'}
              onClick={() => setMethod('phone')}
            >
              <PhoneIcon className="w-4 h-4" />
              Teléfono
            </TabButton>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {method === 'email' ? (
              <FormField
                label="Email"
                error={errors.email}
                hint="Te enviaremos un link mágico para iniciar sesión"
              >
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@email.com"
                  autoComplete="email"
                  autoFocus
                  error={!!errors.email}
                />
              </FormField>
            ) : (
              <FormField
                label="Teléfono"
                error={errors.phone}
                hint="Te enviaremos un código por SMS"
              >
                <div className="flex">
                  <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-surface-700 bg-surface-800 text-surface-400 text-sm">
                    +54
                  </span>
                  <Input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="1155667788"
                    autoComplete="tel"
                    autoFocus
                    error={!!errors.phone}
                    className="rounded-l-none"
                  />
                </div>
              </FormField>
            )}

            <Button
              type="submit"
              fullWidth
              isLoading={isLoading}
              size="lg"
            >
              {method === 'email' ? 'Enviar link' : 'Enviar código'}
            </Button>
          </form>

          {/* Help text */}
          <div className="mt-6 pt-6 border-t border-surface-800">
            <p className="text-sm text-surface-400 text-center">
              ¿Primera vez?{' '}
              <LinkButton onClick={() => {}}>
                Se creará tu cuenta automáticamente
              </LinkButton>
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="mt-8 text-center text-xs text-surface-500">
          Al continuar, aceptás nuestros{' '}
          <a href="/terms" className="text-primary-400 hover:underline">
            Términos de servicio
          </a>{' '}
          y{' '}
          <a href="/privacy" className="text-primary-400 hover:underline">
            Política de privacidad
          </a>
        </p>
      </div>
    </div>
  );
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function TabButton({ active, onClick, children }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-md text-sm font-medium transition-all',
        active
          ? 'bg-surface-700 text-white shadow-sm'
          : 'text-surface-400 hover:text-surface-200'
      )}
    >
      {children}
    </button>
  );
}

// =============================================================================
// ICONS
// =============================================================================

function PadelIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2v20M2 12h20" strokeLinecap="round" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

function MailIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  );
}

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
    </svg>
  );
}
