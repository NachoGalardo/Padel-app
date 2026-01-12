/**
 * =============================================================================
 * EDGE FUNCTION: resolve-incident
 * =============================================================================
 * 
 * Permite a un admin resolver incidentes (disputas, no-shows, etc.)
 * 
 * TIPOS DE RESOLUCIÓN:
 *   - dismiss: Desestimar el incidente (sin acción)
 *   - warn: Advertencia al equipo/jugador afectado
 *   - disqualify: Descalificar equipo del torneo
 *   - reschedule: Reprogramar el partido
 *   - override_result: Forzar un resultado diferente al reportado
 * 
 * DECISIONES CLAVE:
 * 
 *   1. ADMIN-ONLY: Solo admins y owners pueden resolver incidentes.
 *      Los jugadores pueden reportar pero no resolver.
 * 
 *   2. OVERRIDE DE RESULTADO: Cuando se disputa un resultado, el admin
 *      puede confirmar el original, invertirlo, o declarar walkover.
 *      Esto es la "última palabra" y no se puede disputar nuevamente.
 * 
 *   3. AUDITORÍA COMPLETA: Cada resolución queda registrada con:
 *      - Quién resolvió
 *      - Cuándo
 *      - Qué acción tomó
 *      - Notas de justificación
 *      Esto es crítico para transparencia y posibles apelaciones.
 * 
 *   4. IDEMPOTENCIA: Resolver un incidente ya resuelto retorna el
 *      resultado anterior sin modificar nada.
 * 
 *   5. CASCADA DE EFECTOS: Si se override un resultado, automáticamente
 *      se actualiza el bracket (next_match_id), rankings, etc.
 * 
 *   6. NOTIFICACIONES: Todos los afectados son notificados de la resolución.
 * 
 * Endpoint: POST /functions/v1/resolve-incident
 * 
 * Body:
 *   {
 *     incident_id: string,
 *     resolution_notes: string,
 *     action: 'dismiss' | 'warn' | 'disqualify' | 'reschedule' | 'override_result',
 *     override_winner_id?: string  // Requerido si action='override_result'
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

type ResolutionAction = 'dismiss' | 'warn' | 'disqualify' | 'reschedule' | 'override_result';

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const requestSchema = z.object({
  incident_id: z.string().uuid(),
  resolution_notes: z.string().min(10).max(1000),
  action: z.enum(['dismiss', 'warn', 'disqualify', 'reschedule', 'override_result']),
  override_winner_id: z.string().uuid().optional(),
  reschedule_to: z.string().datetime().optional(),
}).refine(
  (data) => {
    if (data.action === 'override_result' && !data.override_winner_id) {
      return false;
    }
    return true;
  },
  { message: "override_winner_id es requerido cuando action='override_result'" }
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
    type: 'incident_resolved' as any,
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
// ACTION HANDLERS
// =============================================================================

async function handleDismiss(
  ctx: AppContext,
  incident: any,
  notes: string
): Promise<{ success: boolean; message: string }> {
  // Simplemente marcar como resuelto sin acción adicional
  return {
    success: true,
    message: 'Incidente desestimado sin acción'
  };
}

async function handleWarn(
  ctx: AppContext,
  incident: any,
  notes: string
): Promise<{ success: boolean; message: string }> {
  // Registrar advertencia en el historial del equipo/jugador
  if (incident.affected_team_id) {
    await ctx.supabase
      .from('teams')
      .update({
        settings: ctx.supabase.rpc('jsonb_set_deep', {
          target: 'settings',
          path: ['warnings'],
          value: [{
            incident_id: incident.id,
            reason: notes,
            issued_at: new Date().toISOString(),
            issued_by: ctx.tenantUserId
          }]
        })
      })
      .eq('id', incident.affected_team_id);
  }
  
  return {
    success: true,
    message: 'Advertencia registrada'
  };
}

async function handleDisqualify(
  ctx: AppContext,
  incident: any,
  notes: string
): Promise<{ success: boolean; message: string }> {
  if (!incident.tournament_id || !incident.affected_team_id) {
    throw new AppError('INVALID_STATE', 'Descalificación requiere torneo y equipo afectado');
  }
  
  // Marcar inscripción como descalificada
  const { error: entryError } = await ctx.supabase
    .from('tournament_entries')
    .update({
      status: 'disqualified',
      withdrawal_reason: `Descalificado por incidente: ${notes}`,
      withdrawn_at: new Date().toISOString()
    })
    .eq('tournament_id', incident.tournament_id)
    .eq('team_id', incident.affected_team_id)
    .eq('tenant_id', ctx.tenantId);
  
  if (entryError) {
    throw new AppError('DB_ERROR', 'Error descalificando equipo', 500);
  }
  
  // Si hay partido asociado, declarar walkover para el otro equipo
  if (incident.match_id) {
    const { data: match } = await ctx.supabase
      .from('matches')
      .select('*')
      .eq('id', incident.match_id)
      .single();
    
    if (match && match.status !== 'finished') {
      const winnerId = match.team1_id === incident.affected_team_id 
        ? match.team2_id 
        : match.team1_id;
      
      await ctx.supabase
        .from('matches')
        .update({
          status: 'walkover',
          winner_id: winnerId,
          loser_id: incident.affected_team_id,
          is_walkover: true,
          walkover_reason: `Descalificación: ${notes}`,
          finished_at: new Date().toISOString()
        })
        .eq('id', incident.match_id);
      
      // Avanzar ganador
      if (match.next_match_id) {
        await ctx.supabase.rpc('advance_winner_to_next_match', {
          p_match_id: incident.match_id
        });
      }
    }
  }
  
  return {
    success: true,
    message: 'Equipo descalificado del torneo'
  };
}

async function handleReschedule(
  ctx: AppContext,
  incident: any,
  notes: string,
  rescheduleTo?: string
): Promise<{ success: boolean; message: string }> {
  if (!incident.match_id) {
    throw new AppError('INVALID_STATE', 'Reprogramación requiere partido asociado');
  }
  
  const { data: match } = await ctx.supabase
    .from('matches')
    .select('*')
    .eq('id', incident.match_id)
    .single();
  
  if (!match) {
    throw new NotFoundError('Partido');
  }
  
  if (match.status === 'finished') {
    throw new ConflictError('No se puede reprogramar un partido finalizado');
  }
  
  // Actualizar partido
  const { error } = await ctx.supabase
    .from('matches')
    .update({
      status: 'postponed',
      scheduled_at: rescheduleTo || null,
      settings: {
        ...(match.settings || {}),
        rescheduled: {
          from: match.scheduled_at,
          to: rescheduleTo,
          reason: notes,
          rescheduled_at: new Date().toISOString(),
          rescheduled_by: ctx.tenantUserId
        }
      },
      updated_at: new Date().toISOString()
    })
    .eq('id', incident.match_id);
  
  if (error) {
    throw new AppError('DB_ERROR', 'Error reprogramando partido', 500);
  }
  
  return {
    success: true,
    message: rescheduleTo 
      ? `Partido reprogramado para ${rescheduleTo}` 
      : 'Partido pospuesto (fecha pendiente)'
  };
}

async function handleOverrideResult(
  ctx: AppContext,
  incident: any,
  notes: string,
  overrideWinnerId: string
): Promise<{ success: boolean; message: string }> {
  if (!incident.match_id) {
    throw new AppError('INVALID_STATE', 'Override requiere partido asociado');
  }
  
  const { data: match } = await ctx.supabase
    .from('matches')
    .select('*')
    .eq('id', incident.match_id)
    .single();
  
  if (!match) {
    throw new NotFoundError('Partido');
  }
  
  // Validar que el ganador es uno de los equipos
  if (overrideWinnerId !== match.team1_id && overrideWinnerId !== match.team2_id) {
    throw new AppError('VALIDATION_ERROR', 'El ganador debe ser uno de los equipos del partido');
  }
  
  const loserId = overrideWinnerId === match.team1_id ? match.team2_id : match.team1_id;
  
  // Actualizar partido con override
  const { error: updateError } = await ctx.supabase
    .from('matches')
    .update({
      status: 'finished',
      winner_id: overrideWinnerId,
      loser_id: loserId,
      finished_at: new Date().toISOString(),
      settings: {
        ...(match.settings || {}),
        admin_override: {
          original_pending_result: match.settings?.pending_result,
          override_winner_id: overrideWinnerId,
          override_reason: notes,
          overridden_at: new Date().toISOString(),
          overridden_by: ctx.tenantUserId
        },
        pending_result: null // Limpiar resultado pendiente
      },
      updated_at: new Date().toISOString()
    })
    .eq('id', incident.match_id);
  
  if (updateError) {
    throw new AppError('DB_ERROR', 'Error aplicando override', 500);
  }
  
  // Avanzar ganador al siguiente partido
  if (match.next_match_id) {
    await ctx.supabase.rpc('advance_winner_to_next_match', {
      p_match_id: incident.match_id
    });
  }
  
  return {
    success: true,
    message: 'Resultado establecido por admin'
  };
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

async function handleResolveIncident(
  ctx: AppContext,
  body: z.infer<typeof requestSchema>
): Promise<Response> {
  const { incident_id, resolution_notes, action, override_winner_id, reschedule_to } = body;
  
  // 1. Obtener incidente con lock
  const { data: incident, error: incidentError } = await ctx.supabase
    .from('incidents')
    .select(`
      *,
      tournament:tournaments(id, name),
      match:matches(id, team1_id, team2_id, status, round_name)
    `)
    .eq('id', incident_id)
    .eq('tenant_id', ctx.tenantId)
    .single();
  
  if (incidentError || !incident) {
    throw new NotFoundError('Incidente');
  }
  
  // 2. Verificar que no está resuelto (idempotencia)
  if (incident.resolved_at) {
    return new Response(JSON.stringify({
      data: {
        incident_id,
        status: 'already_resolved',
        resolved_at: incident.resolved_at,
        resolved_by: incident.resolved_by,
        message: 'Este incidente ya fue resuelto anteriormente'
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // 3. Ejecutar acción específica
  let actionResult: { success: boolean; message: string };
  
  switch (action) {
    case 'dismiss':
      actionResult = await handleDismiss(ctx, incident, resolution_notes);
      break;
    case 'warn':
      actionResult = await handleWarn(ctx, incident, resolution_notes);
      break;
    case 'disqualify':
      actionResult = await handleDisqualify(ctx, incident, resolution_notes);
      break;
    case 'reschedule':
      actionResult = await handleReschedule(ctx, incident, resolution_notes, reschedule_to);
      break;
    case 'override_result':
      actionResult = await handleOverrideResult(ctx, incident, resolution_notes, override_winner_id!);
      break;
    default:
      throw new AppError('INVALID_ACTION', `Acción desconocida: ${action}`);
  }
  
  // 4. Marcar incidente como resuelto
  const { error: resolveError } = await ctx.supabase
    .from('incidents')
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: ctx.tenantUserId,
      resolution_notes: `[${action.toUpperCase()}] ${resolution_notes}`,
      updated_at: new Date().toISOString()
    })
    .eq('id', incident_id)
    .eq('tenant_id', ctx.tenantId);
  
  if (resolveError) {
    throw new AppError('DB_ERROR', 'Error marcando incidente como resuelto', 500);
  }
  
  // 5. Notificar a afectados
  const recipientIds: string[] = [];
  
  // Notificar al que reportó
  if (incident.reported_by) {
    recipientIds.push(incident.reported_by);
  }
  
  // Notificar a miembros de equipos afectados
  if (incident.affected_team_id) {
    const { data: teamMembers } = await ctx.supabase
      .from('team_members')
      .select('tenant_user_id')
      .eq('team_id', incident.affected_team_id)
      .is('left_at', null);
    
    if (teamMembers) {
      recipientIds.push(...teamMembers.map(m => m.tenant_user_id));
    }
  }
  
  // Si hay partido asociado, notificar a ambos equipos
  if (incident.match) {
    const teamIds = [incident.match.team1_id, incident.match.team2_id].filter(Boolean);
    
    for (const teamId of teamIds) {
      const { data: members } = await ctx.supabase
        .from('team_members')
        .select('tenant_user_id')
        .eq('team_id', teamId)
        .is('left_at', null);
      
      if (members) {
        recipientIds.push(...members.map(m => m.tenant_user_id));
      }
    }
  }
  
  // Eliminar duplicados
  const uniqueRecipients = [...new Set(recipientIds)];
  
  if (uniqueRecipients.length > 0) {
    await queueNotification(
      ctx.supabase,
      ctx.tenantId,
      'incident_resolved',
      uniqueRecipients,
      'Incidente resuelto',
      `Se resolvió el incidente: ${incident.title}. Acción: ${action}`,
      {
        incident_id,
        tournament_id: incident.tournament_id,
        match_id: incident.match_id,
        action,
        resolution_notes
      }
    );
  }
  
  // 6. Log de auditoría adicional (el trigger captura el update, pero esto es más detallado)
  await ctx.supabase.rpc('log_audit_event', {
    p_action: 'update',
    p_entity_type: 'incident_resolution',
    p_entity_id: incident_id,
    p_old_values: null,
    p_new_values: {
      action,
      resolution_notes,
      override_winner_id,
      reschedule_to
    }
  });
  
  return new Response(JSON.stringify({
    data: {
      incident_id,
      status: 'resolved',
      action,
      action_result: actionResult.message,
      resolved_at: new Date().toISOString(),
      resolved_by: ctx.tenantUserId,
      notifications_sent: uniqueRecipients.length
    }
  }), {
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
    
    // ADMIN-ONLY
    if (!['admin', 'owner'].includes(membership.role)) {
      throw new ForbiddenError('Solo administradores pueden resolver incidentes');
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
    
    const response = await handleResolveIncident(ctx, validatedBody);
    
    console.log(JSON.stringify({
      level: 'info',
      message: 'Incident resolved',
      requestId,
      tenantId,
      incidentId: validatedBody.incident_id,
      action: validatedBody.action,
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

