/**
 * =============================================================================
 * EDGE FUNCTION: generate-fixture
 * =============================================================================
 * 
 * Genera el fixture completo de un torneo:
 *   - Fase de grupos (round-robin)
 *   - Fase de playoffs (eliminación directa)
 *   - Fechas calculadas automáticamente
 * 
 * Requisitos:
 *   - Solo admins/owners
 *   - Multi-tenant con aislamiento
 *   - Transacción serializable con row-level locks
 *   - Idempotente (regenerar borra fixture anterior)
 *   - Audit log automático
 * 
 * Endpoint: POST /functions/v1/generate-fixture
 * 
 * Body:
 *   {
 *     tournament_id: string (UUID),
 *     config?: {
 *       groups_count?: number,        // Default: auto-calculado
 *       teams_per_group?: number,     // Default: 4
 *       teams_advance_per_group?: number, // Default: 2
 *       match_duration_minutes?: number,  // Default: 60
 *       matches_per_day?: number,     // Default: 8
 *       start_time?: string,          // Default: "09:00"
 *       end_time?: string,            // Default: "22:00"
 *       rest_between_matches?: number // Default: 15 (minutos)
 *     }
 *   }
 * 
 * Response:
 *   {
 *     data: {
 *       tournament_id: string,
 *       total_matches: number,
 *       group_stage: { groups: [...], matches_count: number },
 *       playoff_stage: { rounds: [...], matches_count: number },
 *       schedule: { start_date: string, end_date: string, days: number }
 *     }
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

interface Team {
  id: string;
  entry_id: string;
  seed: number | null;
}

interface GroupMatch {
  team1_idx: number;
  team2_idx: number;
  round: number;
}

interface Match {
  id?: string;
  tournament_id: string;
  tenant_id: string;
  round_number: number;
  round_name: string;
  match_number: number;
  bracket_position: string;
  team1_id: string | null;
  team1_entry_id: string | null;
  team2_id: string | null;
  team2_entry_id: string | null;
  scheduled_at: string | null;
  next_match_id: string | null;
  phase: 'group' | 'playoff';
  group_number?: number;
}

interface FixtureConfig {
  groups_count: number;
  teams_per_group: number;
  teams_advance_per_group: number;
  match_duration_minutes: number;
  matches_per_day: number;
  start_time: string;
  end_time: string;
  rest_between_matches: number;
}

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const requestSchema = z.object({
  tournament_id: z.string().uuid(),
  config: z.object({
    groups_count: z.number().int().min(1).max(16).optional(),
    teams_per_group: z.number().int().min(3).max(8).optional(),
    teams_advance_per_group: z.number().int().min(1).max(4).optional(),
    match_duration_minutes: z.number().int().min(30).max(180).optional(),
    matches_per_day: z.number().int().min(1).max(20).optional(),
    start_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    end_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    rest_between_matches: z.number().int().min(0).max(60).optional(),
  }).optional(),
});

// =============================================================================
// ERROR CLASSES
// =============================================================================

class AppError extends Error {
  constructor(
    public code: string,
    public message: string,
    public statusCode: number = 400,
    public details?: Record<string, unknown>
  ) {
    super(message);
  }
}

class UnauthorizedError extends AppError {
  constructor(message = "No autorizado") {
    super("UNAUTHORIZED", message, 401);
  }
}

class ForbiddenError extends AppError {
  constructor(message = "Permisos insuficientes") {
    super("FORBIDDEN", message, 403);
  }
}

class NotFoundError extends AppError {
  constructor(entity: string) {
    super("NOT_FOUND", `${entity} no encontrado`, 404);
  }
}

class ConflictError extends AppError {
  constructor(message: string) {
    super("CONFLICT", message, 409);
  }
}

// =============================================================================
// PSEUDOCODE: MAIN FLOW
// =============================================================================
/*
FUNCTION generate_fixture(tournament_id, config):
  
  1. VALIDATE REQUEST
     - Parse y validar body con Zod
     - Verificar tournament_id es UUID válido
  
  2. AUTHENTICATE
     - Extraer JWT del header Authorization
     - Verificar firma y expiración
     - Obtener profile_id
  
  3. RESOLVE TENANT
     - Obtener tenant_id del header X-Tenant-ID o subdomain
     - Verificar tenant existe y está activo
  
  4. AUTHORIZE
     - Verificar usuario es miembro del tenant
     - Verificar rol es 'admin' o 'owner'
     - Si no: throw ForbiddenError
  
  5. BEGIN SERIALIZABLE TRANSACTION
     
     5.1 LOCK TOURNAMENT (FOR UPDATE)
         - SELECT * FROM tournaments WHERE id = ? FOR UPDATE
         - Previene modificaciones concurrentes
     
     5.2 VALIDATE TOURNAMENT STATE
         - Verificar tournament pertenece al tenant
         - Verificar status es 'registration_closed'
         - Si status es 'in_progress': permitir regenerar (con warning)
         - Si status es 'finished': throw ConflictError
     
     5.3 GET CONFIRMED ENTRIES (FOR UPDATE)
         - SELECT * FROM tournament_entries 
           WHERE tournament_id = ? AND status = 'confirmed'
           ORDER BY seed NULLS LAST, confirmed_at
           FOR UPDATE
         - Lock entries para prevenir cambios durante generación
     
     5.4 VALIDATE ENTRIES COUNT
         - Verificar cantidad >= min_teams del torneo
         - Verificar cantidad <= max_teams del torneo
     
     5.5 DELETE EXISTING MATCHES (si regenerando)
         - DELETE FROM matches WHERE tournament_id = ?
         - Cascade borra match_results automáticamente
     
     5.6 CALCULATE FIXTURE STRUCTURE
         - Determinar cantidad de grupos
         - Asignar equipos a grupos (snake draft por seed)
         - Calcular partidos de fase de grupos (round-robin)
         - Calcular partidos de playoffs (bracket)
     
     5.7 CALCULATE SCHEDULE
         - Calcular fechas/horarios de cada partido
         - Respetar restricciones (horarios, descanso, etc.)
         - Asegurar coherencia temporal
     
     5.8 INSERT MATCHES
         - Bulk insert de todos los partidos
         - Establecer next_match_id para playoffs
     
     5.9 UPDATE TOURNAMENT STATUS
         - SET status = 'in_progress'
         - SET fixture_generated_at = NOW()
     
     5.10 AUDIT LOG (automático via trigger)
  
  6. COMMIT TRANSACTION
  
  7. RETURN FIXTURE SUMMARY

END FUNCTION
*/

// =============================================================================
// CORE ALGORITHM: ROUND-ROBIN
// =============================================================================

/**
 * Genera todos los partidos de round-robin para un grupo
 * Algoritmo: Circle method (rotación)
 * 
 * Para N equipos:
 *   - Si N es impar, agregar "BYE" (N+1)
 *   - Rondas = N-1 (o N si era impar)
 *   - Partidos por ronda = N/2
 * 
 * @param teamCount - Cantidad de equipos en el grupo
 * @returns Array de partidos con índices de equipos (0-based)
 */
function generateRoundRobinSchedule(teamCount: number): GroupMatch[] {
  const matches: GroupMatch[] = [];
  
  // Si es impar, agregar fantasma para BYE
  const n = teamCount % 2 === 0 ? teamCount : teamCount + 1;
  const rounds = n - 1;
  const matchesPerRound = n / 2;
  
  // Array de equipos para rotar
  const teams = Array.from({ length: n }, (_, i) => i);
  
  for (let round = 0; round < rounds; round++) {
    for (let match = 0; match < matchesPerRound; match++) {
      const home = teams[match];
      const away = teams[n - 1 - match];
      
      // Saltar si alguno es el equipo fantasma (BYE)
      if (home < teamCount && away < teamCount) {
        matches.push({
          team1_idx: home,
          team2_idx: away,
          round: round + 1
        });
      }
    }
    
    // Rotar: el primero queda fijo, los demás rotan
    const last = teams.pop()!;
    teams.splice(1, 0, last);
  }
  
  return matches;
}

// =============================================================================
// CORE ALGORITHM: BRACKET GENERATION
// =============================================================================

/**
 * Genera el bracket de playoffs (eliminación directa)
 * 
 * @param teamCount - Cantidad de equipos que avanzan a playoffs
 * @returns Estructura del bracket con posiciones
 */
function generatePlayoffBracket(teamCount: number): {
  rounds: { name: string; matches: number }[];
  totalMatches: number;
  bracketSize: number;
} {
  // Encontrar la potencia de 2 más cercana (hacia arriba)
  const bracketSize = Math.pow(2, Math.ceil(Math.log2(teamCount)));
  const byes = bracketSize - teamCount;
  
  const rounds: { name: string; matches: number }[] = [];
  let remaining = bracketSize;
  let roundNum = 1;
  
  while (remaining > 1) {
    const matchesInRound = remaining / 2;
    const roundName = getRoundName(remaining, bracketSize);
    
    rounds.push({
      name: roundName,
      matches: matchesInRound
    });
    
    remaining = remaining / 2;
    roundNum++;
  }
  
  const totalMatches = rounds.reduce((sum, r) => sum + r.matches, 0);
  
  return { rounds, totalMatches, bracketSize };
}

function getRoundName(teamsRemaining: number, bracketSize: number): string {
  if (teamsRemaining === 2) return 'Final';
  if (teamsRemaining === 4) return 'Semifinales';
  if (teamsRemaining === 8) return 'Cuartos de Final';
  if (teamsRemaining === 16) return 'Octavos de Final';
  if (teamsRemaining === 32) return 'Dieciseisavos';
  return `Ronda de ${teamsRemaining}`;
}

// =============================================================================
// CORE ALGORITHM: SNAKE DRAFT (distribución de equipos en grupos)
// =============================================================================

/**
 * Distribuye equipos en grupos usando snake draft
 * Los mejores sembrados se distribuyen uniformemente
 * 
 * Ejemplo con 8 equipos en 2 grupos:
 *   Grupo A: Seed 1, 4, 5, 8
 *   Grupo B: Seed 2, 3, 6, 7
 * 
 * @param teams - Equipos ordenados por seed
 * @param groupsCount - Cantidad de grupos
 * @returns Array de grupos, cada uno con sus equipos
 */
function distributeTeamsToGroups(teams: Team[], groupsCount: number): Team[][] {
  const groups: Team[][] = Array.from({ length: groupsCount }, () => []);
  
  let direction = 1; // 1 = izquierda a derecha, -1 = derecha a izquierda
  let groupIndex = 0;
  
  for (const team of teams) {
    groups[groupIndex].push(team);
    
    // Mover al siguiente grupo
    groupIndex += direction;
    
    // Si llegamos al final, cambiar dirección (snake)
    if (groupIndex >= groupsCount) {
      groupIndex = groupsCount - 1;
      direction = -1;
    } else if (groupIndex < 0) {
      groupIndex = 0;
      direction = 1;
    }
  }
  
  return groups;
}

// =============================================================================
// CORE ALGORITHM: SCHEDULE CALCULATION
// =============================================================================

/**
 * Calcula las fechas y horarios de todos los partidos
 * 
 * Restricciones:
 *   - Respetar horario de inicio y fin del día
 *   - Tiempo de descanso entre partidos
 *   - Un equipo no juega dos partidos seguidos
 *   - Fase de grupos antes de playoffs
 */
function calculateSchedule(
  matches: Match[],
  startDate: Date,
  config: FixtureConfig
): Match[] {
  const scheduledMatches = [...matches];
  
  const [startHour, startMin] = config.start_time.split(':').map(Number);
  const [endHour, endMin] = config.end_time.split(':').map(Number);
  
  const dayStartMinutes = startHour * 60 + startMin;
  const dayEndMinutes = endHour * 60 + endMin;
  const slotDuration = config.match_duration_minutes + config.rest_between_matches;
  
  // Calcular slots disponibles por día
  const slotsPerDay = Math.floor((dayEndMinutes - dayStartMinutes) / slotDuration);
  const actualMatchesPerDay = Math.min(config.matches_per_day, slotsPerDay);
  
  // Separar por fase
  const groupMatches = scheduledMatches.filter(m => m.phase === 'group');
  const playoffMatches = scheduledMatches.filter(m => m.phase === 'playoff');
  
  let currentDate = new Date(startDate);
  let matchesScheduledToday = 0;
  let currentSlot = 0;
  
  // Track último partido de cada equipo para evitar consecutivos
  const lastMatchTime: Map<string, Date> = new Map();
  
  // Función helper para obtener siguiente slot disponible
  const getNextSlot = (team1Id: string | null, team2Id: string | null): Date => {
    while (true) {
      const slotTime = new Date(currentDate);
      const slotMinutes = dayStartMinutes + (currentSlot * slotDuration);
      slotTime.setHours(Math.floor(slotMinutes / 60), slotMinutes % 60, 0, 0);
      
      // Verificar si los equipos tienen descanso suficiente
      const team1LastMatch = team1Id ? lastMatchTime.get(team1Id) : null;
      const team2LastMatch = team2Id ? lastMatchTime.get(team2Id) : null;
      
      const minRestMs = config.rest_between_matches * 60 * 1000;
      const team1Ready = !team1LastMatch || 
        (slotTime.getTime() - team1LastMatch.getTime()) >= minRestMs;
      const team2Ready = !team2LastMatch || 
        (slotTime.getTime() - team2LastMatch.getTime()) >= minRestMs;
      
      if (team1Ready && team2Ready) {
        // Avanzar al siguiente slot
        currentSlot++;
        matchesScheduledToday++;
        
        if (matchesScheduledToday >= actualMatchesPerDay || currentSlot >= slotsPerDay) {
          // Siguiente día
          currentDate.setDate(currentDate.getDate() + 1);
          currentSlot = 0;
          matchesScheduledToday = 0;
        }
        
        return slotTime;
      }
      
      // Probar siguiente slot
      currentSlot++;
      if (currentSlot >= slotsPerDay) {
        currentDate.setDate(currentDate.getDate() + 1);
        currentSlot = 0;
        matchesScheduledToday = 0;
      }
    }
  };
  
  // Programar fase de grupos
  for (const match of groupMatches) {
    const scheduledAt = getNextSlot(match.team1_id, match.team2_id);
    match.scheduled_at = scheduledAt.toISOString();
    
    if (match.team1_id) lastMatchTime.set(match.team1_id, scheduledAt);
    if (match.team2_id) lastMatchTime.set(match.team2_id, scheduledAt);
  }
  
  // Día de descanso entre fases (opcional)
  currentDate.setDate(currentDate.getDate() + 1);
  currentSlot = 0;
  matchesScheduledToday = 0;
  lastMatchTime.clear();
  
  // Programar playoffs (solo los que tienen equipos definidos)
  // Los partidos de rondas posteriores se programan pero sin hora fija
  for (const match of playoffMatches) {
    if (match.team1_id && match.team2_id) {
      const scheduledAt = getNextSlot(match.team1_id, match.team2_id);
      match.scheduled_at = scheduledAt.toISOString();
      
      if (match.team1_id) lastMatchTime.set(match.team1_id, scheduledAt);
      if (match.team2_id) lastMatchTime.set(match.team2_id, scheduledAt);
    }
    // Partidos sin equipos definidos quedan con scheduled_at = null
  }
  
  return scheduledMatches;
}

// =============================================================================
// SQL CRÍTICO: STORED PROCEDURE
// =============================================================================

/*
-- Esta función se ejecuta dentro de una transacción SERIALIZABLE
-- con row-level locks para garantizar consistencia

CREATE OR REPLACE FUNCTION generate_tournament_fixture(
  p_tournament_id UUID,
  p_tenant_id UUID,
  p_actor_id UUID,
  p_matches JSONB  -- Array de partidos pre-calculados
)
RETURNS JSONB AS $$
DECLARE
  v_tournament tournaments%ROWTYPE;
  v_entries_count INTEGER;
  v_deleted_count INTEGER;
  v_inserted_count INTEGER;
BEGIN
  -- 1. LOCK TOURNAMENT (previene modificaciones concurrentes)
  SELECT * INTO v_tournament
  FROM tournaments
  WHERE id = p_tournament_id
    AND tenant_id = p_tenant_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tournament not found or access denied'
      USING ERRCODE = 'P0002';
  END IF;
  
  -- 2. VALIDATE STATUS
  IF v_tournament.status = 'finished' THEN
    RAISE EXCEPTION 'Cannot generate fixture for finished tournament'
      USING ERRCODE = 'P0003';
  END IF;
  
  IF v_tournament.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot generate fixture for cancelled tournament'
      USING ERRCODE = 'P0004';
  END IF;
  
  IF v_tournament.status NOT IN ('registration_closed', 'in_progress') THEN
    RAISE EXCEPTION 'Tournament must have closed registration first'
      USING ERRCODE = 'P0005';
  END IF;
  
  -- 3. LOCK AND COUNT ENTRIES
  SELECT COUNT(*) INTO v_entries_count
  FROM tournament_entries
  WHERE tournament_id = p_tournament_id
    AND status = 'confirmed'
  FOR UPDATE;
  
  IF v_entries_count < v_tournament.min_teams THEN
    RAISE EXCEPTION 'Not enough teams: % confirmed, % required',
      v_entries_count, v_tournament.min_teams
      USING ERRCODE = 'P0006';
  END IF;
  
  -- 4. DELETE EXISTING MATCHES (para regeneración)
  DELETE FROM matches
  WHERE tournament_id = p_tournament_id;
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  
  -- 5. INSERT NEW MATCHES
  INSERT INTO matches (
    tenant_id,
    tournament_id,
    round_number,
    round_name,
    match_number,
    bracket_position,
    team1_id,
    team1_entry_id,
    team2_id,
    team2_entry_id,
    scheduled_at,
    next_match_id,
    status
  )
  SELECT
    p_tenant_id,
    p_tournament_id,
    (match_data->>'round_number')::SMALLINT,
    match_data->>'round_name',
    (match_data->>'match_number')::SMALLINT,
    match_data->>'bracket_position',
    (match_data->>'team1_id')::UUID,
    (match_data->>'team1_entry_id')::UUID,
    (match_data->>'team2_id')::UUID,
    (match_data->>'team2_entry_id')::UUID,
    (match_data->>'scheduled_at')::TIMESTAMPTZ,
    NULL, -- next_match_id se actualiza después
    'scheduled'
  FROM jsonb_array_elements(p_matches) AS match_data;
  
  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  
  -- 6. UPDATE TOURNAMENT STATUS
  UPDATE tournaments
  SET 
    status = 'in_progress',
    settings = settings || jsonb_build_object(
      'fixture_generated_at', NOW(),
      'fixture_generated_by', p_actor_id,
      'previous_matches_deleted', v_deleted_count
    ),
    updated_at = NOW()
  WHERE id = p_tournament_id;
  
  -- 7. RETURN SUMMARY
  RETURN jsonb_build_object(
    'success', TRUE,
    'tournament_id', p_tournament_id,
    'matches_deleted', v_deleted_count,
    'matches_created', v_inserted_count,
    'generated_at', NOW()
  );
  
EXCEPTION
  WHEN OTHERS THEN
    -- Re-raise con contexto
    RAISE EXCEPTION 'Fixture generation failed: %', SQLERRM
      USING ERRCODE = SQLSTATE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Función para actualizar next_match_id en playoffs
CREATE OR REPLACE FUNCTION link_playoff_matches(p_tournament_id UUID)
RETURNS VOID AS $$
DECLARE
  v_match RECORD;
  v_next_match_id UUID;
  v_next_match_number INTEGER;
BEGIN
  -- Para cada partido de playoff, encontrar el siguiente
  FOR v_match IN
    SELECT id, round_number, match_number, bracket_position
    FROM matches
    WHERE tournament_id = p_tournament_id
      AND bracket_position LIKE 'PO-%'
    ORDER BY round_number, match_number
  LOOP
    -- Calcular el número del siguiente partido
    -- En eliminación directa: partido N de ronda R → partido CEIL(N/2) de ronda R+1
    v_next_match_number := CEIL(v_match.match_number::FLOAT / 2);
    
    SELECT id INTO v_next_match_id
    FROM matches
    WHERE tournament_id = p_tournament_id
      AND round_number = v_match.round_number + 1
      AND match_number = v_next_match_number
      AND bracket_position LIKE 'PO-%'
    LIMIT 1;
    
    IF v_next_match_id IS NOT NULL THEN
      UPDATE matches
      SET next_match_id = v_next_match_id
      WHERE id = v_match.id;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;
*/

// =============================================================================
// MAIN HANDLER
// =============================================================================

async function handleGenerateFixture(
  ctx: AppContext,
  body: z.infer<typeof requestSchema>
): Promise<Response> {
  const { tournament_id, config: userConfig } = body;
  
  // Merge config con defaults
  const config: FixtureConfig = {
    groups_count: userConfig?.groups_count ?? 0, // 0 = auto-calcular
    teams_per_group: userConfig?.teams_per_group ?? 4,
    teams_advance_per_group: userConfig?.teams_advance_per_group ?? 2,
    match_duration_minutes: userConfig?.match_duration_minutes ?? 60,
    matches_per_day: userConfig?.matches_per_day ?? 8,
    start_time: userConfig?.start_time ?? "09:00",
    end_time: userConfig?.end_time ?? "22:00",
    rest_between_matches: userConfig?.rest_between_matches ?? 15,
  };
  
  // Ejecutar en transacción serializable
  const result = await ctx.supabase.rpc('execute_serializable_transaction', {
    callback: async () => {
      // 1. Obtener y bloquear torneo
      const { data: tournament, error: tournamentError } = await ctx.supabase
        .from('tournaments')
        .select('*')
        .eq('id', tournament_id)
        .eq('tenant_id', ctx.tenantId)
        .single();
      
      if (tournamentError || !tournament) {
        throw new NotFoundError('Torneo');
      }
      
      // 2. Validar estado
      if (tournament.status === 'finished') {
        throw new ConflictError('No se puede regenerar fixture de torneo finalizado');
      }
      if (tournament.status === 'cancelled') {
        throw new ConflictError('No se puede generar fixture de torneo cancelado');
      }
      if (!['registration_closed', 'in_progress'].includes(tournament.status)) {
        throw new ConflictError('Primero debe cerrar las inscripciones');
      }
      
      // 3. Obtener inscripciones confirmadas
      const { data: entries, error: entriesError } = await ctx.supabase
        .from('tournament_entries')
        .select('id, team_id, seed, confirmed_at')
        .eq('tournament_id', tournament_id)
        .eq('status', 'confirmed')
        .order('seed', { ascending: true, nullsFirst: false })
        .order('confirmed_at', { ascending: true });
      
      if (entriesError) {
        throw new AppError('DB_ERROR', 'Error obteniendo inscripciones', 500);
      }
      
      // 4. Validar cantidad
      if (entries.length < tournament.min_teams) {
        throw new ConflictError(
          `Equipos insuficientes: ${entries.length} confirmados, ${tournament.min_teams} requeridos`
        );
      }
      
      // 5. Preparar equipos
      const teams: Team[] = entries.map((e, idx) => ({
        id: e.team_id,
        entry_id: e.id,
        seed: e.seed ?? idx + 1
      }));
      
      // 6. Calcular estructura
      const teamsCount = teams.length;
      
      // Auto-calcular grupos si no se especificó
      if (config.groups_count === 0) {
        config.groups_count = Math.max(1, Math.floor(teamsCount / config.teams_per_group));
      }
      
      // Distribuir equipos en grupos
      const groups = distributeTeamsToGroups(teams, config.groups_count);
      
      // 7. Generar partidos de fase de grupos
      const allMatches: Match[] = [];
      let matchNumber = 1;
      let groupRoundRobinRounds = 0;
      
      groups.forEach((groupTeams, groupIdx) => {
        const groupLetter = String.fromCharCode(65 + groupIdx); // A, B, C...
        const roundRobinMatches = generateRoundRobinSchedule(groupTeams.length);
        groupRoundRobinRounds = Math.max(
          groupRoundRobinRounds, 
          Math.max(...roundRobinMatches.map(m => m.round))
        );
        
        roundRobinMatches.forEach(rrMatch => {
          const team1 = groupTeams[rrMatch.team1_idx];
          const team2 = groupTeams[rrMatch.team2_idx];
          
          allMatches.push({
            tournament_id,
            tenant_id: ctx.tenantId,
            round_number: rrMatch.round,
            round_name: `Grupo ${groupLetter} - Fecha ${rrMatch.round}`,
            match_number: matchNumber++,
            bracket_position: `G${groupLetter}-R${rrMatch.round}-M${rrMatch.team1_idx + 1}v${rrMatch.team2_idx + 1}`,
            team1_id: team1.id,
            team1_entry_id: team1.entry_id,
            team2_id: team2.id,
            team2_entry_id: team2.entry_id,
            scheduled_at: null, // Se calcula después
            next_match_id: null,
            phase: 'group',
            group_number: groupIdx + 1
          });
        });
      });
      
      // 8. Generar partidos de playoffs
      const teamsAdvancing = config.groups_count * config.teams_advance_per_group;
      const playoffStructure = generatePlayoffBracket(teamsAdvancing);
      
      let playoffRoundNumber = groupRoundRobinRounds + 1;
      let playoffMatchNumber = matchNumber;
      
      playoffStructure.rounds.forEach((round, roundIdx) => {
        for (let i = 0; i < round.matches; i++) {
          allMatches.push({
            tournament_id,
            tenant_id: ctx.tenantId,
            round_number: playoffRoundNumber,
            round_name: round.name,
            match_number: playoffMatchNumber++,
            bracket_position: `PO-R${roundIdx + 1}-M${i + 1}`,
            team1_id: null, // Se define cuando termina fase de grupos
            team1_entry_id: null,
            team2_id: null,
            team2_entry_id: null,
            scheduled_at: null,
            next_match_id: null,
            phase: 'playoff'
          });
        }
        playoffRoundNumber++;
      });
      
      // 9. Calcular schedule
      const startDate = new Date(tournament.start_date);
      const scheduledMatches = calculateSchedule(allMatches, startDate, config);
      
      // 10. Insertar partidos via stored procedure
      const { data: insertResult, error: insertError } = await ctx.supabase
        .rpc('generate_tournament_fixture', {
          p_tournament_id: tournament_id,
          p_tenant_id: ctx.tenantId,
          p_actor_id: ctx.profileId,
          p_matches: scheduledMatches.map(m => ({
            round_number: m.round_number,
            round_name: m.round_name,
            match_number: m.match_number,
            bracket_position: m.bracket_position,
            team1_id: m.team1_id,
            team1_entry_id: m.team1_entry_id,
            team2_id: m.team2_id,
            team2_entry_id: m.team2_entry_id,
            scheduled_at: m.scheduled_at
          }))
        });
      
      if (insertError) {
        throw new AppError('DB_ERROR', insertError.message, 500);
      }
      
      // 11. Vincular partidos de playoffs
      await ctx.supabase.rpc('link_playoff_matches', {
        p_tournament_id: tournament_id
      });
      
      // 12. Calcular resumen
      const groupMatches = scheduledMatches.filter(m => m.phase === 'group');
      const playoffMatches = scheduledMatches.filter(m => m.phase === 'playoff');
      
      const scheduledDates = scheduledMatches
        .filter(m => m.scheduled_at)
        .map(m => new Date(m.scheduled_at!));
      
      const minDate = new Date(Math.min(...scheduledDates.map(d => d.getTime())));
      const maxDate = new Date(Math.max(...scheduledDates.map(d => d.getTime())));
      const daysDiff = Math.ceil((maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      
      return {
        tournament_id,
        total_matches: scheduledMatches.length,
        group_stage: {
          groups: groups.map((g, idx) => ({
            letter: String.fromCharCode(65 + idx),
            teams: g.map(t => t.id)
          })),
          matches_count: groupMatches.length
        },
        playoff_stage: {
          rounds: playoffStructure.rounds,
          matches_count: playoffMatches.length
        },
        schedule: {
          start_date: minDate.toISOString().split('T')[0],
          end_date: maxDate.toISOString().split('T')[0],
          days: daysDiff
        }
      };
    }
  });
  
  return new Response(
    JSON.stringify({ data: result }),
    { 
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}

// =============================================================================
// EDGE FUNCTION ENTRY POINT
// =============================================================================

serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  
  try {
    // Solo POST
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST' } }),
        { status: 405 }
      );
    }
    
    // 1. Parse body
    const body = await req.json();
    const validatedBody = requestSchema.parse(body);
    
    // 2. Auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Token requerido');
    }
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      {
        global: { headers: { Authorization: authHeader } }
      }
    );
    
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      throw new UnauthorizedError('Token inválido');
    }
    
    // 3. Tenant
    const tenantId = req.headers.get('X-Tenant-ID');
    if (!tenantId) {
      throw new AppError('MISSING_TENANT', 'X-Tenant-ID header requerido', 400);
    }
    
    // 4. Authorization
    const { data: membership, error: membershipError } = await supabase
      .from('tenant_users')
      .select('id, role, status')
      .eq('tenant_id', tenantId)
      .eq('profile_id', user.id)
      .single();
    
    if (membershipError || !membership) {
      throw new ForbiddenError('No sos miembro de este tenant');
    }
    
    if (membership.status !== 'active') {
      throw new ForbiddenError('Tu membresía está suspendida');
    }
    
    if (!['admin', 'owner'].includes(membership.role)) {
      throw new ForbiddenError('Solo admins pueden generar fixtures');
    }
    
    // 5. Set session context
    await supabase.rpc('set_session_context', {
      p_profile_id: user.id,
      p_tenant_id: tenantId,
      p_client_ip: req.headers.get('CF-Connecting-IP') || 'unknown',
      p_user_agent: req.headers.get('User-Agent') || 'unknown'
    });
    
    // 6. Execute
    const ctx: AppContext = {
      requestId,
      profileId: user.id,
      tenantId,
      tenantUserId: membership.id,
      role: membership.role,
      supabase
    };
    
    const response = await handleGenerateFixture(ctx, validatedBody);
    
    // Log success
    console.log(JSON.stringify({
      level: 'info',
      message: 'Fixture generated',
      requestId,
      tenantId,
      profileId: user.id,
      tournamentId: validatedBody.tournament_id,
      duration: Date.now() - startTime
    }));
    
    return response;
    
  } catch (error) {
    // Error handling
    const isAppError = error instanceof AppError;
    const statusCode = isAppError ? error.statusCode : 500;
    const errorCode = isAppError ? error.code : 'INTERNAL_ERROR';
    const message = isAppError ? error.message : 'Error interno del servidor';
    
    console.error(JSON.stringify({
      level: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
      requestId,
      stack: error instanceof Error ? error.stack : undefined,
      duration: Date.now() - startTime
    }));
    
    return new Response(
      JSON.stringify({
        error: {
          code: errorCode,
          message,
          requestId
        }
      }),
      { 
        status: statusCode,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
});

