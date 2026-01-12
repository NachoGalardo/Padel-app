# Arquitectura de Edge Functions - SaaS Multi-Tenant de Torneos de Pádel

## Principios Rectores

1. **Zero Trust**: Toda función valida identidad, tenant y permisos
2. **Fail Fast**: Validaciones al inicio, operaciones de negocio al final
3. **Idempotencia**: Operaciones críticas son repetibles sin efectos colaterales
4. **Observabilidad**: Logs estructurados para debugging y analytics
5. **Resiliencia**: Timeouts, retries y circuit breakers

---

## Stack Tecnológico

- **Runtime**: Deno (Supabase Edge Functions / Deno Deploy)
- **Framework**: Hono.js (lightweight, TypeScript-first)
- **Validación**: Zod (schema validation)
- **DB**: PostgreSQL con Supabase client
- **Auth**: Supabase Auth (JWT)
- **Logs**: Structured JSON logs
- **Métricas**: Supabase Analytics / Axiom

---

## Arquitectura de Capas

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT REQUEST                          │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  CAPA 1: REQUEST MIDDLEWARE                                     │
├─────────────────────────────────────────────────────────────────┤
│  1. CORS Headers                                                │
│  2. Request ID generation                                       │
│  3. Rate Limiting (global)                                      │
│  4. Request logging (entrada)                                   │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  CAPA 2: AUTHENTICATION                                         │
├─────────────────────────────────────────────────────────────────┤
│  1. Extract JWT from Authorization header                       │
│  2. Verify JWT signature y expiración                           │
│  3. Extract profile_id                                          │
│  4. Enrich context con user info                                │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  CAPA 3: TENANT RESOLUTION                                      │
├─────────────────────────────────────────────────────────────────┤
│  1. Extract tenant from subdomain/header/body                   │
│  2. Verify tenant exists y está activo                          │
│  3. Enrich context con tenant info                              │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  CAPA 4: AUTHORIZATION                                          │
├─────────────────────────────────────────────────────────────────┤
│  1. Query tenant_users para obtener rol                         │
│  2. Verify status = 'active'                                    │
│  3. Check rol tiene permisos para esta operación                │
│  4. Enrich context con tenant_user_id y role                    │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  CAPA 5: RATE LIMITING (per tenant/user)                        │
├─────────────────────────────────────────────────────────────────┤
│  1. Check rate limit para tenant                                │
│  2. Check rate limit para user                                  │
│  3. Decrement quota disponible                                  │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  CAPA 6: INPUT VALIDATION                                       │
├─────────────────────────────────────────────────────────────────┤
│  1. Parse request body/params/query                             │
│  2. Validate con Zod schemas                                    │
│  3. Sanitize inputs                                             │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  CAPA 7: IDEMPOTENCY CHECK                                      │
├─────────────────────────────────────────────────────────────────┤
│  1. Extract Idempotency-Key header (si existe)                  │
│  2. Check si ya procesamos esta key                             │
│  3. Si existe: return cached response                           │
│  4. Si no: continuar y guardar resultado                        │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  CAPA 8: BUSINESS LOGIC (handler específico)                    │
├─────────────────────────────────────────────────────────────────┤
│  1. Set session variables en DB                                 │
│  2. Execute business logic                                      │
│  3. RLS aplica automáticamente                                  │
│  4. Return structured response                                  │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  CAPA 9: RESPONSE MIDDLEWARE                                    │
├─────────────────────────────────────────────────────────────────┤
│  1. Log response (salida)                                       │
│  2. Add response headers (request-id, etc.)                     │
│  3. Format success response                                     │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  CAPA 10: ERROR HANDLER                                         │
├─────────────────────────────────────────────────────────────────┤
│  1. Catch errors de cualquier capa                              │
│  2. Map a HTTP status codes                                     │
│  3. Log error con stack trace                                   │
│  4. Return user-friendly error                                  │
│  5. Notify Sentry/error tracking si es crítico                  │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
                             RESPONSE
```

---

## Estructura de Directorios

```
edge-functions/
├── _shared/                          # Código compartido
│   ├── middleware/
│   │   ├── auth.ts                   # JWT validation
│   │   ├── tenant.ts                 # Tenant resolution
│   │   ├── authorization.ts          # Role checking
│   │   ├── rate-limit.ts             # Rate limiting
│   │   ├── idempotency.ts            # Idempotency keys
│   │   ├── validation.ts             # Input validation
│   │   ├── error-handler.ts          # Error handling
│   │   └── logger.ts                 # Structured logging
│   ├── types/
│   │   ├── context.ts                # AppContext type
│   │   ├── errors.ts                 # Custom errors
│   │   ├── responses.ts              # Response types
│   │   └── database.ts               # DB types
│   ├── utils/
│   │   ├── database.ts               # DB helpers
│   │   ├── retry.ts                  # Retry logic
│   │   ├── timeout.ts                # Timeout wrapper
│   │   └── crypto.ts                 # Hashing, etc.
│   ├── schemas/                      # Zod schemas
│   │   ├── tournaments.ts
│   │   ├── matches.ts
│   │   ├── teams.ts
│   │   └── common.ts
│   └── constants.ts                  # Config y constantes
├── tournaments/
│   ├── create.ts                     # POST /tournaments
│   ├── update.ts                     # PATCH /tournaments/:id
│   ├── delete.ts                     # DELETE /tournaments/:id
│   ├── list.ts                       # GET /tournaments
│   └── get.ts                        # GET /tournaments/:id
├── matches/
│   ├── record-result.ts              # POST /matches/:id/result
│   ├── schedule.ts                   # POST /matches/:id/schedule
│   └── list.ts                       # GET /matches
├── entries/
│   ├── register.ts                   # POST /tournaments/:id/entries
│   ├── withdraw.ts                   # DELETE /entries/:id
│   └── confirm-payment.ts            # POST /entries/:id/confirm
├── admin/
│   ├── verify-chain.ts               # GET /admin/audit/verify
│   └── export-data.ts                # POST /admin/export
└── public/
    ├── tournaments.ts                # GET /public/tournaments (sin auth)
    └── brackets.ts                   # GET /public/brackets/:id
```

---

## Tipos Core

### AppContext

```typescript
interface AppContext {
  // Request metadata
  requestId: string;
  startTime: number;
  
  // Authentication
  profileId: string | null;
  
  // Authorization
  tenantId: string | null;
  tenantUserId: string | null;
  role: 'owner' | 'admin' | 'player' | null;
  
  // Tenant info
  tenant: {
    id: string;
    slug: string;
    plan: 'free' | 'starter' | 'pro' | 'enterprise';
    status: 'active' | 'suspended' | 'cancelled';
  } | null;
  
  // Client info
  clientIp: string;
  userAgent: string;
  
  // Database
  supabase: SupabaseClient;
  
  // Logging
  logger: Logger;
}
```

---

## Middleware Detallado

### 1. Authentication Middleware

```typescript
/**
 * Valida JWT y extrae profile_id
 * 
 * Headers requeridos:
 *   Authorization: Bearer <jwt>
 * 
 * Errores:
 *   401 - Missing token
 *   401 - Invalid token
 *   401 - Expired token
 * 
 * Enriquece context con:
 *   - profileId
 */
```

**Flujo**:
1. Extract `Authorization: Bearer <token>`
2. Verify JWT con `supabase.auth.getUser(token)`
3. Si válido: `ctx.profileId = user.id`
4. Si inválido: throw `UnauthorizedError`

**Casos especiales**:
- Funciones públicas pueden skip este middleware
- Refresh tokens se manejan por separado

---

### 2. Tenant Resolution Middleware

```typescript
/**
 * Identifica y valida el tenant del request
 * 
 * Fuentes (orden de prioridad):
 *   1. X-Tenant-ID header (para APIs)
 *   2. Subdomain (club-palermo.padel-saas.com)
 *   3. Body field (body.tenant_id para webhooks)
 * 
 * Errores:
 *   400 - Missing tenant identifier
 *   404 - Tenant not found
 *   403 - Tenant suspended/cancelled
 * 
 * Enriquece context con:
 *   - tenantId
 *   - tenant (objeto completo)
 */
```

**Flujo**:
1. Extract tenant identifier (header > subdomain > body)
2. Query `tenants` WHERE `slug = ? OR id = ?`
3. Verificar `status = 'active'`
4. Verificar `deleted_at IS NULL`
5. Cache tenant info (Redis/KV) por 5 minutos
6. Enriquecer context

**Validaciones**:
- Plan expirado → devolver warning header pero permitir lectura
- Tenant suspendido → 403 con razón
- Tenant cancelado → 410 Gone

---

### 3. Authorization Middleware

```typescript
/**
 * Valida que el usuario tiene permisos en el tenant
 * 
 * Queries:
 *   SELECT id, role, status FROM tenant_users
 *   WHERE tenant_id = ? AND profile_id = ?
 * 
 * Errores:
 *   403 - Not a member of this tenant
 *   403 - User suspended in tenant
 *   403 - Insufficient permissions
 * 
 * Enriquece context con:
 *   - tenantUserId
 *   - role
 */
```

**Flujo**:
1. Query `tenant_users` con `tenant_id` y `profile_id`
2. Verificar `status = 'active'`
3. Verificar rol cumple con requisito mínimo de la función
4. Cache membership (Redis/KV) por 2 minutos
5. Enriquecer context

**Configuración por función**:
```typescript
{
  minRole: 'admin',  // owner | admin | player
  allowSelf: true    // Player puede si es su propia data
}
```

---

### 4. Rate Limiting Middleware

```typescript
/**
 * Limita requests por tenant y por usuario
 * 
 * Límites por plan:
 *   free:       100 req/min/tenant,  20 req/min/user
 *   starter:    500 req/min/tenant,  50 req/min/user
 *   pro:       2000 req/min/tenant, 100 req/min/user
 *   enterprise: unlimited
 * 
 * Errores:
 *   429 - Rate limit exceeded
 * 
 * Headers en response:
 *   X-RateLimit-Limit: 100
 *   X-RateLimit-Remaining: 73
 *   X-RateLimit-Reset: 1704844800
 *   Retry-After: 42
 */
```

**Algoritmo**: Token Bucket o Sliding Window

**Storage**: Redis/Upstash KV con TTL

**Keys**:
- `ratelimit:tenant:{tenantId}:{window}` 
- `ratelimit:user:{profileId}:{window}`

**Bypass**: IP whitelist para health checks

---

### 5. Idempotency Middleware

```typescript
/**
 * Previene duplicación de operaciones críticas
 * 
 * Header requerido (opcional, solo para POST/PATCH/DELETE):
 *   Idempotency-Key: <uuid-v4>
 * 
 * Operaciones idempotentes:
 *   - Crear torneo
 *   - Inscribir pareja
 *   - Cargar resultado
 *   - Confirmar pago
 * 
 * TTL: 24 horas
 * 
 * Comportamiento:
 *   - Primera request: procesar y cachear response
 *   - Requests repetidas: devolver cached response (mismo status code)
 */
```

**Flujo**:
1. Extract `Idempotency-Key` header
2. Si no existe y operación es crítica → generar warning pero continuar
3. Check cache: `idempotency:{tenantId}:{key}`
4. Si existe: return cached response inmediatamente
5. Si no: continuar, y al final cachear response

**Storage**: Redis/KV

**Estructura cached**:
```typescript
{
  statusCode: 201,
  body: { ... },
  headers: { ... },
  timestamp: 1704844800,
  requestHash: "sha256..." // Para detectar request diferente con misma key
}
```

---

### 6. Input Validation Middleware

```typescript
/**
 * Valida y sanitiza inputs con Zod
 * 
 * Valida:
 *   - Request body
 *   - Query params
 *   - Path params
 *   - Headers específicos
 * 
 * Errores:
 *   400 - Validation error con detalles
 * 
 * Sanitización automática:
 *   - Trim strings
 *   - Lowercase emails
 *   - Remove null bytes
 *   - Max lengths
 */
```

**Ejemplo de uso**:
```typescript
const createTournamentSchema = z.object({
  name: z.string().min(3).max(150).trim(),
  gender: z.enum(['male', 'female', 'mixed']),
  start_date: z.string().date(),
  max_teams: z.number().int().min(4).max(256)
});

// En la función:
validate(createTournamentSchema, 'body');
```

---

### 7. Error Handler

```typescript
/**
 * Maneja todos los errores de forma unificada
 * 
 * Error types:
 *   - ValidationError (400)
 *   - UnauthorizedError (401)
 *   - ForbiddenError (403)
 *   - NotFoundError (404)
 *   - ConflictError (409)
 *   - RateLimitError (429)
 *   - InternalError (500)
 * 
 * Response format:
 *   {
 *     error: {
 *       code: "VALIDATION_ERROR",
 *       message: "Name must be at least 3 characters",
 *       details: { field: "name", ... },
 *       requestId: "req_123"
 *     }
 *   }
 */
```

**Clasificación de errores**:

| Error | Status | Log Level | Notify Sentry |
|-------|--------|-----------|---------------|
| ValidationError | 400 | info | ❌ |
| UnauthorizedError | 401 | warn | ❌ |
| ForbiddenError | 403 | warn | ❌ |
| NotFoundError | 404 | info | ❌ |
| ConflictError | 409 | info | ❌ |
| RateLimitError | 429 | warn | ❌ |
| DatabaseError | 500 | error | ✅ |
| TimeoutError | 504 | error | ✅ |
| UnknownError | 500 | error | ✅ |

---

### 8. Logger Middleware

```typescript
/**
 * Logging estructurado en JSON
 * 
 * Log levels:
 *   - debug: desarrollo local
 *   - info: operaciones normales
 *   - warn: errores recuperables
 *   - error: errores críticos
 * 
 * Logs automáticos:
 *   - Request entrada (método, path, tenant, user)
 *   - Response salida (status, duration)
 *   - Errores (stack trace sanitizado)
 *   - Slow queries (> 1s)
 * 
 * Formato:
 *   {
 *     level: "info",
 *     message: "Tournament created",
 *     timestamp: "2024-01-09T12:34:56.789Z",
 *     requestId: "req_123",
 *     tenantId: "tenant_abc",
 *     profileId: "user_xyz",
 *     duration: 234,
 *     context: { tournamentId: "..." }
 *   }
 */
```

---

## Timeout y Retry

### Timeout Strategy

```typescript
/**
 * Timeouts por tipo de operación:
 * 
 * - Lectura simple (GET): 5s
 * - Escritura simple (POST/PATCH): 10s
 * - Operaciones complejas (bracket generation): 25s
 * - Exports/Reports: 50s
 * 
 * Edge Function global timeout: 55s (Supabase limit)
 */
```

**Implementación**:
```typescript
const result = await withTimeout(
  performOperation(),
  10000, // 10 segundos
  'Operation timed out'
);
```

---

### Retry Strategy

```typescript
/**
 * Retry solo para operaciones idempotentes
 * 
 * Retry conditions:
 *   - DB connection errors
 *   - Temporary network errors
 *   - 503 Service Unavailable
 *   - Timeouts (en queries, no en toda la función)
 * 
 * NO retry:
 *   - 4xx errors (errores del cliente)
 *   - Validation errors
 *   - Authorization errors
 * 
 * Algoritmo: Exponential backoff
 *   - Intento 1: inmediato
 *   - Intento 2: 100ms + jitter
 *   - Intento 3: 400ms + jitter
 *   - Max intentos: 3
 */
```

**Implementación**:
```typescript
const result = await withRetry(
  () => supabase.from('tournaments').select('*'),
  {
    maxAttempts: 3,
    backoff: 'exponential',
    retryableErrors: [
      'ECONNREFUSED',
      'ETIMEDOUT',
      '503'
    ]
  }
);
```

---

## Session Variables en DB

**Crítico**: Antes de cada query, setear:

```typescript
async function setDbSession(ctx: AppContext) {
  await ctx.supabase.rpc('set_session_context', {
    profile_id: ctx.profileId,
    tenant_id: ctx.tenantId,
    client_ip: ctx.clientIp,
    user_agent: ctx.userAgent
  });
}
```

**Función en DB**:
```sql
CREATE OR REPLACE FUNCTION set_session_context(
  p_profile_id UUID,
  p_tenant_id UUID,
  p_client_ip TEXT,
  p_user_agent TEXT
)
RETURNS VOID AS $$
BEGIN
  PERFORM set_config('app.current_profile_id', p_profile_id::TEXT, TRUE);
  PERFORM set_config('app.current_tenant_id', p_tenant_id::TEXT, TRUE);
  PERFORM set_config('app.client_ip', p_client_ip, TRUE);
  PERFORM set_config('app.user_agent', p_user_agent, TRUE);
END;
$$ LANGUAGE plpgsql;
```

---

## Response Format

### Success Response

```typescript
{
  data: T,                    // Payload
  meta?: {                    // Metadata opcional
    page: 1,
    per_page: 20,
    total: 156,
    has_more: true
  }
}
```

### Error Response

```typescript
{
  error: {
    code: "FORBIDDEN",                        // Machine-readable
    message: "You don't have permission",     // Human-readable
    details?: { field: "role", ... },         // Contexto adicional
    requestId: "req_123"                      // Para soporte
  }
}
```

---

## Headers Standard

### Request Headers

```
Authorization: Bearer <jwt>           # Requerido (excepto public)
X-Tenant-ID: <uuid>                   # Opcional (si no hay subdomain)
Idempotency-Key: <uuid>               # Recomendado para POST/PATCH/DELETE
Content-Type: application/json
User-Agent: PadelApp/1.2.3 iOS/17.0
X-Request-ID: <uuid>                  # Opcional (generado si no existe)
```

### Response Headers

```
X-Request-ID: req_abc123              # Para tracking
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 73
X-RateLimit-Reset: 1704844800
X-Response-Time: 234                  # Milisegundos
X-Tenant-Status: active               # Estado del tenant
```

---

## Composición de Middlewares

```typescript
// Función pública (sin auth)
const publicTournamentsFunction = compose(
  corsMiddleware(),
  requestIdMiddleware(),
  rateLimitMiddleware({ global: true }),
  loggerMiddleware(),
  errorHandlerMiddleware(),
  // Business logic
  getTournamentsHandler
);

// Función protegida (requiere auth)
const createTournamentFunction = compose(
  corsMiddleware(),
  requestIdMiddleware(),
  rateLimitMiddleware({ global: true }),
  authMiddleware({ required: true }),
  tenantMiddleware({ required: true }),
  authorizationMiddleware({ minRole: 'admin' }),
  rateLimitMiddleware({ tenant: true, user: true }),
  validationMiddleware({ body: createTournamentSchema }),
  idempotencyMiddleware({ enabled: true }),
  loggerMiddleware(),
  errorHandlerMiddleware(),
  // Business logic
  createTournamentHandler
);

// Función con permisos especiales
const recordMatchResultFunction = compose(
  corsMiddleware(),
  requestIdMiddleware(),
  authMiddleware({ required: true }),
  tenantMiddleware({ required: true }),
  authorizationMiddleware({ 
    minRole: 'admin',
    customCheck: async (ctx) => {
      // Admin puede cargar cualquier resultado
      // Player solo puede cargar resultado de su propio partido
      if (ctx.role === 'player') {
        const match = await getMatch(ctx.params.matchId);
        return isPlayerInMatch(ctx.tenantUserId, match);
      }
      return true;
    }
  }),
  validationMiddleware({ body: matchResultSchema }),
  idempotencyMiddleware({ enabled: true }),
  loggerMiddleware(),
  errorHandlerMiddleware(),
  recordMatchResultHandler
);
```

---

## Configuración por Entorno

```typescript
// _shared/constants.ts

export const CONFIG = {
  development: {
    logLevel: 'debug',
    enableRetry: false,
    enableRateLimit: false,
    enableIdempotency: false,
    defaultTimeout: 30000
  },
  
  staging: {
    logLevel: 'info',
    enableRetry: true,
    enableRateLimit: true,
    enableIdempotency: true,
    defaultTimeout: 15000
  },
  
  production: {
    logLevel: 'info',
    enableRetry: true,
    enableRateLimit: true,
    enableIdempotency: true,
    defaultTimeout: 10000
  }
};
```

---

## Métricas y Observabilidad

### Métricas a trackear:

| Métrica | Descripción | Uso |
|---------|-------------|-----|
| `request.count` | Requests totales | Tráfico general |
| `request.duration` | Latencia p50, p95, p99 | Performance |
| `request.error_rate` | % de errores | Health |
| `ratelimit.exceeded` | Requests bloqueados | Abuse detection |
| `idempotency.hit_rate` | % de requests duplicados | Retry behavior |
| `db.query_duration` | Latencia de queries | DB performance |
| `auth.failure_rate` | % de auth fallidos | Security |

### Dashboards recomendados:

1. **Operations Dashboard**
   - Requests/min por tenant
   - Error rate por función
   - P95 latency por endpoint

2. **Security Dashboard**
   - Failed auth attempts
   - Rate limit violations
   - Suspicious activity (many tenants from same IP)

3. **Business Dashboard**
   - Torneos creados/día
   - Partidos finalizados/día
   - Inscripciones confirmadas

---

## Testing Strategy

### Unit Tests
- Cada middleware aislado
- Mock de Supabase client
- Validación de schemas

### Integration Tests
- Edge function completa
- DB real (Supabase local)
- Casos de error

### E2E Tests
- Flujos críticos
- Multi-tenant isolation
- Idempotency

### Load Tests
- Rate limiting efectivo
- Timeouts bajo carga
- Circuit breakers

---

## Checklist de Seguridad

- [ ] JWT validation en todas las funciones (excepto públicas)
- [ ] Tenant isolation verificado en tests
- [ ] Role authorization en operaciones críticas
- [ ] Input validation con schemas estrictos
- [ ] SQL injection imposible (Supabase client + RLS)
- [ ] XSS prevention (no HTML en responses)
- [ ] CSRF protection via JWT
- [ ] Rate limiting habilitado
- [ ] Audit logs en operaciones críticas
- [ ] Secrets en variables de entorno (nunca en código)
- [ ] CORS restrictivo en producción
- [ ] Error messages no exponen info sensible

---

## Próximos Pasos

1. ✅ Arquitectura definida (este documento)
2. ⏳ Implementar middleware core (_shared/)
3. ⏳ Implementar 2-3 funciones de ejemplo
4. ⏳ Setup testing infrastructure
5. ⏳ Deploy a staging
6. ⏳ Load testing
7. ⏳ Documentación de API (OpenAPI)
8. ⏳ Deploy a producción

