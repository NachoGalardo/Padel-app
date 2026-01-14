/**
 * =============================================================================
 * HOOK DE PERFIL DE USUARIO
 * =============================================================================
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { useToast } from '@/stores/uiStore';
import { AppError, ValidationError } from '@/lib/errors';
import { validate, editProfileSchema, type EditProfileInput } from '@/lib/validations';

// =============================================================================
// TYPES
// =============================================================================

export interface Profile {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  gender: 'male' | 'female' | null;
  birth_date: string | null;
  avatar_url: string | null;
  is_complete: boolean;
  completion_missing: string[];
  created_at: string;
  updated_at: string;
}

// =============================================================================
// QUERIES
// =============================================================================

async function fetchProfile(userId: string): Promise<Profile> {
  const client = supabase as any;
  const { data, error } = await client
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) {
    throw new AppError({
      code: 'PROFILE_FETCH_ERROR',
      status: 500,
      userTitle: 'Error',
      userMessage: 'No se pudo cargar tu perfil',
      retryable: true,
    });
  }

  return data as Profile;
}

async function updateProfile(
  userId: string,
  updates: Partial<EditProfileInput>
): Promise<Profile> {
  // Validar datos
  const validation = validate(editProfileSchema, updates);
  if (!validation.success) {
    const firstError = Object.values(validation.errors ?? {})[0];
    throw new ValidationError(firstError ?? 'Datos inválidos', validation.errors);
  }

  const client = supabase as any;
  const { data, error } = await client
    .from('profiles')
    .update({
      ...validation.data,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)
    .select()
    .single();

  if (error) {
    throw new AppError({
      code: 'PROFILE_UPDATE_ERROR',
      status: 500,
      userTitle: 'Error al guardar',
      userMessage: 'No se pudieron guardar los cambios. Intentá de nuevo.',
      retryable: true,
    });
  }

  return data as Profile;
}

// =============================================================================
// HOOK
// =============================================================================

export function useProfile() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const toast = useToast();

  // Query para obtener perfil
  const {
    data: profile,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['profile', user?.id],
    queryFn: () => fetchProfile(user!.id),
    enabled: !!user?.id,
    staleTime: 1000 * 60 * 5, // 5 minutos
  });

  // Mutation para actualizar perfil
  const updateMutation = useMutation({
    mutationFn: (updates: Partial<EditProfileInput>) =>
      updateProfile(user!.id, updates),
    onSuccess: (updatedProfile) => {
      // Actualizar cache
      queryClient.setQueryData(['profile', user?.id], updatedProfile);
      toast.success('Perfil actualizado', 'Los cambios se guardaron correctamente');
    },
    onError: (err: AppError) => {
      toast.error(err.userTitle, err.userMessage);
    },
  });

  return {
    profile,
    isLoading,
    error: error as AppError | null,
    refetch,
    
    // Update
    updateProfile: updateMutation.mutate,
    isUpdating: updateMutation.isPending,
    updateError: updateMutation.error as AppError | null,
    
    // Computed
    isComplete: profile?.is_complete ?? false,
    missingFields: profile?.completion_missing ?? [],
  };
}

// =============================================================================
// HELPER: Check if profile blocks action
// =============================================================================

export function useProfileGate() {
  const { profile, isComplete, missingFields } = useProfile();
  const toast = useToast();

  /**
   * Verificar si el perfil permite realizar una acción
   * @returns true si puede continuar, false si está bloqueado
   */
  const checkProfileComplete = (action: string = 'realizar esta acción'): boolean => {
    if (isComplete) return true;

    const missingLabels: Record<string, string> = {
      name: 'nombre',
      gender: 'género',
      contact: 'teléfono o email',
    };

    const missing = missingFields
      .map((f) => missingLabels[f] ?? f)
      .join(', ');

    toast.warning(
      'Completá tu perfil',
      `Para ${action}, necesitás completar: ${missing}`
    );

    return false;
  };

  return {
    profile,
    isComplete,
    missingFields,
    checkProfileComplete,
  };
}

