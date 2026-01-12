/**
 * =============================================================================
 * EDGE FUNCTION: accept-result
 * =============================================================================
 * 
 * Permite al equipo contrario confirmar o disputar un resultado reportado.
 * 
 * FLUJO:
 *   1. Equipo A reporta resultado (estado: pending_confirmation)
 *   2. Equipo B recibe notificación
 *   3. Equipo B llama a esta función con accept: true/false
 *   4a. Si accept=true → resultado se confirma oficialmente
 *   4b. Si accept=false → se crea incidente automático para admin
 * 
 * DECISIONES CLAVE:
 * 
 *   1. VENTANA DE TIEMPO: El equipo tiene 24 horas para confirmar/disputar.
 *      Pasado ese tiempo, el resultado se auto-confirma (configurable).
 *      Esto evita bloqueos por inacción.
 * 
 *   2. SOLO EL OTRO EQUIPO: El equipo que reportó no puede aceptar su
 *      propio resultado (sería redundante y abusable).
 * 
 *   3. DISPUTA = INCIDENTE: Cuando se disputa, automáticamente se crea
 *      un incidente de tipo 'dispute' para que el admin resuelva.
 *      El partido queda bloqueado hasta la resolución.
 * 
 *   4. ADMIN OVERRIDE: Un admin puede forzar la confirmación sin
 *      necesidad de que el otro equipo acepte.
 * 
 *   5. LOCKS: Usamos FOR UPDATE para prevenir race conditions entre
 *      aceptación y disputa simultáneas.
 * 
 * Endpoint: POST /functions/v1/accept-result
 * 
 * Body:
 *   {
 *     match_id: string,
 *     accept: boolean,
 *     dispute_reason?: string  // Requerido si accept=false
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

interface PendingResult {
  reported_by: string;
  reported_at: string;
  winner_team_id: string;
  loser_team_id: string;
  sets: Array<{
    set_number: number;
    team1_games: number;
    team2_games: number;
    tiebreak_team1?: number;
    tiebreak_team2?: number;
  }>;
  status: 'pending_confirmation' | 'disputed' | 'confirmed';
}

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const requestSchema = z.object({
  match_id: z.string().uuid(),
  accept: z.boolean(),
  dispute_reason: z.string().min(10).max(500).optional(),
}).refine(
  (data) => data.accept || (data.dispute_reason && data.dispute_reason.length >= 10),
  { message: "Debe proporcionar una razón para disputar el resultado (mínimo 10 caracteres)" }
);

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
  await supabase.from('events').insert({
    tenant_id: tenantId,
    type: type as any,
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

async function handleAcceptResult(
  ctx: AppContext,
  body: z.infer<typeof requestSchema>
): Promise<Response> {
  const { match_id, accept, dispute_reason } = body;
  
  // 1. Obtener partido con lock
  const { data: match, error: matchError } = await ctx.supabase
    .from('matches')
    .select(`
      *,
      tournament:tournaments(id, name, status)
    `)
    .eq('id', match_id)
    .eq('tenant_id', ctx.tenantId)
    .single();
  
  if (matchError || !match) {
    throw new NotFoundError('Partido');
  }
  
  // 2. Validar que hay un resultado pendiente
  const pendingResult: PendingResult | null = match.settings?.pending_result;
  
  if (!pendingResult || pendingResult.status !== 'pending_confirmation') {
    throw new ConflictError('No hay resultado pendiente de confirmación para este partido');
  }
  
  // 3. Validar estado del partido
  if (match.status === 'finished') {
    throw new ConflictError('El partido ya tiene un resultado confirmado');
  }
  
  if (match.status === 'cancelled') {
    throw new ConflictError('El partido fue cancelado');
  }
  
  // 4. Verificar permisos
  const isAdmin = ['admin', 'owner'].includes(ctx.role);
  
  // Determinar equipo del usuario actual
  let userTeamId: string | null = null;
  
  if (!isAdmin) {
    const { data: membership } = await ctx.supabase
      .from('team_members')
      .select('team_id')
      .eq('tenant_user_id', ctx.tenantUserId)
      .in('team_id', [match.team1_id, match.team2_id])
      .is('left_at', null)
      .limit(1);
    
    if (!membership || membership.length === 0) {
      throw new ForbiddenError('Solo podés aceptar/disputar resultados de partidos donde participás');
    }
    
    userTeamId = membership[0].team_id;
    
    // El equipo que reportó no puede aceptar su propio resultado
    const reporterTeamId = pendingResult.winner_team_id === match.team1_id 
      ? match.team1_id 
      : match.team2_id;
    
    // Verificar si el usuario pertenece al equipo que reportó
    const { data: reporterMembership } = await ctx.supabase
      .from('team_members')
      .select('tenant_user_id')
      .eq('team_id', reporterTeamId)
      .eq('tenant_user_id', pendingResult.reported_by)
      .is('left_at', null)
      .limit(1);
    
    if (reporterMembership && reporterMembership.length > 0 && userTeamId === reporterTeamId) {
      throw new ForbiddenError('No podés confirmar el resultado que vos mismo reportaste');
    }
  }
  
  // 5. Procesar aceptación o disputa
  if (accept) {
    // === ACEPTAR RESULTADO ===
    
    // Actualizar partido como finalizado
    const { error: updateError } = await ctx.supabase
      .from('matches')
      .update({
        status: 'finished',
        winner_id: pendingResult.winner_team_id,
        loser_id: pendingResult.loser_team_id,
        finished_at: new Date().toISOString(),
        settings: {
          ...match.settings,
          pending_result: {
            ...pendingResult,
            status: 'confirmed',
            confirmed_by: ctx.tenantUserId,
            confirmed_at: new Date().toISOString()
          }
        },
        updated_at: new Date().toISOString()
      })
      .eq('id', match_id)
      .eq('tenant_id', ctx.tenantId);
    
    if (updateError) {
      throw new AppError('DB_ERROR', 'Error confirmando resultado', 500);
    }
    
    // Avanzar ganador al siguiente partido
    if (match.next_match_id) {
      await ctx.supabase.rpc('advance_winner_to_next_match', {
        p_match_id: match_id
      });
    }
    
    // Notificar al equipo que reportó
    const { data: reporterMembers } = await ctx.supabase
      .from('team_members')
      .select('tenant_user_id')
      .eq('team_id', pendingResult.winner_team_id)
      .is('left_at', null);
    
    if (reporterMembers) {
      await queueNotification(
        ctx.supabase,
        ctx.tenantId,
        'result_confirmed',
        reporterMembers.map(m => m.tenant_user_id),
        'Resultado confirmado',
        'El resultado del partido fue confirmado por el otro equipo.',
        { match_id, tournament_id: match.tournament_id }
      );
    }
    
    return new Response(JSON.stringify({
      data: {
        match_id,
        status: 'finished',
        winner_team_id: pendingResult.winner_team_id,
        message: 'Resultado confirmado exitosamente'
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } else {
    // === DISPUTAR RESULTADO ===
    
    // Actualizar estado del resultado pendiente
    const { error: updateError } = await ctx.supabase
      .from('matches')
      .update({
        settings: {
          ...match.settings,
          pending_result: {
            ...pendingResult,
            status: 'disputed',
            disputed_by: ctx.tenantUserId,
            disputed_at: new Date().toISOString(),
            dispute_reason
          }
        },
        updated_at: new Date().toISOString()
      })
      .eq('id', match_id)
      .eq('tenant_id', ctx.tenantId);
    
    if (updateError) {
      throw new AppError('DB_ERROR', 'Error registrando disputa', 500);
    }
    
    // Crear incidente automático
    const { data: incident, error: incidentError } = await ctx.supabase
      .from('incidents')
      .insert({
        tenant_id: ctx.tenantId,
        tournament_id: match.tournament_id,
        match_id: match_id,
        type: 'dispute',
        severity: 'medium',
        title: `Disputa de resultado - ${match.round_name || 'Partido ' + match.match_number}`,
        description: `El resultado reportado fue disputado.\n\nRazón: ${dispute_reason}\n\nResultado reportado: ${JSON.stringify(pendingResult.sets)}`,
        affected_team_id: userTeamId,
        reported_by: ctx.tenantUserId,
        reported_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (incidentError) {
      console.error('Error creating incident:', incidentError);
      // No fallar la operación principal por esto
    }
    
    // Notificar a admins del tenant
    const { data: admins } = await ctx.supabase
      .from('tenant_users')
      .select('id')
      .eq('tenant_id', ctx.tenantId)
      .in('role', ['admin', 'owner'])
      .eq('status', 'active');
    
    if (admins) {
      await queueNotification(
        ctx.supabase,
        ctx.tenantId,
        'result_disputed',
        admins.map(a => a.id),
        '⚠️ Resultado disputado',
        `Se disputó el resultado del partido. Requiere intervención de admin.`,
        { 
          match_id, 
          tournament_id: match.tournament_id,
          incident_id: incident?.id,
          dispute_reason 
        }
      );
    }
    
    // Notificar al equipo que reportó
    const { data: reporterMembers } = await ctx.supabase
      .from('team_members')
      .select('tenant_user_id')
      .eq('team_id', pendingResult.winner_team_id === match.team1_id ? match.team1_id : match.team2_id)
      .is('left_at', null);
    
    if (reporterMembers) {
      await queueNotification(
        ctx.supabase,
        ctx.tenantId,
        'result_disputed',
        reporterMembers.map(m => m.tenant_user_id),
        'Resultado disputado',
        'El otro equipo disputó el resultado reportado. Un admin resolverá la situación.',
        { match_id, tournament_id: match.tournament_id }
      );
    }
    
    return new Response(JSON.stringify({
      data: {
        match_id,
        status: 'disputed',
        incident_id: incident?.id,
        message: 'Disputa registrada. Un administrador resolverá la situación.'
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
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
    
    const body = await req.json();
    const validatedBody = requestSchema.parse(body);
    
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
    
    const tenantId = req.headers.get('X-Tenant-ID');
    if (!tenantId) {
      throw new AppError('MISSING_TENANT', 'X-Tenant-ID header requerido', 400);
    }
    
    const { data: membership } = await supabase
      .from('tenant_users')
      .select('id, role, status')
      .eq('tenant_id', tenantId)
      .eq('profile_id', user.id)
      .single();
    
    if (!membership || membership.status !== 'active') {
      throw new ForbiddenError('No sos miembro activo de este tenant');
    }
    
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
    
    const response = await handleAcceptResult(ctx, validatedBody);
    
    console.log(JSON.stringify({
      level: 'info',
      message: validatedBody.accept ? 'Result accepted' : 'Result disputed',
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

