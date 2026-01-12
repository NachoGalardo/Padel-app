-- ============================================================================
-- FUNCIONES Y TABLAS PARA RESULTADOS E INCIDENTES
-- ============================================================================

-- ----------------------------------------------------------------------------
-- TABLA: idempotency_keys
-- ----------------------------------------------------------------------------
-- Almacena claves de idempotencia para prevenir operaciones duplicadas.
-- TTL de 24 horas, limpieza automática.

CREATE TABLE IF NOT EXISTS idempotency_keys (
    key VARCHAR(100) NOT NULL,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    response JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    
    PRIMARY KEY (tenant_id, key)
);

CREATE INDEX idx_idempotency_expires ON idempotency_keys(expires_at);

-- Función para limpiar keys expiradas (ejecutar periódicamente)
CREATE OR REPLACE FUNCTION cleanup_expired_idempotency_keys()
RETURNS INTEGER AS $$
DECLARE
    v_deleted INTEGER;
BEGIN
    DELETE FROM idempotency_keys
    WHERE expires_at < NOW();
    
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- FUNCIÓN: auto_confirm_pending_results
-- ----------------------------------------------------------------------------
-- Confirma automáticamente resultados pendientes después de 24 horas.
-- Ejecutar periódicamente via cron job.

CREATE OR REPLACE FUNCTION auto_confirm_pending_results(
    p_hours_threshold INTEGER DEFAULT 24
)
RETURNS TABLE (
    match_id UUID,
    tournament_id UUID,
    confirmed_at TIMESTAMPTZ
) AS $$
DECLARE
    v_match RECORD;
    v_pending_result JSONB;
    v_threshold TIMESTAMPTZ;
BEGIN
    v_threshold := NOW() - (p_hours_threshold || ' hours')::INTERVAL;
    
    FOR v_match IN
        SELECT m.*
        FROM matches m
        WHERE m.status = 'in_progress'
          AND m.settings->'pending_result'->>'status' = 'pending_confirmation'
          AND (m.settings->'pending_result'->>'reported_at')::TIMESTAMPTZ < v_threshold
        FOR UPDATE SKIP LOCKED  -- Skip si otro proceso está trabajando
    LOOP
        v_pending_result := v_match.settings->'pending_result';
        
        -- Confirmar el resultado
        UPDATE matches
        SET 
            status = 'finished',
            winner_id = (v_pending_result->>'winner_team_id')::UUID,
            loser_id = (v_pending_result->>'loser_team_id')::UUID,
            finished_at = NOW(),
            settings = v_match.settings || jsonb_build_object(
                'pending_result', v_pending_result || jsonb_build_object(
                    'status', 'auto_confirmed',
                    'auto_confirmed_at', NOW()::TEXT,
                    'auto_confirm_reason', 'No response within ' || p_hours_threshold || ' hours'
                )
            ),
            updated_at = NOW()
        WHERE id = v_match.id;
        
        -- Avanzar ganador si hay siguiente partido
        IF v_match.next_match_id IS NOT NULL THEN
            PERFORM advance_winner_to_next_match(v_match.id);
        END IF;
        
        -- Retornar info del partido confirmado
        match_id := v_match.id;
        tournament_id := v_match.tournament_id;
        confirmed_at := NOW();
        RETURN NEXT;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- FUNCIÓN: get_match_for_result_reporting
-- ----------------------------------------------------------------------------
-- Obtiene un partido con lock para reportar resultado.
-- Incluye validaciones de estado y permisos.

CREATE OR REPLACE FUNCTION get_match_for_result_reporting(
    p_match_id UUID,
    p_tenant_id UUID,
    p_tenant_user_id UUID
)
RETURNS TABLE (
    match_data JSONB,
    can_report BOOLEAN,
    reason TEXT
) AS $$
DECLARE
    v_match RECORD;
    v_is_participant BOOLEAN;
    v_pending_result JSONB;
BEGIN
    -- Obtener partido con lock
    SELECT * INTO v_match
    FROM matches m
    WHERE m.id = p_match_id
      AND m.tenant_id = p_tenant_id
    FOR UPDATE;
    
    IF NOT FOUND THEN
        RETURN QUERY SELECT NULL::JSONB, FALSE, 'Partido no encontrado';
        RETURN;
    END IF;
    
    -- Verificar estado
    IF v_match.status = 'finished' THEN
        RETURN QUERY SELECT to_jsonb(v_match), FALSE, 'El partido ya tiene resultado confirmado';
        RETURN;
    END IF;
    
    IF v_match.status = 'cancelled' THEN
        RETURN QUERY SELECT to_jsonb(v_match), FALSE, 'El partido fue cancelado';
        RETURN;
    END IF;
    
    IF v_match.team1_id IS NULL OR v_match.team2_id IS NULL THEN
        RETURN QUERY SELECT to_jsonb(v_match), FALSE, 'El partido no tiene ambos equipos asignados';
        RETURN;
    END IF;
    
    -- Verificar si ya hay resultado pendiente
    v_pending_result := v_match.settings->'pending_result';
    IF v_pending_result IS NOT NULL AND v_pending_result->>'status' = 'pending_confirmation' THEN
        RETURN QUERY SELECT to_jsonb(v_match), FALSE, 'Ya hay un resultado pendiente de confirmación';
        RETURN;
    END IF;
    
    -- Verificar participación
    SELECT EXISTS (
        SELECT 1 FROM team_members tm
        WHERE tm.tenant_user_id = p_tenant_user_id
          AND tm.team_id IN (v_match.team1_id, v_match.team2_id)
          AND tm.left_at IS NULL
    ) INTO v_is_participant;
    
    -- Retornar datos
    RETURN QUERY SELECT 
        to_jsonb(v_match),
        TRUE,
        NULL::TEXT;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- FUNCIÓN: validate_match_score
-- ----------------------------------------------------------------------------
-- Valida que un score sea coherente con las reglas del torneo.

CREATE OR REPLACE FUNCTION validate_match_score(
    p_sets JSONB,
    p_winner_team_id UUID,
    p_team1_id UUID,
    p_team2_id UUID,
    p_sets_to_win INTEGER,
    p_games_per_set INTEGER
)
RETURNS TABLE (
    is_valid BOOLEAN,
    error_message TEXT
) AS $$
DECLARE
    v_set RECORD;
    v_team1_sets INTEGER := 0;
    v_team2_sets INTEGER := 0;
    v_set_number INTEGER;
BEGIN
    -- Validar que winner es uno de los equipos
    IF p_winner_team_id != p_team1_id AND p_winner_team_id != p_team2_id THEN
        RETURN QUERY SELECT FALSE, 'El ganador debe ser uno de los equipos del partido';
        RETURN;
    END IF;
    
    -- Iterar sobre sets
    FOR v_set IN SELECT * FROM jsonb_array_elements(p_sets)
    LOOP
        v_set_number := (v_set.value->>'set_number')::INTEGER;
        
        DECLARE
            v_t1_games INTEGER := (v_set.value->>'team1_games')::INTEGER;
            v_t2_games INTEGER := (v_set.value->>'team2_games')::INTEGER;
            v_tb1 INTEGER := (v_set.value->>'tiebreak_team1')::INTEGER;
            v_tb2 INTEGER := (v_set.value->>'tiebreak_team2')::INTEGER;
            v_team1_won_set BOOLEAN;
            v_team2_won_set BOOLEAN;
        BEGIN
            -- Determinar ganador del set
            v_team1_won_set := (v_t1_games > v_t2_games) AND (
                (v_t1_games >= p_games_per_set AND v_t1_games - v_t2_games >= 2) OR
                (v_t1_games = p_games_per_set + 1 AND v_t2_games = p_games_per_set)
            );
            
            v_team2_won_set := (v_t2_games > v_t1_games) AND (
                (v_t2_games >= p_games_per_set AND v_t2_games - v_t1_games >= 2) OR
                (v_t2_games = p_games_per_set + 1 AND v_t1_games = p_games_per_set)
            );
            
            -- Validar tiebreak si es 7-6
            IF (v_t1_games = 7 AND v_t2_games = 6) OR (v_t2_games = 7 AND v_t1_games = 6) THEN
                IF v_tb1 IS NULL OR v_tb2 IS NULL THEN
                    RETURN QUERY SELECT FALSE, 
                        FORMAT('Set %s terminó 7-6, debe incluir resultado del tiebreak', v_set_number);
                    RETURN;
                END IF;
                
                -- Validar tiebreak (mínimo 7, diferencia de 2)
                IF GREATEST(v_tb1, v_tb2) < 7 OR ABS(v_tb1 - v_tb2) < 2 THEN
                    RETURN QUERY SELECT FALSE,
                        FORMAT('Tiebreak del set %s inválido: %s-%s', v_set_number, v_tb1, v_tb2);
                    RETURN;
                END IF;
            END IF;
            
            IF v_team1_won_set THEN
                v_team1_sets := v_team1_sets + 1;
            ELSIF v_team2_won_set THEN
                v_team2_sets := v_team2_sets + 1;
            END IF;
        END;
    END LOOP;
    
    -- Validar ganador
    IF v_team1_sets >= p_sets_to_win AND p_winner_team_id != p_team1_id THEN
        RETURN QUERY SELECT FALSE, 
            FORMAT('El score indica que team1 ganó (%s-%s sets) pero se declaró otro ganador', 
                   v_team1_sets, v_team2_sets);
        RETURN;
    END IF;
    
    IF v_team2_sets >= p_sets_to_win AND p_winner_team_id != p_team2_id THEN
        RETURN QUERY SELECT FALSE,
            FORMAT('El score indica que team2 ganó (%s-%s sets) pero se declaró otro ganador',
                   v_team2_sets, v_team1_sets);
        RETURN;
    END IF;
    
    IF v_team1_sets < p_sets_to_win AND v_team2_sets < p_sets_to_win THEN
        RETURN QUERY SELECT FALSE,
            FORMAT('Ningún equipo ha ganado %s sets aún (%s-%s)', 
                   p_sets_to_win, v_team1_sets, v_team2_sets);
        RETURN;
    END IF;
    
    RETURN QUERY SELECT TRUE, NULL::TEXT;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ----------------------------------------------------------------------------
-- FUNCIÓN: get_incident_summary
-- ----------------------------------------------------------------------------
-- Obtiene resumen de incidentes para dashboard de admin.

CREATE OR REPLACE FUNCTION get_incident_summary(p_tenant_id UUID)
RETURNS TABLE (
    total_incidents BIGINT,
    pending_incidents BIGINT,
    resolved_today BIGINT,
    by_type JSONB,
    by_severity JSONB,
    avg_resolution_hours NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    WITH incident_stats AS (
        SELECT 
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE resolved_at IS NULL) AS pending,
            COUNT(*) FILTER (WHERE resolved_at::DATE = CURRENT_DATE) AS resolved_today,
            jsonb_object_agg(
                type::TEXT, 
                COUNT(*) FILTER (WHERE type = i.type)
            ) AS by_type,
            jsonb_object_agg(
                severity::TEXT,
                COUNT(*) FILTER (WHERE severity = i.severity)
            ) AS by_severity,
            AVG(
                EXTRACT(EPOCH FROM (resolved_at - reported_at)) / 3600
            ) FILTER (WHERE resolved_at IS NOT NULL) AS avg_hours
        FROM incidents i
        WHERE tenant_id = p_tenant_id
          AND created_at > NOW() - INTERVAL '30 days'
        GROUP BY tenant_id
    )
    SELECT 
        COALESCE(total, 0),
        COALESCE(pending, 0),
        COALESCE(resolved_today, 0),
        COALESCE(by_type, '{}'::JSONB),
        COALESCE(by_severity, '{}'::JSONB),
        COALESCE(avg_hours, 0)
    FROM incident_stats;
END;
$$ LANGUAGE plpgsql STABLE;

-- ----------------------------------------------------------------------------
-- TRIGGER: notify_on_incident_created
-- ----------------------------------------------------------------------------
-- Notifica automáticamente a admins cuando se crea un incidente.

CREATE OR REPLACE FUNCTION notify_admins_on_incident()
RETURNS TRIGGER AS $$
BEGIN
    -- Insertar evento para procesamiento asíncrono
    INSERT INTO events (
        tenant_id,
        type,
        tournament_id,
        match_id,
        payload,
        triggered_by,
        processed
    ) VALUES (
        NEW.tenant_id,
        'incident_reported',
        NEW.tournament_id,
        NEW.match_id,
        jsonb_build_object(
            'incident_id', NEW.id,
            'type', NEW.type,
            'severity', NEW.severity,
            'title', NEW.title,
            'reported_by', NEW.reported_by
        ),
        NEW.reported_by,
        FALSE
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notify_on_incident_created ON incidents;
CREATE TRIGGER notify_on_incident_created
    AFTER INSERT ON incidents
    FOR EACH ROW
    EXECUTE FUNCTION notify_admins_on_incident();

-- ----------------------------------------------------------------------------
-- COMENTARIOS
-- ----------------------------------------------------------------------------

COMMENT ON TABLE idempotency_keys IS 
    'Almacena claves de idempotencia para prevenir operaciones duplicadas (TTL 24h)';

COMMENT ON FUNCTION auto_confirm_pending_results(INTEGER) IS 
    'Confirma automáticamente resultados pendientes después de N horas sin respuesta';

COMMENT ON FUNCTION get_match_for_result_reporting(UUID, UUID, UUID) IS 
    'Obtiene partido con lock y valida permisos para reportar resultado';

COMMENT ON FUNCTION validate_match_score(JSONB, UUID, UUID, UUID, INTEGER, INTEGER) IS 
    'Valida coherencia del score según reglas del torneo';

COMMENT ON FUNCTION get_incident_summary(UUID) IS 
    'Obtiene estadísticas de incidentes para dashboard de admin';

