/**
 * =============================================================================
 * SISTEMA DE ERRORES TIPADOS
 * =============================================================================
 * 
 * Jerarquía de errores con mensajes humanos y códigos machine-readable.
 * Cada error sabe cómo presentarse al usuario.
 */

// =============================================================================
// ERROR BASE
// =============================================================================

export interface ErrorMetadata {
  /** Código machine-readable para tracking */
  code: string;
  /** HTTP status code */
  status: number;
  /** Mensaje técnico (para logs) */
  technicalMessage?: string;
  /** Mensaje humano (para UI) */
  userMessage: string;
  /** Título del banner */
  userTitle: string;
  /** ¿Se puede reintentar? */
  retryable: boolean;
  /** Delay sugerido para retry (ms) */
  retryDelay?: number;
  /** Acción sugerida para el usuario */
  suggestedAction?: string;
  /** Request ID para soporte */
  requestId?: string;
  /** Contexto adicional */
  context?: Record<string, unknown>;
}

export class AppError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly userMessage: string;
  public readonly userTitle: string;
  public readonly retryable: boolean;
  public readonly retryDelay: number;
  public readonly suggestedAction?: string;
  public readonly requestId?: string;
  public readonly context?: Record<string, unknown>;
  public readonly timestamp: Date;

  constructor(metadata: ErrorMetadata) {
    super(metadata.technicalMessage ?? metadata.userMessage);
    this.name = 'AppError';
    this.code = metadata.code;
    this.status = metadata.status;
    this.userMessage = metadata.userMessage;
    this.userTitle = metadata.userTitle;
    this.retryable = metadata.retryable;
    this.retryDelay = metadata.retryDelay ?? 1000;
    this.suggestedAction = metadata.suggestedAction;
    this.requestId = metadata.requestId;
    this.context = metadata.context;
    this.timestamp = new Date();

    // Mantener stack trace correcto
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  /** Crear desde response de API */
  static fromApiResponse(response: {
    error?: {
      code?: string;
      message?: string;
      requestId?: string;
    };
    status?: number;
  }): AppError {
    const code = response.error?.code ?? 'UNKNOWN_ERROR';
    const message = response.error?.message ?? 'Ocurrió un error inesperado';
    const status = response.status ?? 500;

    return errorFromCode(code, {
      technicalMessage: message,
      requestId: response.error?.requestId,
    });
  }

  /** Crear desde error de red */
  static fromNetworkError(error: Error): AppError {
    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      return new NetworkError();
    }
    if (error.message.includes('timeout') || error.message.includes('Timeout')) {
      return new TimeoutError();
    }
    return new AppError({
      code: 'UNKNOWN_ERROR',
      status: 0,
      userTitle: 'Error',
      userMessage: 'Ocurrió un error inesperado. Por favor, intentá de nuevo.',
      retryable: true,
      technicalMessage: error.message,
    });
  }

  /** Serializar para logs */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      status: this.status,
      message: this.message,
      userMessage: this.userMessage,
      retryable: this.retryable,
      requestId: this.requestId,
      context: this.context,
      timestamp: this.timestamp.toISOString(),
    };
  }
}

// =============================================================================
// ERRORES ESPECÍFICOS
// =============================================================================

/** Error de autenticación */
export class AuthenticationError extends AppError {
  constructor(message?: string) {
    super({
      code: 'AUTHENTICATION_ERROR',
      status: 401,
      userTitle: 'Sesión expirada',
      userMessage: message ?? 'Tu sesión expiró. Por favor, iniciá sesión nuevamente.',
      suggestedAction: 'Iniciar sesión',
      retryable: false,
    });
    this.name = 'AuthenticationError';
  }
}

/** Error de autorización */
export class AuthorizationError extends AppError {
  constructor(message?: string) {
    super({
      code: 'AUTHORIZATION_ERROR',
      status: 403,
      userTitle: 'Sin permisos',
      userMessage: message ?? 'No tenés permisos para realizar esta acción.',
      retryable: false,
    });
    this.name = 'AuthorizationError';
  }
}

/** Recurso no encontrado */
export class NotFoundError extends AppError {
  constructor(resource: string = 'recurso') {
    super({
      code: 'NOT_FOUND',
      status: 404,
      userTitle: 'No encontrado',
      userMessage: `El ${resource} que buscás no existe o fue eliminado.`,
      retryable: false,
    });
    this.name = 'NotFoundError';
  }
}

/** Error de validación */
export class ValidationError extends AppError {
  public readonly fieldErrors: Record<string, string>;

  constructor(message: string, fieldErrors: Record<string, string> = {}) {
    super({
      code: 'VALIDATION_ERROR',
      status: 400,
      userTitle: 'Datos inválidos',
      userMessage: message,
      retryable: false,
      context: { fieldErrors },
    });
    this.name = 'ValidationError';
    this.fieldErrors = fieldErrors;
  }
}

/** Conflicto de estado */
export class ConflictError extends AppError {
  constructor(message: string) {
    super({
      code: 'CONFLICT',
      status: 409,
      userTitle: 'Conflicto',
      userMessage: message,
      retryable: false,
    });
    this.name = 'ConflictError';
  }
}

/** Rate limit excedido */
export class RateLimitError extends AppError {
  public readonly retryAfter: number;

  constructor(retryAfter: number = 60) {
    super({
      code: 'RATE_LIMIT',
      status: 429,
      userTitle: 'Demasiadas solicitudes',
      userMessage: `Realizaste demasiadas solicitudes. Esperá ${retryAfter} segundos.`,
      retryable: true,
      retryDelay: retryAfter * 1000,
    });
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

/** Error de red */
export class NetworkError extends AppError {
  constructor() {
    super({
      code: 'NETWORK_ERROR',
      status: 0,
      userTitle: 'Sin conexión',
      userMessage: 'No hay conexión a internet. Verificá tu conexión y reintentá.',
      suggestedAction: 'Reintentar',
      retryable: true,
      retryDelay: 3000,
    });
    this.name = 'NetworkError';
  }
}

/** Timeout */
export class TimeoutError extends AppError {
  constructor() {
    super({
      code: 'TIMEOUT',
      status: 408,
      userTitle: 'Tiempo agotado',
      userMessage: 'La solicitud tardó demasiado. Por favor, intentá de nuevo.',
      suggestedAction: 'Reintentar',
      retryable: true,
      retryDelay: 2000,
    });
    this.name = 'TimeoutError';
  }
}

/** Error del servidor */
export class ServerError extends AppError {
  constructor(requestId?: string) {
    super({
      code: 'SERVER_ERROR',
      status: 500,
      userTitle: 'Error del servidor',
      userMessage: 'Algo salió mal de nuestro lado. Estamos trabajando para solucionarlo.',
      suggestedAction: 'Reintentar',
      retryable: true,
      retryDelay: 5000,
      requestId,
    });
    this.name = 'ServerError';
  }
}

/** Mantenimiento */
export class MaintenanceError extends AppError {
  constructor() {
    super({
      code: 'MAINTENANCE',
      status: 503,
      userTitle: 'En mantenimiento',
      userMessage: 'Estamos realizando mejoras. Volvé en unos minutos.',
      retryable: true,
      retryDelay: 60000,
    });
    this.name = 'MaintenanceError';
  }
}

// =============================================================================
// FACTORY DESDE CÓDIGO
// =============================================================================

export function errorFromCode(
  code: string,
  options: {
    technicalMessage?: string;
    requestId?: string;
    retryAfter?: number;
  } = {}
): AppError {
  switch (code) {
    case 'UNAUTHORIZED':
    case 'AUTHENTICATION_ERROR':
      return new AuthenticationError(options.technicalMessage);

    case 'FORBIDDEN':
    case 'AUTHORIZATION_ERROR':
      return new AuthorizationError(options.technicalMessage);

    case 'NOT_FOUND':
      return new NotFoundError();

    case 'VALIDATION_ERROR':
      return new ValidationError(options.technicalMessage ?? 'Datos inválidos');

    case 'CONFLICT':
      return new ConflictError(options.technicalMessage ?? 'Conflicto de estado');

    case 'RATE_LIMIT':
      return new RateLimitError(options.retryAfter);

    case 'NETWORK_ERROR':
      return new NetworkError();

    case 'TIMEOUT':
      return new TimeoutError();

    case 'MAINTENANCE':
      return new MaintenanceError();

    case 'SERVER_ERROR':
    case 'INTERNAL_ERROR':
    default:
      return new ServerError(options.requestId);
  }
}

// =============================================================================
// TYPE GUARDS
// =============================================================================

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof NetworkError;
}

export function isAuthError(error: unknown): error is AuthenticationError | AuthorizationError {
  return error instanceof AuthenticationError || error instanceof AuthorizationError;
}

export function isRetryableError(error: unknown): boolean {
  if (isAppError(error)) {
    return error.retryable;
  }
  return false;
}

