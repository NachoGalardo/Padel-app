/**
 * =============================================================================
 * PÁGINA DE COMPLETAR PERFIL
 * =============================================================================
 * 
 * Flujo obligatorio post-registro para completar datos mínimos.
 * Bloquea navegación hasta completar campos requeridos.
 */

import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProfile } from '@/hooks/useProfile';
import { validate, completeProfileSchema } from '@/lib/validations';
import { Button } from '@/components/ui/Button';
import { FormField, Input, RadioGroup } from '@/components/ui/FormField';
import { Spinner } from '@/components/ui/LoadingStates';

const GENDER_OPTIONS = [
  {
    value: 'male',
    label: 'Masculino',
    description: 'Participarás en torneos de categoría masculina',
  },
  {
    value: 'female',
    label: 'Femenino',
    description: 'Participarás en torneos de categoría femenina',
  },
];

export default function CompleteProfilePage() {
  const navigate = useNavigate();
  const { profile, updateProfile, isLoading, isUpdating, missingFields } = useProfile();

  const [name, setName] = useState(profile?.name ?? '');
  const [gender, setGender] = useState<string>(profile?.gender ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const validation = validate(completeProfileSchema, { name, gender });
    if (!validation.success) {
      setErrors(validation.errors ?? {});
      return;
    }

    updateProfile(
      { name, gender: gender as 'male' | 'female' },
      {
        onSuccess: () => {
          navigate('/dashboard', { replace: true });
        },
      }
    );
  }, [name, gender, updateProfile, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-950">
        <Spinner size="lg" />
      </div>
    );
  }

  // Si el perfil ya está completo, redirigir
  if (profile?.is_complete) {
    navigate('/dashboard', { replace: true });
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-surface-950 via-surface-900 to-surface-950">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-gradient-to-br from-primary-500/10 to-transparent rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-lg">
        {/* Progress indicator */}
        <div className="mb-6">
          <div className="flex items-center justify-between text-sm text-surface-400 mb-2">
            <span>Completando tu perfil</span>
            <span className="text-primary-400">Paso 1 de 1</span>
          </div>
          <div className="h-1 bg-surface-800 rounded-full overflow-hidden">
            <div className="h-full w-1/2 bg-gradient-to-r from-primary-500 to-primary-400 rounded-full" />
          </div>
        </div>

        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 shadow-lg shadow-amber-500/30 mb-4">
            <UserPlusIcon className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">
            ¡Ya casi está!
          </h1>
          <p className="text-surface-400">
            Necesitamos algunos datos para que puedas inscribirte a torneos
          </p>
        </div>

        {/* Missing fields notice */}
        {missingFields.length > 0 && (
          <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl">
            <div className="flex gap-3">
              <InfoIcon className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-amber-200 font-medium">
                  Completá estos campos para continuar:
                </p>
                <ul className="mt-1 text-sm text-amber-300/80">
                  {missingFields.includes('name') && <li>• Tu nombre completo</li>}
                  {missingFields.includes('gender') && <li>• Tu género (para categorías)</li>}
                  {missingFields.includes('contact') && <li>• Email o teléfono de contacto</li>}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Card */}
        <div className="bg-surface-900/80 backdrop-blur-xl border border-surface-800 rounded-2xl p-6 shadow-xl">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Name */}
            <FormField
              label="Nombre completo"
              error={errors.name}
              required
              hint="Así aparecerás en los torneos"
            >
              <Input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Juan Pérez"
                autoComplete="name"
                autoFocus
                error={!!errors.name}
              />
            </FormField>

            {/* Gender */}
            <FormField
              label="Género"
              error={errors.gender}
              required
            >
              <RadioGroup
                name="gender"
                value={gender}
                onChange={setGender}
                options={GENDER_OPTIONS}
                error={!!errors.gender}
              />
            </FormField>

            {/* Submit */}
            <Button
              type="submit"
              fullWidth
              isLoading={isUpdating}
              size="lg"
            >
              Completar perfil
            </Button>
          </form>
        </div>

        {/* Why we ask */}
        <div className="mt-6 p-4 bg-surface-800/50 rounded-xl border border-surface-700">
          <h3 className="text-sm font-medium text-surface-200 mb-2 flex items-center gap-2">
            <ShieldIcon className="w-4 h-4 text-primary-400" />
            ¿Por qué pedimos estos datos?
          </h3>
          <ul className="text-xs text-surface-400 space-y-1">
            <li>• <strong>Nombre:</strong> Para identificarte en torneos y rankings</li>
            <li>• <strong>Género:</strong> Para asignarte a la categoría correcta</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// ICONS
// =============================================================================

function UserPlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
    </svg>
  );
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  );
}

