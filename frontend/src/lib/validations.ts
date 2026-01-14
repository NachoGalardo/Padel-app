/**
 * =============================================================================
 * VALIDACIONES CON ZOD
 * =============================================================================
 * 
 * Schemas de validación para formularios de autenticación y perfil.
 * Mensajes en español, claros y accionables.
 */

import { z } from 'zod';

// =============================================================================
// HELPERS
// =============================================================================

/** Regex para teléfono argentino */
const phoneRegex = /^(\+54)?[0-9]{10,11}$/;

/** Normalizar teléfono (remover espacios, guiones) */
export function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-()]/g, '');
}

// =============================================================================
// AUTH SCHEMAS
// =============================================================================

export const loginSchema = z.object({
  email: z
    .string()
    .min(1, 'El email es requerido')
    .email('Ingresá un email válido'),
});

export const phoneLoginSchema = z.object({
  phone: z
    .string()
    .min(1, 'El teléfono es requerido')
    .transform(normalizePhone)
    .refine((val) => phoneRegex.test(val), {
      message: 'Ingresá un número de teléfono válido (ej: 1155667788)',
    }),
});

export const otpSchema = z.object({
  otp: z
    .string()
    .length(6, 'El código debe tener 6 dígitos')
    .regex(/^[0-9]+$/, 'El código solo puede contener números'),
});

// =============================================================================
// PROFILE SCHEMAS
// =============================================================================

export const profileSchema = z.object({
  name: z
    .string()
    .min(2, 'El nombre debe tener al menos 2 caracteres')
    .max(100, 'El nombre no puede tener más de 100 caracteres')
    .regex(/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/, 'El nombre solo puede contener letras'),

  email: z
    .string()
    .email('Ingresá un email válido')
    .optional()
    .or(z.literal('')),

  phone: z
    .string()
    .optional()
    .transform((val) => val ? normalizePhone(val) : val)
    .refine((val) => !val || phoneRegex.test(val), {
      message: 'Ingresá un número de teléfono válido',
    }),

  gender: z.enum(['male', 'female'], {
    required_error: 'Seleccioná tu género',
    invalid_type_error: 'Género inválido',
  }),

  birth_date: z
    .string()
    .optional()
    .refine((val) => {
      if (!val) return true;
      const date = new Date(val);
      const now = new Date();
      const age = now.getFullYear() - date.getFullYear();
      return age >= 12 && age <= 100;
    }, {
      message: 'La fecha de nacimiento no es válida',
    }),
});

/** Schema para completar perfil (campos mínimos requeridos) */
export const completeProfileSchema = z.object({
  name: z
    .string()
    .min(2, 'El nombre debe tener al menos 2 caracteres')
    .max(100, 'El nombre no puede tener más de 100 caracteres'),

  gender: z.enum(['male', 'female'], {
    required_error: 'Seleccioná tu género para poder inscribirte a torneos',
  }),
});

/** Schema para editar perfil (todos opcionales excepto name) */
export const editProfileSchema = profileSchema.partial().extend({
  name: profileSchema.shape.name,
});

// =============================================================================
// TOURNAMENT SCHEMAS
// =============================================================================

export const tournamentSchema = z.object({
  name: z
    .string()
    .min(3, 'El nombre debe tener al menos 3 caracteres')
    .max(100, 'El nombre no puede tener más de 100 caracteres'),

  start_date: z.string().refine((val) => {
    const date = new Date(val);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date >= today;
  }, 'La fecha de inicio no puede ser en el pasado'),

  end_date: z.string().optional(),

  gender: z.enum(['male', 'female', 'mixed'], {
    required_error: 'Seleccioná el género del torneo',
  }),

  format: z.enum(['single_elimination', 'round_robin'], {
    required_error: 'Seleccioná el formato',
  }),

  max_teams: z.coerce
    .number()
    .min(4, 'Mínimo 4 equipos')
    .max(256, 'Máximo 256 equipos'),

  entry_fee_cents: z.coerce
    .number()
    .min(0, 'El precio no puede ser negativo'),

  currency: z.string().default('ARS'),
}).refine((data) => {
  if (!data.end_date) return true;
  return new Date(data.end_date) >= new Date(data.start_date);
}, {
  message: 'La fecha de fin debe ser posterior a la de inicio',
  path: ['end_date'],
});

// =============================================================================
// TYPES
// =============================================================================

export type LoginInput = z.infer<typeof loginSchema>;
export type PhoneLoginInput = z.infer<typeof phoneLoginSchema>;
export type OtpInput = z.infer<typeof otpSchema>;
export type ProfileInput = z.infer<typeof profileSchema>;
export type CompleteProfileInput = z.infer<typeof completeProfileSchema>;
export type EditProfileInput = z.infer<typeof editProfileSchema>;
export type TournamentInput = z.infer<typeof tournamentSchema>;

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: Record<string, string>;
}

/** Validar datos con schema y retornar errores formateados */
export function validate<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): ValidationResult<T> {
  const result = schema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors: Record<string, string> = {};
  for (const error of result.error.errors) {
    const path = error.path.join('.');
    if (!errors[path]) {
      errors[path] = error.message;
    }
  }

  return { success: false, errors };
}

/** Hook-friendly validation */
export function useValidation<T>(schema: z.ZodSchema<T>) {
  return {
    validate: (data: unknown) => validate(schema, data),
    validateField: (field: string, value: unknown) => {
      const result = schema.safeParse({ [field]: value });
      if (result.success) return null;
      const fieldError = result.error.errors.find(
        (e) => e.path[0] === field
      );
      return fieldError?.message ?? null;
    },
  };
}

