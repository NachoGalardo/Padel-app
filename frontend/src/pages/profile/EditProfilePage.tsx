/**
 * =============================================================================
 * PÁGINA DE EDICIÓN DE PERFIL
 * =============================================================================
 * 
 * Permite al usuario editar todos sus datos de perfil.
 * Incluye validación en tiempo real y guardado optimista.
 */

import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProfile } from '@/hooks/useProfile';
import { validate, editProfileSchema, type EditProfileInput } from '@/lib/validations';
import { Button, LinkButton } from '@/components/ui/Button';
import { FormField, Input, Select, RadioGroup } from '@/components/ui/FormField';
import { Spinner } from '@/components/ui/LoadingStates';
import { useToast } from '@/stores/uiStore';

const GENDER_OPTIONS = [
  { value: 'male', label: 'Masculino' },
  { value: 'female', label: 'Femenino' },
];

export default function EditProfilePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { profile, updateProfile, isLoading, isUpdating, isComplete } = useProfile();

  // Form state
  const [formData, setFormData] = useState<EditProfileInput>({
    name: '',
    email: '',
    phone: '',
    gender: undefined,
    birth_date: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [hasChanges, setHasChanges] = useState(false);

  // Initialize form with profile data
  useEffect(() => {
    if (profile) {
      setFormData({
        name: profile.name ?? '',
        email: profile.email ?? '',
        phone: profile.phone ?? '',
        gender: profile.gender ?? undefined,
        birth_date: profile.birth_date ?? '',
      });
    }
  }, [profile]);

  // Track changes
  useEffect(() => {
    if (!profile) return;
    
    const changed = 
      formData.name !== (profile.name ?? '') ||
      formData.email !== (profile.email ?? '') ||
      formData.phone !== (profile.phone ?? '') ||
      formData.gender !== profile.gender ||
      formData.birth_date !== (profile.birth_date ?? '');
    
    setHasChanges(changed);
  }, [formData, profile]);

  const updateField = useCallback(<K extends keyof EditProfileInput>(
    field: K,
    value: EditProfileInput[K]
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Clear error when user types
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  }, [errors]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    // Only validate and send changed fields
    const validation = validate(editProfileSchema, formData);
    if (!validation.success) {
      setErrors(validation.errors ?? {});
      return;
    }

    updateProfile(validation.data!, {
      onSuccess: () => {
        setHasChanges(false);
      },
    });
  }, [formData, updateProfile]);

  const handleCancel = useCallback(() => {
    if (hasChanges) {
      const confirm = window.confirm('¿Descartar cambios sin guardar?');
      if (!confirm) return;
    }
    navigate(-1);
  }, [hasChanges, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-950">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-950 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={handleCancel}
            className="flex items-center gap-2 text-surface-400 hover:text-surface-200 transition-colors mb-4"
          >
            <ArrowLeftIcon className="w-5 h-5" />
            Volver
          </button>
          
          <h1 className="text-2xl font-bold text-white">
            Editar perfil
          </h1>
          <p className="text-surface-400 mt-1">
            Actualizá tu información personal
          </p>
        </div>

        {/* Incomplete profile warning */}
        {!isComplete && (
          <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl">
            <div className="flex gap-3">
              <WarningIcon className="w-5 h-5 text-amber-400 flex-shrink-0" />
              <div>
                <p className="text-sm text-amber-200 font-medium">
                  Tu perfil está incompleto
                </p>
                <p className="text-sm text-amber-300/80 mt-1">
                  Completá los campos obligatorios para poder inscribirte a torneos.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Form Card */}
        <div className="bg-surface-900/80 border border-surface-800 rounded-2xl overflow-hidden">
          {/* Avatar section */}
          <div className="p-6 border-b border-surface-800 bg-gradient-to-r from-primary-500/10 to-transparent">
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-full bg-surface-700 flex items-center justify-center overflow-hidden">
                {profile?.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt={profile.name ?? 'Avatar'}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-3xl font-bold text-surface-400">
                    {formData.name?.[0]?.toUpperCase() ?? '?'}
                  </span>
                )}
              </div>
              <div>
                <p className="text-lg font-medium text-white">
                  {formData.name || 'Sin nombre'}
                </p>
                <LinkButton variant="primary" onClick={() => toast.info('Próximamente', 'Podrás cambiar tu foto de perfil')}>
                  Cambiar foto
                </LinkButton>
              </div>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-6">
            {/* Name */}
            <FormField
              label="Nombre completo"
              error={errors.name}
              required
            >
              <Input
                type="text"
                value={formData.name}
                onChange={(e) => updateField('name', e.target.value)}
                placeholder="Tu nombre"
                error={!!errors.name}
              />
            </FormField>

            {/* Contact info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                label="Email"
                error={errors.email}
                hint="Para notificaciones"
              >
                <Input
                  type="email"
                  value={formData.email ?? ''}
                  onChange={(e) => updateField('email', e.target.value)}
                  placeholder="tu@email.com"
                  error={!!errors.email}
                />
              </FormField>

              <FormField
                label="Teléfono"
                error={errors.phone}
                hint="Para contacto de emergencia"
              >
                <div className="flex">
                  <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-surface-700 bg-surface-800 text-surface-400 text-sm">
                    +54
                  </span>
                  <Input
                    type="tel"
                    value={formData.phone ?? ''}
                    onChange={(e) => updateField('phone', e.target.value)}
                    placeholder="1155667788"
                    error={!!errors.phone}
                    className="rounded-l-none"
                  />
                </div>
              </FormField>
            </div>

            {/* Gender */}
            <FormField
              label="Género"
              error={errors.gender}
              required
              hint="Determina tu categoría en torneos"
            >
              <div className="grid grid-cols-2 gap-3">
                {GENDER_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => updateField('gender', option.value as 'male' | 'female')}
                    className={`p-3 rounded-lg border text-sm font-medium transition-all ${
                      formData.gender === option.value
                        ? 'border-primary-500 bg-primary-500/10 text-primary-400'
                        : 'border-surface-700 text-surface-300 hover:bg-surface-800'
                    } ${errors.gender ? 'border-red-500/50' : ''}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </FormField>

            {/* Birth date */}
            <FormField
              label="Fecha de nacimiento"
              error={errors.birth_date}
              hint="Opcional, para estadísticas por edad"
            >
              <Input
                type="date"
                value={formData.birth_date ?? ''}
                onChange={(e) => updateField('birth_date', e.target.value)}
                error={!!errors.birth_date}
                max={new Date().toISOString().split('T')[0]}
              />
            </FormField>

            {/* Actions */}
            <div className="flex gap-3 pt-4 border-t border-surface-800">
              <Button
                type="button"
                variant="secondary"
                onClick={handleCancel}
                className="flex-1"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                isLoading={isUpdating}
                disabled={!hasChanges}
                className="flex-1"
              >
                Guardar cambios
              </Button>
            </div>
          </form>
        </div>

        {/* Account info */}
        <div className="mt-6 p-4 bg-surface-800/50 rounded-xl border border-surface-700">
          <h3 className="text-sm font-medium text-surface-200 mb-3">
            Información de cuenta
          </h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-surface-400">Miembro desde</span>
              <span className="text-surface-200">
                {profile?.created_at 
                  ? new Date(profile.created_at).toLocaleDateString('es-AR', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })
                  : '-'
                }
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-surface-400">Última actualización</span>
              <span className="text-surface-200">
                {profile?.updated_at 
                  ? new Date(profile.updated_at).toLocaleDateString('es-AR', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })
                  : '-'
                }
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// ICONS
// =============================================================================

function ArrowLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
    </svg>
  );
}

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  );
}

