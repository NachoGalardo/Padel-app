-- ============================================================================
-- PADEL TOURNAMENT SAAS - ROW LEVEL SECURITY POLICIES
-- ============================================================================
-- Principios:
--   1. Aislamiento estricto por tenant
--   2. El backend NUNCA confía en el cliente
--   3. Contexto de sesión define tenant_id y profile_id
--   4. Players tienen permisos mínimos (solo lectura + su propia data)
--   5. Admins/Owners gestionan todo dentro de su tenant
--   6. Escalamiento de rol PROHIBIDO desde la DB
-- ============================================================================

-- ----------------------------------------------------------------------------
-- FUNCIONES HELPER PARA RLS
-- ----------------------------------------------------------------------------

-- Obtiene el profile_id del usuario autenticado (seteado por el backend)
CREATE OR REPLACE FUNCTION auth.current_profile_id()
RETURNS UUID AS $$
    SELECT NULLIF(current_setting('app.current_profile_id', TRUE), '')::UUID;
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- Obtiene el tenant_id del contexto actual (seteado por el backend)
CREATE OR REPLACE FUNCTION auth.current_tenant_id()
RETURNS UUID AS $$
    SELECT NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID;
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- Obtiene el rol del usuario en el tenant actual
CREATE OR REPLACE FUNCTION auth.current_role()
RETURNS member_role AS $$
    SELECT role FROM tenant_users
    WHERE tenant_id = auth.current_tenant_id()
      AND profile_id = auth.current_profile_id()
      AND status = 'active'
    LIMIT 1;
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- Verifica si el usuario es admin o owner en el tenant actual
CREATE OR REPLACE FUNCTION auth.is_admin_or_owner()
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM tenant_users
        WHERE tenant_id = auth.current_tenant_id()
          AND profile_id = auth.current_profile_id()
          AND status = 'active'
          AND role IN ('admin', 'owner')
    );
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- Verifica si el usuario es owner en el tenant actual
CREATE OR REPLACE FUNCTION auth.is_owner()
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM tenant_users
        WHERE tenant_id = auth.current_tenant_id()
          AND profile_id = auth.current_profile_id()
          AND status = 'active'
          AND role = 'owner'
    );
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- Verifica si el usuario es miembro activo del tenant actual
CREATE OR REPLACE FUNCTION auth.is_tenant_member()
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM tenant_users
        WHERE tenant_id = auth.current_tenant_id()
          AND profile_id = auth.current_profile_id()
          AND status = 'active'
    );
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- Obtiene el tenant_user_id del usuario en el tenant actual
CREATE OR REPLACE FUNCTION auth.current_tenant_user_id()
RETURNS UUID AS $$
    SELECT id FROM tenant_users
    WHERE tenant_id = auth.current_tenant_id()
      AND profile_id = auth.current_profile_id()
      AND status = 'active'
    LIMIT 1;
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- HABILITAR RLS EN TODAS LAS TABLAS
-- ----------------------------------------------------------------------------

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE rankings ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- Forzar RLS incluso para table owners (importante para seguridad)
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_users FORCE ROW LEVEL SECURITY;
ALTER TABLE teams FORCE ROW LEVEL SECURITY;
ALTER TABLE team_members FORCE ROW LEVEL SECURITY;
ALTER TABLE tournaments FORCE ROW LEVEL SECURITY;
ALTER TABLE tournament_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE matches FORCE ROW LEVEL SECURITY;
ALTER TABLE match_results FORCE ROW LEVEL SECURITY;
ALTER TABLE incidents FORCE ROW LEVEL SECURITY;
ALTER TABLE rankings FORCE ROW LEVEL SECURITY;
ALTER TABLE player_history FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE events FORCE ROW LEVEL SECURITY;

-- ============================================================================
-- POLÍTICAS POR TABLA
-- ============================================================================

-- ----------------------------------------------------------------------------
-- TENANTS
-- ----------------------------------------------------------------------------
-- Solo lectura para miembros del tenant
-- Solo owner puede actualizar configuración del tenant
-- Nadie puede crear/eliminar tenants via RLS (solo backend con rol elevado)

CREATE POLICY tenants_select ON tenants
    FOR SELECT
    USING (
        id = auth.current_tenant_id()
        AND deleted_at IS NULL
    );

CREATE POLICY tenants_update ON tenants
    FOR UPDATE
    USING (
        id = auth.current_tenant_id()
        AND auth.is_owner()
    )
    WITH CHECK (
        id = auth.current_tenant_id()
        AND auth.is_owner()
        -- No permitir cambiar el slug (podría romper URLs)
        AND slug = (SELECT slug FROM tenants WHERE id = auth.current_tenant_id())
    );

-- INSERT y DELETE solo via backend con BYPASSRLS

-- ----------------------------------------------------------------------------
-- PROFILES
-- ----------------------------------------------------------------------------
-- Cada usuario puede ver y editar solo su propio perfil
-- Admins pueden ver perfiles de miembros de su tenant (para gestión)

CREATE POLICY profiles_select_own ON profiles
    FOR SELECT
    USING (id = auth.current_profile_id());

CREATE POLICY profiles_select_tenant_members ON profiles
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM tenant_users
            WHERE tenant_users.profile_id = profiles.id
              AND tenant_users.tenant_id = auth.current_tenant_id()
              AND tenant_users.status = 'active'
        )
    );

CREATE POLICY profiles_update_own ON profiles
    FOR UPDATE
    USING (id = auth.current_profile_id())
    WITH CHECK (
        id = auth.current_profile_id()
        -- No permitir cambiar auth_provider (seguridad)
        AND auth_provider = (SELECT auth_provider FROM profiles WHERE id = auth.current_profile_id())
    );

-- INSERT solo via backend (registro)

-- ----------------------------------------------------------------------------
-- TENANT_USERS
-- ----------------------------------------------------------------------------
-- Todos los miembros pueden ver otros miembros del tenant
-- Solo owner puede cambiar roles
-- Solo admin+ puede invitar/suspender
-- CRÍTICO: Nadie puede escalar su propio rol

CREATE POLICY tenant_users_select ON tenant_users
    FOR SELECT
    USING (tenant_id = auth.current_tenant_id());

CREATE POLICY tenant_users_insert ON tenant_users
    FOR INSERT
    WITH CHECK (
        tenant_id = auth.current_tenant_id()
        AND auth.is_admin_or_owner()
        -- Solo puede crear players o admins (si es owner)
        AND (
            role = 'player'
            OR (role = 'admin' AND auth.is_owner())
        )
        -- No puede crear owners
        AND role != 'owner'
    );

CREATE POLICY tenant_users_update ON tenant_users
    FOR UPDATE
    USING (tenant_id = auth.current_tenant_id())
    WITH CHECK (
        tenant_id = auth.current_tenant_id()
        AND (
            -- Owner puede actualizar cualquier miembro (excepto owners)
            (auth.is_owner() AND role != 'owner')
            OR
            -- Admin puede actualizar players
            (auth.is_admin_or_owner() AND role = 'player')
            OR
            -- Usuario puede actualizar su propio display_name y level
            (profile_id = auth.current_profile_id())
        )
        -- CRÍTICO: Nadie puede cambiar su propio rol
        AND (
            profile_id != auth.current_profile_id()
            OR role = (SELECT role FROM tenant_users WHERE id = tenant_users.id)
        )
        -- No se puede cambiar el tenant_id
        AND tenant_id = (SELECT tenant_id FROM tenant_users WHERE id = tenant_users.id)
        -- No se puede cambiar el profile_id
        AND profile_id = (SELECT profile_id FROM tenant_users WHERE id = tenant_users.id)
    );

CREATE POLICY tenant_users_delete ON tenant_users
    FOR DELETE
    USING (
        tenant_id = auth.current_tenant_id()
        AND auth.is_owner()
        -- No puede eliminar al owner
        AND role != 'owner'
        -- No puede eliminarse a sí mismo
        AND profile_id != auth.current_profile_id()
    );

-- ----------------------------------------------------------------------------
-- TEAMS
-- ----------------------------------------------------------------------------
-- Todos los miembros pueden ver equipos del tenant
-- Solo admin+ puede crear/modificar equipos

CREATE POLICY teams_select ON teams
    FOR SELECT
    USING (tenant_id = auth.current_tenant_id());

CREATE POLICY teams_insert ON teams
    FOR INSERT
    WITH CHECK (
        tenant_id = auth.current_tenant_id()
        AND auth.is_admin_or_owner()
    );

CREATE POLICY teams_update ON teams
    FOR UPDATE
    USING (tenant_id = auth.current_tenant_id())
    WITH CHECK (
        tenant_id = auth.current_tenant_id()
        AND auth.is_admin_or_owner()
    );

CREATE POLICY teams_delete ON teams
    FOR DELETE
    USING (
        tenant_id = auth.current_tenant_id()
        AND auth.is_admin_or_owner()
    );

-- ----------------------------------------------------------------------------
-- TEAM_MEMBERS
-- ----------------------------------------------------------------------------
-- Todos pueden ver miembros de equipos
-- Admin+ puede gestionar
-- Player puede ver si es parte del equipo

CREATE POLICY team_members_select ON team_members
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM teams
            WHERE teams.id = team_members.team_id
              AND teams.tenant_id = auth.current_tenant_id()
        )
    );

CREATE POLICY team_members_insert ON team_members
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM teams
            WHERE teams.id = team_members.team_id
              AND teams.tenant_id = auth.current_tenant_id()
        )
        AND auth.is_admin_or_owner()
    );

CREATE POLICY team_members_update ON team_members
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM teams
            WHERE teams.id = team_members.team_id
              AND teams.tenant_id = auth.current_tenant_id()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM teams
            WHERE teams.id = team_members.team_id
              AND teams.tenant_id = auth.current_tenant_id()
        )
        AND auth.is_admin_or_owner()
    );

CREATE POLICY team_members_delete ON team_members
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM teams
            WHERE teams.id = team_members.team_id
              AND teams.tenant_id = auth.current_tenant_id()
        )
        AND auth.is_admin_or_owner()
    );

-- ----------------------------------------------------------------------------
-- TOURNAMENTS
-- ----------------------------------------------------------------------------
-- Todos los miembros pueden ver torneos del tenant
-- Solo admin+ puede crear/modificar torneos

CREATE POLICY tournaments_select ON tournaments
    FOR SELECT
    USING (tenant_id = auth.current_tenant_id());

CREATE POLICY tournaments_insert ON tournaments
    FOR INSERT
    WITH CHECK (
        tenant_id = auth.current_tenant_id()
        AND auth.is_admin_or_owner()
        AND created_by = auth.current_tenant_user_id()
    );

CREATE POLICY tournaments_update ON tournaments
    FOR UPDATE
    USING (tenant_id = auth.current_tenant_id())
    WITH CHECK (
        tenant_id = auth.current_tenant_id()
        AND auth.is_admin_or_owner()
        -- No cambiar created_by
        AND created_by = (SELECT created_by FROM tournaments WHERE id = tournaments.id)
    );

CREATE POLICY tournaments_delete ON tournaments
    FOR DELETE
    USING (
        tenant_id = auth.current_tenant_id()
        AND auth.is_admin_or_owner()
        -- Solo torneos en draft pueden eliminarse
        AND status = 'draft'
    );

-- ----------------------------------------------------------------------------
-- TOURNAMENT_ENTRIES
-- ----------------------------------------------------------------------------
-- Todos pueden ver inscripciones
-- Admin+ puede gestionar todas las inscripciones
-- Player puede inscribir su propio equipo

CREATE POLICY entries_select ON tournament_entries
    FOR SELECT
    USING (tenant_id = auth.current_tenant_id());

CREATE POLICY entries_insert_admin ON tournament_entries
    FOR INSERT
    WITH CHECK (
        tenant_id = auth.current_tenant_id()
        AND (
            -- Admin puede inscribir cualquier equipo
            auth.is_admin_or_owner()
            OR
            -- Player puede inscribir su propio equipo
            EXISTS (
                SELECT 1 FROM team_members
                WHERE team_members.team_id = tournament_entries.team_id
                  AND team_members.tenant_user_id = auth.current_tenant_user_id()
                  AND team_members.left_at IS NULL
            )
        )
    );

CREATE POLICY entries_update ON tournament_entries
    FOR UPDATE
    USING (tenant_id = auth.current_tenant_id())
    WITH CHECK (
        tenant_id = auth.current_tenant_id()
        AND auth.is_admin_or_owner()
    );

CREATE POLICY entries_delete ON tournament_entries
    FOR DELETE
    USING (
        tenant_id = auth.current_tenant_id()
        AND auth.is_admin_or_owner()
        -- Solo inscripciones pendientes pueden eliminarse
        AND status IN ('pending_payment', 'waitlist')
    );

-- ----------------------------------------------------------------------------
-- MATCHES
-- ----------------------------------------------------------------------------
-- Todos pueden ver partidos
-- Solo admin+ puede crear/modificar partidos

CREATE POLICY matches_select ON matches
    FOR SELECT
    USING (tenant_id = auth.current_tenant_id());

CREATE POLICY matches_insert ON matches
    FOR INSERT
    WITH CHECK (
        tenant_id = auth.current_tenant_id()
        AND auth.is_admin_or_owner()
    );

CREATE POLICY matches_update ON matches
    FOR UPDATE
    USING (tenant_id = auth.current_tenant_id())
    WITH CHECK (
        tenant_id = auth.current_tenant_id()
        AND auth.is_admin_or_owner()
    );

CREATE POLICY matches_delete ON matches
    FOR DELETE
    USING (
        tenant_id = auth.current_tenant_id()
        AND auth.is_admin_or_owner()
        -- Solo partidos no jugados pueden eliminarse
        AND status IN ('scheduled', 'cancelled')
    );

-- ----------------------------------------------------------------------------
-- MATCH_RESULTS
-- ----------------------------------------------------------------------------
-- Todos pueden ver resultados
-- Solo admin+ puede cargar/modificar resultados

CREATE POLICY match_results_select ON match_results
    FOR SELECT
    USING (tenant_id = auth.current_tenant_id());

CREATE POLICY match_results_insert ON match_results
    FOR INSERT
    WITH CHECK (
        tenant_id = auth.current_tenant_id()
        AND auth.is_admin_or_owner()
    );

CREATE POLICY match_results_update ON match_results
    FOR UPDATE
    USING (tenant_id = auth.current_tenant_id())
    WITH CHECK (
        tenant_id = auth.current_tenant_id()
        AND auth.is_admin_or_owner()
    );

CREATE POLICY match_results_delete ON match_results
    FOR DELETE
    USING (
        tenant_id = auth.current_tenant_id()
        AND auth.is_admin_or_owner()
    );

-- ----------------------------------------------------------------------------
-- INCIDENTS
-- ----------------------------------------------------------------------------
-- Todos pueden ver incidentes (transparencia)
-- Admin+ puede crear/resolver incidentes
-- Player puede reportar incidentes

CREATE POLICY incidents_select ON incidents
    FOR SELECT
    USING (tenant_id = auth.current_tenant_id());

CREATE POLICY incidents_insert ON incidents
    FOR INSERT
    WITH CHECK (
        tenant_id = auth.current_tenant_id()
        AND auth.is_tenant_member()
        AND reported_by = auth.current_tenant_user_id()
    );

CREATE POLICY incidents_update ON incidents
    FOR UPDATE
    USING (tenant_id = auth.current_tenant_id())
    WITH CHECK (
        tenant_id = auth.current_tenant_id()
        AND auth.is_admin_or_owner()
    );

-- No DELETE - incidentes son registro histórico

-- ----------------------------------------------------------------------------
-- RANKINGS
-- ----------------------------------------------------------------------------
-- Todos pueden ver rankings
-- Solo sistema (backend) puede modificar rankings

CREATE POLICY rankings_select ON rankings
    FOR SELECT
    USING (tenant_id = auth.current_tenant_id());

-- INSERT/UPDATE/DELETE solo via backend con BYPASSRLS
-- Los rankings se calculan automáticamente

-- ----------------------------------------------------------------------------
-- PLAYER_HISTORY
-- ----------------------------------------------------------------------------
-- Players pueden ver su propio historial
-- Admin+ puede ver historial de todos

CREATE POLICY player_history_select_own ON player_history
    FOR SELECT
    USING (
        tenant_id = auth.current_tenant_id()
        AND (
            tenant_user_id = auth.current_tenant_user_id()
            OR auth.is_admin_or_owner()
        )
    );

-- INSERT/UPDATE/DELETE solo via backend con BYPASSRLS

-- ----------------------------------------------------------------------------
-- AUDIT_LOGS
-- ----------------------------------------------------------------------------
-- Solo admin+ puede ver logs de auditoría
-- Nadie puede modificar logs (append-only)

CREATE POLICY audit_logs_select ON audit_logs
    FOR SELECT
    USING (
        tenant_id = auth.current_tenant_id()
        AND auth.is_admin_or_owner()
    );

-- INSERT solo via backend con BYPASSRLS
-- UPDATE/DELETE prohibidos (append-only)

-- ----------------------------------------------------------------------------
-- EVENTS
-- ----------------------------------------------------------------------------
-- Solo admin+ puede ver eventos
-- Solo sistema puede crear eventos

CREATE POLICY events_select ON events
    FOR SELECT
    USING (
        tenant_id = auth.current_tenant_id()
        AND auth.is_admin_or_owner()
    );

-- INSERT/UPDATE solo via backend con BYPASSRLS

-- ============================================================================
-- ROL DE SERVICIO (BACKEND)
-- ============================================================================
-- El backend usa un rol con BYPASSRLS para operaciones privilegiadas

-- Crear rol de servicio (ejecutar como superuser)
-- CREATE ROLE padel_service WITH LOGIN PASSWORD 'secure_password' BYPASSRLS;
-- GRANT ALL ON ALL TABLES IN SCHEMA public TO padel_service;
-- GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO padel_service;

-- Crear rol de aplicación (usado por conexiones normales)
-- CREATE ROLE padel_app WITH LOGIN PASSWORD 'app_password';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO padel_app;
-- GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO padel_app;

-- ============================================================================
-- CÓMO USAR DESDE EL BACKEND
-- ============================================================================
-- 
-- El backend DEBE setear las variables de sesión antes de cada operación:
--
-- // Ejemplo en Node.js con pg
-- await client.query(`
--     SET LOCAL app.current_profile_id = '${profileId}';
--     SET LOCAL app.current_tenant_id = '${tenantId}';
-- `);
--
-- // Luego ejecutar la query normal
-- await client.query('SELECT * FROM tournaments');
-- // Solo retornará torneos del tenant actual
--
-- IMPORTANTE:
-- - SET LOCAL solo afecta la transacción actual
-- - Siempre usar transacciones para agrupar SET + queries
-- - El backend valida JWT/sesión ANTES de setear las variables
-- - Nunca confiar en valores del cliente para setear estas variables

-- ============================================================================
-- COMENTARIOS DE DOCUMENTACIÓN
-- ============================================================================

COMMENT ON FUNCTION auth.current_profile_id() IS 'Retorna el profile_id del usuario autenticado desde la variable de sesión';
COMMENT ON FUNCTION auth.current_tenant_id() IS 'Retorna el tenant_id del contexto actual desde la variable de sesión';
COMMENT ON FUNCTION auth.current_role() IS 'Retorna el rol del usuario en el tenant actual';
COMMENT ON FUNCTION auth.is_admin_or_owner() IS 'Verifica si el usuario tiene permisos de administración';
COMMENT ON FUNCTION auth.is_owner() IS 'Verifica si el usuario es el owner del tenant';
COMMENT ON FUNCTION auth.is_tenant_member() IS 'Verifica si el usuario es miembro activo del tenant';

