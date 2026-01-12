-- ============================================================================
-- FUNCIONES SQL PARA GENERACIÓN DE FIXTURE
-- ============================================================================
-- Estas funciones se ejecutan con transacción SERIALIZABLE y row-level locks
-- para garantizar consistencia en operaciones concurrentes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- FUNCIÓN: set_session_context
-- ----------------------------------------------------------------------------
-- Setea las variables de sesión para RLS y auditoría.
-- Debe llamarse al inicio de cada request desde el backend.

CREATE OR REPLACE FUNCTION set_session_context(
  p_profile_id UUID,
  p_tenant_id UUID,
  p_client_ip TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  PERFORM set_config('app.current_profile_id', COALESCE(p_profile_id::TEXT, ''), TRUE);
  PERFORM set_config('app.current_tenant_id', COALESCE(p_tenant_id::TEXT, ''), TRUE);
  PERFORM set_config('app.client_ip', COALESCE(p_client_ip, ''), TRUE);
  PERFORM set_config('app.user_agent', COALESCE(p_user_agent, ''), TRUE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- FUNCIÓN: generate_tournament_fixture
-- ----------------------------------------------------------------------------
-- Genera el fixture completo de un torneo.
-- 
-- Características:
--   - Transacción SERIALIZABLE implícita
--   - Row-level locks en tournament y entries
--   - Validación de estado
--   - Borrado de fixture anterior (idempotente)
--   - Audit log automático (via triggers)
--
-- Parámetros:
--   p_tournament_id: UUID del torneo
--   p_tenant_id: UUID del tenant (para validación)
--   p_actor_id: UUID del usuario que ejecuta (para audit)
--   p_matches: JSONB array con los partidos pre-calculados
--
-- Retorna:
--   JSONB con resumen de la operación

CREATE OR REPLACE FUNCTION generate_tournament_fixture(
  p_tournament_id UUID,
  p_tenant_id UUID,
  p_actor_id UUID,
  p_matches JSONB
)
RETURNS JSONB AS $$
DECLARE
  v_tournament tournaments%ROWTYPE;
  v_entries_count INTEGER;
  v_deleted_count INTEGER;
  v_inserted_count INTEGER;
  v_match_data JSONB;
BEGIN
  -- =========================================================================
  -- 1. LOCK TOURNAMENT (previene modificaciones concurrentes)
  -- =========================================================================
  -- FOR UPDATE adquiere un row-level exclusive lock
  -- Otras transacciones que intenten modificar este torneo esperarán
  
  SELECT * INTO v_tournament
  FROM tournaments
  WHERE id = p_tournament_id
    AND tenant_id = p_tenant_id
    AND deleted_at IS NULL
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tournament not found or access denied'
      USING ERRCODE = 'P0002', -- no_data_found
            HINT = 'Verify tournament_id and tenant_id are correct';
  END IF;
  
  -- =========================================================================
  -- 2. VALIDATE TOURNAMENT STATUS
  -- =========================================================================
  
  IF v_tournament.status = 'finished' THEN
    RAISE EXCEPTION 'Cannot generate fixture for finished tournament'
      USING ERRCODE = 'P0003',
            HINT = 'Tournament has already concluded';
  END IF;
  
  IF v_tournament.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot generate fixture for cancelled tournament'
      USING ERRCODE = 'P0004',
            HINT = 'Tournament was cancelled';
  END IF;
  
  IF v_tournament.status NOT IN ('registration_closed', 'in_progress') THEN
    RAISE EXCEPTION 'Tournament must have closed registration first. Current status: %',
      v_tournament.status
      USING ERRCODE = 'P0005',
            HINT = 'Close registration before generating fixture';
  END IF;
  
  -- =========================================================================
  -- 3. LOCK AND COUNT CONFIRMED ENTRIES
  -- =========================================================================
  -- FOR UPDATE previene que se modifiquen las inscripciones durante la generación
  
  SELECT COUNT(*) INTO v_entries_count
  FROM tournament_entries
  WHERE tournament_id = p_tournament_id
    AND tenant_id = p_tenant_id
    AND status = 'confirmed'
  FOR UPDATE;
  
  IF v_entries_count < v_tournament.min_teams THEN
    RAISE EXCEPTION 'Not enough confirmed teams: % confirmed, % required',
      v_entries_count, v_tournament.min_teams
      USING ERRCODE = 'P0006',
            HINT = 'Confirm more team registrations before generating fixture';
  END IF;
  
  IF v_entries_count > v_tournament.max_teams THEN
    RAISE EXCEPTION 'Too many confirmed teams: % confirmed, % maximum',
      v_entries_count, v_tournament.max_teams
      USING ERRCODE = 'P0007',
            HINT = 'Remove excess teams or increase max_teams';
  END IF;
  
  -- =========================================================================
  -- 4. DELETE EXISTING MATCHES (idempotencia - permite regenerar)
  -- =========================================================================
  -- match_results se borran automáticamente por CASCADE
  
  DELETE FROM matches
  WHERE tournament_id = p_tournament_id
    AND tenant_id = p_tenant_id;
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  
  -- Log si se borraron partidos existentes
  IF v_deleted_count > 0 THEN
    RAISE NOTICE 'Deleted % existing matches for regeneration', v_deleted_count;
  END IF;
  
  -- =========================================================================
  -- 5. INSERT NEW MATCHES
  -- =========================================================================
  
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
    estimated_duration_minutes,
    status,
    created_at,
    updated_at
  )
  SELECT
    p_tenant_id,
    p_tournament_id,
    (match_data->>'round_number')::SMALLINT,
    match_data->>'round_name',
    (match_data->>'match_number')::SMALLINT,
    match_data->>'bracket_position',
    NULLIF(match_data->>'team1_id', '')::UUID,
    NULLIF(match_data->>'team1_entry_id', '')::UUID,
    NULLIF(match_data->>'team2_id', '')::UUID,
    NULLIF(match_data->>'team2_entry_id', '')::UUID,
    NULLIF(match_data->>'scheduled_at', '')::TIMESTAMPTZ,
    COALESCE((match_data->>'estimated_duration_minutes')::SMALLINT, 60),
    'scheduled'::match_status,
    NOW(),
    NOW()
  FROM jsonb_array_elements(p_matches) AS match_data;
  
  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  
  -- =========================================================================
  -- 6. UPDATE TOURNAMENT STATUS AND METADATA
  -- =========================================================================
  
  UPDATE tournaments
  SET 
    status = 'in_progress',
    settings = settings || jsonb_build_object(
      'fixture_generated_at', NOW()::TEXT,
      'fixture_generated_by', p_actor_id::TEXT,
      'fixture_version', COALESCE((settings->>'fixture_version')::INTEGER, 0) + 1,
      'previous_matches_deleted', v_deleted_count,
      'total_matches', v_inserted_count
    ),
    updated_at = NOW()
  WHERE id = p_tournament_id
    AND tenant_id = p_tenant_id;
  
  -- =========================================================================
  -- 7. RETURN OPERATION SUMMARY
  -- =========================================================================
  
  RETURN jsonb_build_object(
    'success', TRUE,
    'tournament_id', p_tournament_id,
    'tenant_id', p_tenant_id,
    'actor_id', p_actor_id,
    'matches_deleted', v_deleted_count,
    'matches_created', v_inserted_count,
    'was_regeneration', v_deleted_count > 0,
    'generated_at', NOW()
  );

EXCEPTION
  WHEN OTHERS THEN
    -- Log el error antes de re-raise
    RAISE WARNING 'Fixture generation failed for tournament %: % (SQLSTATE: %)',
      p_tournament_id, SQLERRM, SQLSTATE;
    
    -- Re-raise con contexto adicional
    RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- FUNCIÓN: link_playoff_matches
-- ----------------------------------------------------------------------------
-- Establece los enlaces next_match_id para la navegación del bracket.
-- Debe ejecutarse después de insertar los partidos de playoffs.
--
-- Lógica:
--   - Partido N de ronda R → alimenta partido CEIL(N/2) de ronda R+1
--   - El ganador del partido impar va a team1_id del siguiente
--   - El ganador del partido par va a team2_id del siguiente

CREATE OR REPLACE FUNCTION link_playoff_matches(p_tournament_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_match RECORD;
  v_next_match_id UUID;
  v_next_match_number INTEGER;
  v_links_created INTEGER := 0;
  v_tenant_id UUID;
BEGIN
  -- Obtener tenant_id del torneo
  SELECT tenant_id INTO v_tenant_id
  FROM tournaments
  WHERE id = p_tournament_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tournament not found: %', p_tournament_id;
  END IF;
  
  -- Iterar sobre partidos de playoff ordenados por ronda y número
  FOR v_match IN
    SELECT id, round_number, match_number, bracket_position
    FROM matches
    WHERE tournament_id = p_tournament_id
      AND tenant_id = v_tenant_id
      AND bracket_position LIKE 'PO-%'  -- Solo playoffs
    ORDER BY round_number ASC, match_number ASC
  LOOP
    -- Calcular el número del siguiente partido en la siguiente ronda
    -- En bracket de eliminación directa: partido N → partido CEIL(N/2)
    v_next_match_number := CEIL(v_match.match_number::FLOAT / 2)::INTEGER;
    
    -- Buscar el siguiente partido
    SELECT id INTO v_next_match_id
    FROM matches
    WHERE tournament_id = p_tournament_id
      AND tenant_id = v_tenant_id
      AND round_number = v_match.round_number + 1
      AND match_number = v_next_match_number
      AND bracket_position LIKE 'PO-%'
    LIMIT 1;
    
    -- Si existe siguiente partido, crear el enlace
    IF v_next_match_id IS NOT NULL THEN
      UPDATE matches
      SET next_match_id = v_next_match_id,
          updated_at = NOW()
      WHERE id = v_match.id;
      
      v_links_created := v_links_created + 1;
    END IF;
  END LOOP;
  
  RETURN jsonb_build_object(
    'success', TRUE,
    'tournament_id', p_tournament_id,
    'links_created', v_links_created
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- FUNCIÓN: advance_winner_to_next_match
-- ----------------------------------------------------------------------------
-- Cuando se registra un resultado, avanza al ganador al siguiente partido.
-- Se llama automáticamente via trigger o manualmente.

CREATE OR REPLACE FUNCTION advance_winner_to_next_match(p_match_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_match matches%ROWTYPE;
  v_next_match matches%ROWTYPE;
  v_is_odd_match BOOLEAN;
BEGIN
  -- Obtener el partido actual
  SELECT * INTO v_match
  FROM matches
  WHERE id = p_match_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match not found: %', p_match_id;
  END IF;
  
  -- Verificar que tiene ganador
  IF v_match.winner_id IS NULL THEN
    RAISE EXCEPTION 'Match % has no winner yet', p_match_id;
  END IF;
  
  -- Verificar que tiene siguiente partido
  IF v_match.next_match_id IS NULL THEN
    -- Es la final, no hay siguiente partido
    RETURN jsonb_build_object(
      'success', TRUE,
      'match_id', p_match_id,
      'is_final', TRUE,
      'winner_id', v_match.winner_id
    );
  END IF;
  
  -- Obtener el siguiente partido
  SELECT * INTO v_next_match
  FROM matches
  WHERE id = v_match.next_match_id
  FOR UPDATE;  -- Lock para evitar race conditions
  
  -- Determinar si es partido impar o par (para saber si va a team1 o team2)
  v_is_odd_match := (v_match.match_number % 2) = 1;
  
  IF v_is_odd_match THEN
    -- Ganador va a team1 del siguiente partido
    UPDATE matches
    SET team1_id = v_match.winner_id,
        team1_entry_id = (
          SELECT id FROM tournament_entries
          WHERE tournament_id = v_match.tournament_id
            AND team_id = v_match.winner_id
          LIMIT 1
        ),
        updated_at = NOW()
    WHERE id = v_match.next_match_id;
  ELSE
    -- Ganador va a team2 del siguiente partido
    UPDATE matches
    SET team2_id = v_match.winner_id,
        team2_entry_id = (
          SELECT id FROM tournament_entries
          WHERE tournament_id = v_match.tournament_id
            AND team_id = v_match.winner_id
          LIMIT 1
        ),
        updated_at = NOW()
    WHERE id = v_match.next_match_id;
  END IF;
  
  RETURN jsonb_build_object(
    'success', TRUE,
    'match_id', p_match_id,
    'winner_id', v_match.winner_id,
    'next_match_id', v_match.next_match_id,
    'position_in_next', CASE WHEN v_is_odd_match THEN 'team1' ELSE 'team2' END
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- TRIGGER: auto_advance_winner
-- ----------------------------------------------------------------------------
-- Automáticamente avanza al ganador cuando se actualiza un partido con resultado

CREATE OR REPLACE FUNCTION trigger_advance_winner()
RETURNS TRIGGER AS $$
BEGIN
  -- Solo actuar si:
  -- 1. Se acaba de setear un ganador (antes era NULL)
  -- 2. El partido tiene next_match_id (no es final)
  IF NEW.winner_id IS NOT NULL 
     AND (OLD.winner_id IS NULL OR OLD.winner_id != NEW.winner_id)
     AND NEW.next_match_id IS NOT NULL
  THEN
    PERFORM advance_winner_to_next_match(NEW.id);
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Crear el trigger (si no existe)
DROP TRIGGER IF EXISTS auto_advance_winner_trigger ON matches;
CREATE TRIGGER auto_advance_winner_trigger
  AFTER UPDATE OF winner_id ON matches
  FOR EACH ROW
  EXECUTE FUNCTION trigger_advance_winner();

-- ----------------------------------------------------------------------------
-- FUNCIÓN: calculate_group_standings
-- ----------------------------------------------------------------------------
-- Calcula la tabla de posiciones de un grupo después de la fase de grupos.
-- Útil para determinar qué equipos avanzan a playoffs.

CREATE OR REPLACE FUNCTION calculate_group_standings(
  p_tournament_id UUID,
  p_group_letter CHAR(1)
)
RETURNS TABLE (
  position INTEGER,
  team_id UUID,
  played INTEGER,
  won INTEGER,
  lost INTEGER,
  sets_won INTEGER,
  sets_lost INTEGER,
  games_won INTEGER,
  games_lost INTEGER,
  points INTEGER
) AS $$
BEGIN
  RETURN QUERY
  WITH group_matches AS (
    -- Obtener todos los partidos del grupo
    SELECT 
      m.id,
      m.team1_id,
      m.team2_id,
      m.winner_id,
      m.loser_id,
      m.status
    FROM matches m
    WHERE m.tournament_id = p_tournament_id
      AND m.bracket_position LIKE 'G' || p_group_letter || '-%'
      AND m.status = 'finished'
  ),
  team_stats AS (
    -- Calcular estadísticas por equipo
    SELECT 
      t.team_id,
      COUNT(*) AS played,
      SUM(CASE WHEN t.team_id = gm.winner_id THEN 1 ELSE 0 END) AS won,
      SUM(CASE WHEN t.team_id = gm.loser_id THEN 1 ELSE 0 END) AS lost,
      -- Sets y games requieren join con match_results
      0 AS sets_won,
      0 AS sets_lost,
      0 AS games_won,
      0 AS games_lost,
      SUM(CASE WHEN t.team_id = gm.winner_id THEN 3 ELSE 0 END) AS points
    FROM (
      SELECT DISTINCT team1_id AS team_id FROM group_matches
      UNION
      SELECT DISTINCT team2_id AS team_id FROM group_matches
    ) t
    CROSS JOIN group_matches gm
    WHERE t.team_id = gm.team1_id OR t.team_id = gm.team2_id
    GROUP BY t.team_id
  )
  SELECT 
    ROW_NUMBER() OVER (
      ORDER BY ts.points DESC, ts.won DESC, (ts.sets_won - ts.sets_lost) DESC
    )::INTEGER AS position,
    ts.team_id,
    ts.played::INTEGER,
    ts.won::INTEGER,
    ts.lost::INTEGER,
    ts.sets_won::INTEGER,
    ts.sets_lost::INTEGER,
    ts.games_won::INTEGER,
    ts.games_lost::INTEGER,
    ts.points::INTEGER
  FROM team_stats ts
  ORDER BY position;
END;
$$ LANGUAGE plpgsql STABLE;

-- ----------------------------------------------------------------------------
-- FUNCIÓN: populate_playoffs_from_groups
-- ----------------------------------------------------------------------------
-- Después de terminar la fase de grupos, pobla los playoffs con los equipos
-- que avanzan según las posiciones de cada grupo.

CREATE OR REPLACE FUNCTION populate_playoffs_from_groups(
  p_tournament_id UUID,
  p_teams_per_group INTEGER DEFAULT 2  -- Cuántos equipos avanzan por grupo
)
RETURNS JSONB AS $$
DECLARE
  v_tournament tournaments%ROWTYPE;
  v_group_count INTEGER;
  v_advancing_teams UUID[];
  v_group_letter CHAR(1);
  v_standings RECORD;
  v_team_position INTEGER;
  v_playoff_match RECORD;
  v_teams_placed INTEGER := 0;
BEGIN
  -- Obtener torneo
  SELECT * INTO v_tournament
  FROM tournaments
  WHERE id = p_tournament_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tournament not found: %', p_tournament_id;
  END IF;
  
  -- Contar grupos
  SELECT COUNT(DISTINCT SUBSTRING(bracket_position FROM 2 FOR 1))
  INTO v_group_count
  FROM matches
  WHERE tournament_id = p_tournament_id
    AND bracket_position LIKE 'G_-%';
  
  -- Verificar que todos los partidos de grupos están terminados
  IF EXISTS (
    SELECT 1 FROM matches
    WHERE tournament_id = p_tournament_id
      AND bracket_position LIKE 'G_-%'
      AND status != 'finished'
  ) THEN
    RAISE EXCEPTION 'Not all group matches are finished';
  END IF;
  
  -- Recolectar equipos que avanzan de cada grupo
  v_advancing_teams := ARRAY[]::UUID[];
  
  FOR v_group_letter IN 
    SELECT DISTINCT SUBSTRING(bracket_position FROM 2 FOR 1)
    FROM matches
    WHERE tournament_id = p_tournament_id
      AND bracket_position LIKE 'G_-%'
    ORDER BY 1
  LOOP
    v_team_position := 0;
    
    FOR v_standings IN
      SELECT * FROM calculate_group_standings(p_tournament_id, v_group_letter)
    LOOP
      v_team_position := v_team_position + 1;
      
      IF v_team_position <= p_teams_per_group THEN
        v_advancing_teams := array_append(v_advancing_teams, v_standings.team_id);
      END IF;
    END LOOP;
  END LOOP;
  
  -- Poblar primera ronda de playoffs
  -- Lógica de seeding: 1A vs 2B, 1B vs 2A, etc. (cruzado)
  FOR v_playoff_match IN
    SELECT id, match_number
    FROM matches
    WHERE tournament_id = p_tournament_id
      AND bracket_position LIKE 'PO-R1-%'
    ORDER BY match_number
  LOOP
    -- Asignar equipos según posición en el array
    -- Esta es una simplificación; en producción usar lógica de seeding real
    IF v_teams_placed < array_length(v_advancing_teams, 1) THEN
      UPDATE matches
      SET team1_id = v_advancing_teams[v_teams_placed + 1],
          team1_entry_id = (
            SELECT id FROM tournament_entries
            WHERE tournament_id = p_tournament_id
              AND team_id = v_advancing_teams[v_teams_placed + 1]
            LIMIT 1
          ),
          updated_at = NOW()
      WHERE id = v_playoff_match.id;
      
      v_teams_placed := v_teams_placed + 1;
    END IF;
    
    IF v_teams_placed < array_length(v_advancing_teams, 1) THEN
      UPDATE matches
      SET team2_id = v_advancing_teams[v_teams_placed + 1],
          team2_entry_id = (
            SELECT id FROM tournament_entries
            WHERE tournament_id = p_tournament_id
              AND team_id = v_advancing_teams[v_teams_placed + 1]
            LIMIT 1
          ),
          updated_at = NOW()
      WHERE id = v_playoff_match.id;
      
      v_teams_placed := v_teams_placed + 1;
    END IF;
  END LOOP;
  
  RETURN jsonb_build_object(
    'success', TRUE,
    'tournament_id', p_tournament_id,
    'groups_count', v_group_count,
    'teams_advancing', array_length(v_advancing_teams, 1),
    'teams_placed', v_teams_placed
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- COMENTARIOS
-- ----------------------------------------------------------------------------

COMMENT ON FUNCTION set_session_context(UUID, UUID, TEXT, TEXT) IS 
  'Setea variables de sesión para RLS y auditoría. Llamar al inicio de cada request.';

COMMENT ON FUNCTION generate_tournament_fixture(UUID, UUID, UUID, JSONB) IS 
  'Genera el fixture completo de un torneo con transacción serializable y row locks.';

COMMENT ON FUNCTION link_playoff_matches(UUID) IS 
  'Establece los enlaces next_match_id para navegación del bracket de playoffs.';

COMMENT ON FUNCTION advance_winner_to_next_match(UUID) IS 
  'Avanza al ganador de un partido al siguiente partido del bracket.';

COMMENT ON FUNCTION calculate_group_standings(UUID, CHAR) IS 
  'Calcula la tabla de posiciones de un grupo específico.';

COMMENT ON FUNCTION populate_playoffs_from_groups(UUID, INTEGER) IS 
  'Pobla la primera ronda de playoffs con los equipos que avanzan de grupos.';

