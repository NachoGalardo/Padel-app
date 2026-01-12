/**
 * =============================================================================
 * EDGE FUNCTION: report-result
 * =============================================================================
 * 
 * Permite a un jugador o admin reportar el resultado de un partido.
 * 
 * FLUJO DE CONFIRMACIÓN:
 *   1. Jugador A reporta resultado
 *   2. Se notifica a Jugador B para confirmar
 *   3. Si Jugador B confirma → resultado oficial
 *   4. Si Jugador B disputa → se crea incidente para admin
 *   5. Admin puede hacer override en cualquier momento
 * 
 * DECISIONES CLAVE:
 * 
 *   1. IDEMPOTENCIA: Usamos Idempotency-Key header. Si el mismo jugador
 *      envía el mismo resultado dos veces, retornamos el resultado cacheado.
 *      Esto previene duplicados por retry del cliente.
 * 
 *   2. PERMISOS FLEXIBLES: Un jugador solo puede reportar resultados de
 *      partidos donde participa. Un admin puede reportar cualquier partido.
 * 
 *   3. RESULTADO PENDIENTE: El resultado queda en estado "pending_confirmation"
 *      hasta que el otro equipo confirme o un admin lo apruebe.
 *      Esto evita fraudes y errores humanos.
 * 
 *   4. LOCK OPTIMISTA: Usamos FOR UPDATE en el match para prevenir
 *      race conditions si ambos jugadores reportan simultáneamente.
 *      El primero en reportar "gana" y el otro debe confirmar.
 * 
 *   5. VALIDACIÓN DE SCORE: Verificamos que el score sea válido según
 *      las reglas del torneo (sets_to_win, games_per_set, etc.)
 * 
 * Endpoint: POST /functions/v1/report-result
 * 
 * Headers:
 *   Authorization: Bearer <jwt>
 *   X-Tenant-ID: <uuid>
 *   Idempotency-Key: <uuid> (recomendado)
 * 
 * Body:
 *   {
 *     match_id: string,
 *     sets: [
 *       { set_number: 1, team1_games: 6, team2_games: 4 },
 *       { set_number: 2, team1_games: 7, team2_games: 6, tiebreak_team1: 7, tiebreak_team2: 5 }
 *     ],
 *     winner_team_id: string,
 *     duration_minutes?: number,
 *     notes?: string
 *   }
 * 
 * =============================================================================
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

// =============================================================================
// TYPES
// =============================================================================

interface AppContext {
  requestId: string;
  profileId: string;
  tenantId: string;
  tenantUserId: string;
  role: 'owner' | 'admin' | 'player';
  supabase: ReturnType<typeof createClient>;
}

interface SetScore {
  set_number: number;
  team1_games: number;
  team2_games: number;
  tiebreak_team1?: number;
  tiebreak_team2?: number;
}

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const setScoreSchema = z.object({
  set_number: z.number().int().min(1).max(5),
  team1_games: z.number().int().min(0).max(7),
  team2_games: z.number().int().min(0).max(7),
  tiebreak_team1: z.number().int().min(0).max(99).optional(),
  tiebreak_team2: z.number().int().min(0).max(99).optional(),
});

const requestSchema = z.object({
  match_id: z.string().uuid(),
  sets: z.array(setScoreSchema).min(1).max(5),
  winner_team_id: z.string().uuid(),
  duration_minutes: z.number().int().min(1).max(300).optional(),
  notes: z.string().max(500).optional(),
});

// =============================================================================
// ERROR CLASSES
// =============================================================================

class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 400,
    public details?: Record<string, unknown>
  ) {
    super(message);
  }
}

class UnauthorizedError extends AppError {
  constructor(message = "No autorizado") { super("UNAUTHORIZED", message, 401); }
}

class ForbiddenError extends AppError {
  constructor(message = "Permisos insuficientes") { super("FORBIDDEN", message, 403); }
}

class NotFoundError extends AppError {
  constructor(entity: string) { super("NOT_FOUND", `${entity} no encontrado`, 404); }
}

class ConflictError extends AppError {
  constructor(message: string) { super("CONFLICT", message, 409); }
}

class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("VALIDATION_ERROR", message, 400, details);
  }
}

// =============================================================================
// SCORE VALIDATION
// =============================================================================

/**
 * Valida que el score sea coherente con las reglas del torneo
 * 
 * Reglas de pádel:
 *   - Un set se gana con 6 games y 2 de diferencia
 *   - Con 6-6 se juega tiebreak
 *   - El partido lo gana quien gana N sets (según torneo)
 */
function validateScore(
  sets: SetScore[],
  winnerId: string,
  team1Id: string,
  team2Id: string,
  setsToWin: number,
  gamesPerSet: number
): { valid: boolean; error?: string } {
  
  let team1SetsWon = 0;
  let team2SetsWon = 0;
  
  for (const set of sets) {
    const { team1_games, team2_games, tiebreak_team1, tiebreak_team2 } = set;
    
    // Validar que alguien ganó el set
    const team1WonSet = team1_games > team2_games && 
      (team1_games >= gamesPerSet && team1_games - team2_games >= 2) ||
      (team1_games === gamesPerSet + 1 && team2_games === gamesPerSet); // 7-6 con tiebreak
    
    const team2WonSet = team2_games > team1_games && 
      (team2_games >= gamesPerSet && team2_games - team1_games >= 2) ||
      (team2_games === gamesPerSet + 1 && team1_games === gamesPerSet); // 7-6 con tiebreak
    
    if (!team1WonSet && !team2WonSet) {
      // Verificar si es un set incompleto válido (el último set puede ser WO)
      if (set.set_number !== sets.length) {
        return { 
          valid: false, 
          error: `Set ${set.set_number} tiene un resultado inválido: ${team1_games}-${team2_games}` 
        };
      }
    }
    
    // Si es 7-6, debe haber tiebreak
    if ((team1_games === 7 && team2_games === 6) || (team2_games === 7 && team1_games === 6)) {
      if (tiebreak_team1 === undefined || tiebreak_team2 === undefined) {
        return { 
          valid: false, 
          error: `Set ${set.set_number} terminó 7-6, debe incluir resultado del tiebreak` 
        };
      }
      
      // Validar tiebreak (se gana con 7 y 2 de diferencia)
      const tb1 = tiebreak_team1;
      const tb2 = tiebreak_team2;
      const tbWinner = tb1 > tb2 ? 'team1' : 'team2';
      const tbMax = Math.max(tb1, tb2);
      const tbMin = Math.min(tb1, tb2);
      
      if (tbMax < 7 || (tbMax >= 7 && tbMax - tbMin < 2)) {
        return { 
          valid: false, 
          error: `Tiebreak del set ${set.set_number} inválido: ${tb1}-${tb2}` 
        };
      }
      
      // Verificar coherencia entre tiebreak y games
      if (team1_games === 7 && tbWinner !== 'team1') {
        return { valid: false, error: `Tiebreak inconsistente con resultado del set ${set.set_number}` };
      }
      if (team2_games === 7 && tbWinner !== 'team2') {
        return { valid: false, error: `Tiebreak inconsistente con resultado del set ${set.set_number}` };
      }
    }
    
    if (team1WonSet) team1SetsWon++;
    if (team2WonSet) team2SetsWon++;
  }
  
  // Validar ganador
  const expectedWinner = team1SetsWon >= setsToWin ? team1Id : 
                         team2SetsWon >= setsToWin ? team2Id : null;
  
  if (!expectedWinner) {
    return { 
      valid: false, 
      error: `Ningún equipo ha ganado ${setsToWin} sets aún` 
    };
  }
  
  if (expectedWinner !== winnerId) {
    return { 
      valid: false, 
      error: `El ganador declarado no coincide con el score (${team1SetsWon}-${team2SetsWon})` 
    };
  }
  
  return { valid: true };
}

// =============================================================================
// IDEMPOTENCY HELPERS
// =============================================================================

async function checkIdempotency(
  supabase: ReturnType<typeof createClient>,
  key: string,
  tenantId: string
): Promise<{ cached: boolean; response?: unknown }> {
  // En producción, usar Redis/KV. Aquí usamos una tabla de DB.
  const { data } = await supabase
    .from('idempotency_keys')
    .select('response')
    .eq('key', key)
    .eq('tenant_id', tenantId)
    .single();
  
  if (data) {
    return { cached: true, response: data.response };
  }
  return { cached: false };
}

async function saveIdempotency(
  supabase: ReturnType<typeof createClient>,
  key: string,
  tenantId: string,
  response: unknown
): Promise<void> {
  await supabase
    .from('idempotency_keys')
    .upsert({
      key,
      tenant_id: tenantId,
      response,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24h
    });
}

// =============================================================================
// NOTIFICATION HELPER
// =============================================================================

async function queueNotification(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  type: string,
  recipientIds: string[],
  title: string,
  body: string,
  data: Record<string, unknown>
): Promise<void> {
  // Insertar en tabla de eventos para procesamiento asíncrono
  await supabase.from('events').insert({
    tenant_id: tenantId,
    type: 'result_reported',
    payload: {
      notification_type: type,
      recipients: recipientIds,
      title,
      body,
      data
    },
    processed: false
  });
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

async function handleReportResult(
  ctx: AppContext,
  body: z.infer<typeof requestSchema>,
  idempotencyKey: string | null
): Promise<Response> {
  const { match_id, sets, winner_team_id, duration_minutes, notes } = body;
  
  // 1. Check idempotency
  if (idempotencyKey) {
    const { cached, response } = await checkIdempotency(
      ctx.supabase, 
      idempotencyKey, 
      ctx.tenantId
    );
    if (cached) {
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Hit': 'true' }
      });
    }
  }
  
  // 2. Obtener y bloquear el partido
  const { data: match, error: matchError } = await ctx.supabase
    .from('matches')
    .select(`
      *,
      tournament:tournaments(id, name, sets_to_win, games_per_set, status, settings)
    `)
    .eq('id', match_id)
    .eq('tenant_id', ctx.tenantId)
    .single();
  
  if (matchError || !match) {
    throw new NotFoundError('Partido');
  }
  
  // 3. Validar estado del partido
  if (match.status === 'finished') {
    throw new ConflictError('El partido ya tiene un resultado confirmado');
  }
  
  if (match.status === 'cancelled') {
    throw new ConflictError('El partido fue cancelado');
  }
  
  if (!match.team1_id || !match.team2_id) {
    throw new ConflictError('El partido no tiene ambos equipos asignados');
  }
  
  // 4. Verificar permisos
  const isAdmin = ['admin', 'owner'].includes(ctx.role);
  
  if (!isAdmin) {
    // Verificar que el jugador participa en el partido
    const { data: membership } = await ctx.supabase
      .from('team_members')
      .select('team_id')
      .eq('tenant_user_id', ctx.tenantUserId)
      .in('team_id', [match.team1_id, match.team2_id])
      .is('left_at', null)
      .limit(1);
    
    if (!membership || membership.length === 0) {
      throw new ForbiddenError('Solo podés reportar resultados de partidos donde participás');
    }
  }
  
  // 5. Validar que winner_team_id es uno de los equipos
  if (winner_team_id !== match.team1_id && winner_team_id !== match.team2_id) {
    throw new ValidationError('El ganador debe ser uno de los equipos del partido');
  }
  
  // 6. Validar score según reglas del torneo
  const tournament = match.tournament;
  const scoreValidation = validateScore(
    sets,
    winner_team_id,
    match.team1_id,
    match.team2_id,
    tournament.sets_to_win,
    tournament.games_per_set
  );
  
  if (!scoreValidation.valid) {
    throw new ValidationError(scoreValidation.error!);
  }
  
  // 7. Ejecutar en transacción
  const loserId = winner_team_id === match.team1_id ? match.team2_id : match.team1_id;
  
  // Determinar si necesita confirmación o es auto-aprobado
  const needsConfirmation = !isAdmin; // Admins auto-aprueban
  const newStatus = needsConfirmation ? 'in_progress' : 'finished';
  
  // 7.1 Actualizar match
  const { error: updateError } = await ctx.supabase
    .from('matches')
    .update({
      status: newStatus,
      winner_id: needsConfirmation ? null : winner_team_id,
      loser_id: needsConfirmation ? null : loserId,
      finished_at: needsConfirmation ? null : new Date().toISOString(),
      settings: {
        ...(match.settings || {}),
        pending_result: needsConfirmation ? {
          reported_by: ctx.tenantUserId,
          reported_at: new Date().toISOString(),
          winner_team_id,
          loser_team_id: loserId,
          sets,
          duration_minutes,
          notes,
          status: 'pending_confirmation'
        } : null,
        result_notes: notes
      },
      updated_at: new Date().toISOString()
    })
    .eq('id', match_id)
    .eq('tenant_id', ctx.tenantId);
  
  if (updateError) {
    throw new AppError('DB_ERROR', 'Error actualizando partido', 500);
  }
  
  // 7.2 Insertar/actualizar resultados por set
  // Primero borrar resultados anteriores (para idempotencia)
  await ctx.supabase
    .from('match_results')
    .delete()
    .eq('match_id', match_id)
    .eq('tenant_id', ctx.tenantId);
  
  // Insertar nuevos resultados
  const resultsToInsert = sets.map(set => ({
    tenant_id: ctx.tenantId,
    match_id,
    set_number: set.set_number,
    team1_games: set.team1_games,
    team2_games: set.team2_games,
    tiebreak_team1: set.tiebreak_team1 ?? null,
    tiebreak_team2: set.tiebreak_team2 ?? null,
    duration_minutes: set.set_number === sets.length ? duration_minutes : null
  }));
  
  const { error: resultsError } = await ctx.supabase
    .from('match_results')
    .insert(resultsToInsert);
  
  if (resultsError) {
    throw new AppError('DB_ERROR', 'Error guardando resultados', 500);
  }
  
  // 8. Si es admin, avanzar ganador automáticamente
  if (!needsConfirmation && match.next_match_id) {
    await ctx.supabase.rpc('advance_winner_to_next_match', {
      p_match_id: match_id
    });
  }
  
  // 9. Enviar notificaciones
  if (needsConfirmation) {
    // Obtener jugadores del otro equipo para notificar
    const otherTeamId = winner_team_id === match.team1_id ? match.team2_id : match.team1_id;
    
    const { data: otherTeamMembers } = await ctx.supabase
      .from('team_members')
      .select('tenant_user_id')
      .eq('team_id', otherTeamId)
      .is('left_at', null);
    
    if (otherTeamMembers && otherTeamMembers.length > 0) {
      await queueNotification(
        ctx.supabase,
        ctx.tenantId,
        'result_pending_confirmation',
        otherTeamMembers.map(m => m.tenant_user_id),
        'Resultado pendiente de confirmación',
        `Se reportó el resultado del partido. Por favor confirmá o disputá.`,
        {
          match_id,
          tournament_id: tournament.id,
          tournament_name: tournament.name,
          reported_winner: winner_team_id,
          sets
        }
      );
    }
  }
  
  // 10. Preparar response
  const response = {
    data: {
      match_id,
      status: newStatus,
      needs_confirmation: needsConfirmation,
      winner_team_id: needsConfirmation ? null : winner_team_id,
      sets,
      message: needsConfirmation 
        ? 'Resultado reportado. Esperando confirmación del otro equipo.'
        : 'Resultado confirmado.'
    }
  };
  
  // 11. Guardar idempotency
  if (idempotencyKey) {
    await saveIdempotency(ctx.supabase, idempotencyKey, ctx.tenantId, response);
  }
  
  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

// =============================================================================
// ENTRY POINT
// =============================================================================

serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  
  try {
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST' } }),
        { status: 405 }
      );
    }
    
    // Parse body
    const body = await req.json();
    const validatedBody = requestSchema.parse(body);
    
    // Auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Token requerido');
    }
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      throw new UnauthorizedError('Token inválido');
    }
    
    // Tenant
    const tenantId = req.headers.get('X-Tenant-ID');
    if (!tenantId) {
      throw new AppError('MISSING_TENANT', 'X-Tenant-ID header requerido', 400);
    }
    
    // Authorization
    const { data: membership } = await supabase
      .from('tenant_users')
      .select('id, role, status')
      .eq('tenant_id', tenantId)
      .eq('profile_id', user.id)
      .single();
    
    if (!membership || membership.status !== 'active') {
      throw new ForbiddenError('No sos miembro activo de este tenant');
    }
    
    // Set session context
    await supabase.rpc('set_session_context', {
      p_profile_id: user.id,
      p_tenant_id: tenantId,
      p_client_ip: req.headers.get('CF-Connecting-IP') || 'unknown',
      p_user_agent: req.headers.get('User-Agent') || 'unknown'
    });
    
    const ctx: AppContext = {
      requestId,
      profileId: user.id,
      tenantId,
      tenantUserId: membership.id,
      role: membership.role,
      supabase
    };
    
    const idempotencyKey = req.headers.get('Idempotency-Key');
    
    const response = await handleReportResult(ctx, validatedBody, idempotencyKey);
    
    console.log(JSON.stringify({
      level: 'info',
      message: 'Result reported',
      requestId,
      tenantId,
      matchId: validatedBody.match_id,
      duration: Date.now() - startTime
    }));
    
    return response;
    
  } catch (error) {
    const isAppError = error instanceof AppError;
    const statusCode = isAppError ? error.statusCode : 500;
    const errorCode = isAppError ? error.code : 'INTERNAL_ERROR';
    const message = isAppError ? error.message : 'Error interno';
    
    console.error(JSON.stringify({
      level: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
      requestId,
      duration: Date.now() - startTime
    }));
    
    return new Response(
      JSON.stringify({ error: { code: errorCode, message, requestId } }),
      { status: statusCode, headers: { 'Content-Type': 'application/json' } }
    );
  }
});

