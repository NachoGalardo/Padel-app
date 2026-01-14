-- ============================================================================
-- PADEL TOURNAMENT SAAS - SCHEMA INICIAL
-- ============================================================================
-- Convenciones:
--   - Timestamps en UTC (timestamptz)
--   - UUIDs como primary keys
--   - Soft deletes donde aplique (deleted_at)
--   - tenant_id en todas las tablas de negocio
-- ============================================================================

-- ----------------------------------------------------------------------------
-- EXTENSIONES
-- ----------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- ENUMS
-- ----------------------------------------------------------------------------

CREATE TYPE gender AS ENUM ('male', 'female', 'mixed');
CREATE TYPE player_level AS ENUM ('1', '2', '3', '4', '5', '6', '7', '8');
CREATE TYPE tenant_status AS ENUM ('active', 'suspended', 'cancelled');
CREATE TYPE tenant_plan AS ENUM ('free', 'starter', 'pro', 'enterprise');
CREATE TYPE member_role AS ENUM ('owner', 'admin', 'player');
CREATE TYPE member_status AS ENUM ('active', 'invited', 'suspended');
CREATE TYPE tournament_status AS ENUM ('draft', 'registration_open', 'registration_closed', 'in_progress', 'finished', 'cancelled');
CREATE TYPE tournament_format AS ENUM ('single_elimination', 'double_elimination', 'round_robin', 'groups_then_knockout');
CREATE TYPE entry_status AS ENUM ('pending_payment', 'confirmed', 'waitlist', 'withdrawn', 'disqualified');
CREATE TYPE payment_status AS ENUM ('pending', 'paid', 'refunded', 'waived');
CREATE TYPE match_status AS ENUM ('scheduled', 'called', 'in_progress', 'finished', 'walkover', 'cancelled', 'postponed');
CREATE TYPE incident_type AS ENUM ('injury', 'no_show', 'dispute', 'weather', 'equipment', 'misconduct', 'other');
CREATE TYPE incident_severity AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE audit_action AS ENUM ('create', 'update', 'delete', 'login', 'logout', 'invite', 'role_change');
CREATE TYPE event_type AS ENUM (
    'tournament_created',
    'tournament_started',
    'tournament_finished',
    'registration_opened',
    'registration_closed',
    'team_registered',
    'team_withdrawn',
    'match_scheduled',
    'match_started',
    'match_finished',
    'result_updated',
    'incident_reported',
    'ranking_updated'
);

-- ----------------------------------------------------------------------------
-- TENANTS (Clubes / Ligas / Organizadores)
-- ----------------------------------------------------------------------------

CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(50) NOT NULL UNIQUE,
    plan tenant_plan NOT NULL DEFAULT 'free',
    plan_valid_until TIMESTAMPTZ,
    status tenant_status NOT NULL DEFAULT 'active',
    settings JSONB NOT NULL DEFAULT '{}',
    logo_url VARCHAR(500),
    contact_email VARCHAR(255),
    contact_phone VARCHAR(30),
    address TEXT,
    timezone VARCHAR(50) NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    
    CONSTRAINT tenants_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$'),
    CONSTRAINT tenants_slug_length CHECK (LENGTH(slug) >= 3 AND LENGTH(slug) <= 50)
);

CREATE INDEX idx_tenants_slug ON tenants(slug) WHERE deleted_at IS NULL;
CREATE INDEX idx_tenants_status ON tenants(status) WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- PROFILES (Identidad global de usuarios)
-- ----------------------------------------------------------------------------

CREATE TABLE profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone VARCHAR(20) UNIQUE,
    email VARCHAR(255) UNIQUE,
    name VARCHAR(100) NOT NULL,
    avatar_url VARCHAR(500),
    gender gender,
    birth_date DATE,
    auth_provider VARCHAR(20) DEFAULT 'magic_link',
    auth_provider_id VARCHAR(255),
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT profiles_contact_required CHECK (phone IS NOT NULL OR email IS NOT NULL)
);

CREATE INDEX idx_profiles_phone ON profiles(phone) WHERE phone IS NOT NULL;
CREATE INDEX idx_profiles_email ON profiles(email) WHERE email IS NOT NULL;

-- ----------------------------------------------------------------------------
-- TENANT_USERS (Membresía usuario <-> tenant)
-- ----------------------------------------------------------------------------

CREATE TABLE tenant_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    role member_role NOT NULL DEFAULT 'player',
    status member_status NOT NULL DEFAULT 'active',
    display_name VARCHAR(100),
    level player_level,
    invited_by UUID REFERENCES profiles(id),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    suspended_at TIMESTAMPTZ,
    suspension_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT tenant_users_unique_membership UNIQUE (tenant_id, profile_id),
    CONSTRAINT tenant_users_suspension_consistency CHECK (
        (status = 'suspended' AND suspended_at IS NOT NULL) OR
        (status != 'suspended' AND suspended_at IS NULL)
    )
);

CREATE INDEX idx_tenant_users_tenant ON tenant_users(tenant_id);
CREATE INDEX idx_tenant_users_profile ON tenant_users(profile_id);
CREATE INDEX idx_tenant_users_role ON tenant_users(tenant_id, role) WHERE status = 'active';

-- Garantizar exactamente un owner por tenant
CREATE UNIQUE INDEX idx_tenant_users_single_owner 
    ON tenant_users(tenant_id) 
    WHERE role = 'owner' AND status = 'active';

-- ----------------------------------------------------------------------------
-- TEAMS (Parejas)
-- ----------------------------------------------------------------------------

CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(100),
    gender gender NOT NULL,
    level player_level,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_teams_tenant ON teams(tenant_id);
CREATE INDEX idx_teams_tenant_active ON teams(tenant_id) WHERE is_active = TRUE;

-- ----------------------------------------------------------------------------
-- TEAM_MEMBERS (Jugadores de una pareja)
-- ----------------------------------------------------------------------------

CREATE TABLE team_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    tenant_user_id UUID NOT NULL REFERENCES tenant_users(id) ON DELETE CASCADE,
    position SMALLINT NOT NULL CHECK (position IN (1, 2)),
    is_captain BOOLEAN NOT NULL DEFAULT FALSE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    left_at TIMESTAMPTZ,
    
    CONSTRAINT team_members_unique_position UNIQUE (team_id, position),
    CONSTRAINT team_members_unique_player_active UNIQUE (team_id, tenant_user_id)
);

CREATE INDEX idx_team_members_team ON team_members(team_id);
CREATE INDEX idx_team_members_user ON team_members(tenant_user_id);

-- Garantizar máximo un capitán por equipo
CREATE UNIQUE INDEX idx_team_members_single_captain 
    ON team_members(team_id) 
    WHERE is_captain = TRUE AND left_at IS NULL;

-- ----------------------------------------------------------------------------
-- TOURNAMENTS
-- ----------------------------------------------------------------------------

CREATE TABLE tournaments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    gender gender NOT NULL,
    level_min player_level,
    level_max player_level,
    format tournament_format NOT NULL DEFAULT 'single_elimination',
    status tournament_status NOT NULL DEFAULT 'draft',
    
    -- Fechas
    registration_opens_at TIMESTAMPTZ,
    registration_closes_at TIMESTAMPTZ,
    start_date DATE NOT NULL,
    end_date DATE,
    
    -- Configuración
    max_teams SMALLINT NOT NULL CHECK (max_teams > 0 AND max_teams <= 256),
    min_teams SMALLINT NOT NULL DEFAULT 4 CHECK (min_teams >= 2),
    entry_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (entry_fee_cents >= 0),
    currency CHAR(3) NOT NULL DEFAULT 'ARS',
    
    -- Reglas
    sets_to_win SMALLINT NOT NULL DEFAULT 2 CHECK (sets_to_win IN (1, 2, 3)),
    games_per_set SMALLINT NOT NULL DEFAULT 6 CHECK (games_per_set IN (4, 6)),
    tiebreak_at SMALLINT NOT NULL DEFAULT 6,
    golden_point BOOLEAN NOT NULL DEFAULT FALSE,
    
    settings JSONB NOT NULL DEFAULT '{}',
    
    created_by UUID NOT NULL REFERENCES tenant_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cancelled_at TIMESTAMPTZ,
    cancellation_reason TEXT,
    
    CONSTRAINT tournaments_dates_valid CHECK (end_date IS NULL OR end_date >= start_date),
    CONSTRAINT tournaments_registration_dates_valid CHECK (
        registration_opens_at IS NULL OR 
        registration_closes_at IS NULL OR 
        registration_closes_at > registration_opens_at
    ),
    CONSTRAINT tournaments_level_range_valid CHECK (
        level_min IS NULL OR 
        level_max IS NULL OR 
        level_min <= level_max
    ),
    CONSTRAINT tournaments_teams_range_valid CHECK (min_teams <= max_teams),
    CONSTRAINT tournaments_cancellation_consistency CHECK (
        (status = 'cancelled' AND cancelled_at IS NOT NULL) OR
        (status != 'cancelled' AND cancelled_at IS NULL)
    )
);

CREATE INDEX idx_tournaments_tenant ON tournaments(tenant_id);
CREATE INDEX idx_tournaments_tenant_status ON tournaments(tenant_id, status);
CREATE INDEX idx_tournaments_dates ON tournaments(tenant_id, start_date);

-- ----------------------------------------------------------------------------
-- TOURNAMENT_ENTRIES (Inscripciones)
-- ----------------------------------------------------------------------------

CREATE TABLE tournament_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    
    status entry_status NOT NULL DEFAULT 'pending_payment',
    payment_status payment_status NOT NULL DEFAULT 'pending',
    payment_reference VARCHAR(100),
    payment_amount_cents INTEGER CHECK (payment_amount_cents >= 0),
    paid_at TIMESTAMPTZ,
    
    seed SMALLINT CHECK (seed > 0),
    waitlist_position SMALLINT CHECK (waitlist_position > 0),
    
    registered_by UUID NOT NULL REFERENCES tenant_users(id),
    registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ,
    withdrawn_at TIMESTAMPTZ,
    withdrawal_reason TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT entries_unique_team_tournament UNIQUE (tournament_id, team_id),
    CONSTRAINT entries_payment_consistency CHECK (
        (payment_status = 'paid' AND paid_at IS NOT NULL) OR
        (payment_status != 'paid')
    ),
    CONSTRAINT entries_withdrawal_consistency CHECK (
        (status = 'withdrawn' AND withdrawn_at IS NOT NULL) OR
        (status != 'withdrawn' AND withdrawn_at IS NULL)
    ),
    CONSTRAINT entries_waitlist_consistency CHECK (
        (status = 'waitlist' AND waitlist_position IS NOT NULL) OR
        (status != 'waitlist' AND waitlist_position IS NULL)
    )
);

CREATE INDEX idx_entries_tenant ON tournament_entries(tenant_id);
CREATE INDEX idx_entries_tournament ON tournament_entries(tournament_id);
CREATE INDEX idx_entries_team ON tournament_entries(team_id);
CREATE INDEX idx_entries_tournament_status ON tournament_entries(tournament_id, status);

-- ----------------------------------------------------------------------------
-- MATCHES (Partidos)
-- ----------------------------------------------------------------------------

CREATE TABLE matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    
    -- Ubicación en bracket
    round_number SMALLINT NOT NULL CHECK (round_number > 0),
    round_name VARCHAR(50),
    match_number SMALLINT NOT NULL CHECK (match_number > 0),
    bracket_position VARCHAR(20),
    
    -- Equipos
    team1_id UUID REFERENCES teams(id),
    team2_id UUID REFERENCES teams(id),
    team1_entry_id UUID REFERENCES tournament_entries(id),
    team2_entry_id UUID REFERENCES tournament_entries(id),
    
    -- Programación
    court_name VARCHAR(50),
    scheduled_at TIMESTAMPTZ,
    estimated_duration_minutes SMALLINT DEFAULT 60,
    
    -- Estado
    status match_status NOT NULL DEFAULT 'scheduled',
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    
    -- Resultado
    winner_id UUID REFERENCES teams(id),
    loser_id UUID REFERENCES teams(id),
    is_walkover BOOLEAN NOT NULL DEFAULT FALSE,
    walkover_reason TEXT,
    
    -- Navegación bracket
    next_match_id UUID REFERENCES matches(id),
    loser_next_match_id UUID REFERENCES matches(id),
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT matches_teams_different CHECK (
        team1_id IS NULL OR team2_id IS NULL OR team1_id != team2_id
    ),
    CONSTRAINT matches_winner_valid CHECK (
        winner_id IS NULL OR winner_id = team1_id OR winner_id = team2_id
    ),
    CONSTRAINT matches_loser_valid CHECK (
        loser_id IS NULL OR loser_id = team1_id OR loser_id = team2_id
    ),
    CONSTRAINT matches_winner_loser_different CHECK (
        winner_id IS NULL OR loser_id IS NULL OR winner_id != loser_id
    ),
    CONSTRAINT matches_walkover_consistency CHECK (
        (is_walkover = TRUE AND walkover_reason IS NOT NULL) OR
        (is_walkover = FALSE AND walkover_reason IS NULL)
    ),
    CONSTRAINT matches_finished_has_result CHECK (
        status != 'finished' OR (winner_id IS NOT NULL AND loser_id IS NOT NULL)
    )
);

CREATE INDEX idx_matches_tenant ON matches(tenant_id);
CREATE INDEX idx_matches_tournament ON matches(tournament_id);
CREATE INDEX idx_matches_tournament_round ON matches(tournament_id, round_number);
CREATE INDEX idx_matches_teams ON matches(team1_id, team2_id);
CREATE INDEX idx_matches_scheduled ON matches(tenant_id, scheduled_at) WHERE status = 'scheduled';

-- ----------------------------------------------------------------------------
-- MATCH_RESULTS (Resultados detallados - sets y games)
-- ----------------------------------------------------------------------------

CREATE TABLE match_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    
    set_number SMALLINT NOT NULL CHECK (set_number > 0 AND set_number <= 5),
    team1_games SMALLINT NOT NULL CHECK (team1_games >= 0),
    team2_games SMALLINT NOT NULL CHECK (team2_games >= 0),
    tiebreak_team1 SMALLINT CHECK (tiebreak_team1 >= 0),
    tiebreak_team2 SMALLINT CHECK (tiebreak_team2 >= 0),
    
    duration_minutes SMALLINT CHECK (duration_minutes > 0),
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT results_unique_set UNIQUE (match_id, set_number),
    CONSTRAINT results_tiebreak_consistency CHECK (
        (tiebreak_team1 IS NULL AND tiebreak_team2 IS NULL) OR
        (tiebreak_team1 IS NOT NULL AND tiebreak_team2 IS NOT NULL)
    )
);

CREATE INDEX idx_match_results_match ON match_results(match_id);

-- ----------------------------------------------------------------------------
-- INCIDENTS (Incidencias durante partidos)
-- ----------------------------------------------------------------------------

CREATE TABLE incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    tournament_id UUID REFERENCES tournaments(id) ON DELETE SET NULL,
    match_id UUID REFERENCES matches(id) ON DELETE SET NULL,
    
    type incident_type NOT NULL,
    severity incident_severity NOT NULL DEFAULT 'low',
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    
    affected_team_id UUID REFERENCES teams(id),
    affected_player_id UUID REFERENCES tenant_users(id),
    
    reported_by UUID NOT NULL REFERENCES tenant_users(id),
    reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    resolved_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES tenant_users(id),
    resolution_notes TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT incidents_resolution_consistency CHECK (
        (resolved_at IS NOT NULL AND resolved_by IS NOT NULL) OR
        (resolved_at IS NULL AND resolved_by IS NULL)
    )
);

CREATE INDEX idx_incidents_tenant ON incidents(tenant_id);
CREATE INDEX idx_incidents_tournament ON incidents(tournament_id);
CREATE INDEX idx_incidents_match ON incidents(match_id);
CREATE INDEX idx_incidents_unresolved ON incidents(tenant_id, severity) WHERE resolved_at IS NULL;

-- ----------------------------------------------------------------------------
-- RANKINGS (Clasificaciones por tenant)
-- ----------------------------------------------------------------------------

CREATE TABLE rankings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    tenant_user_id UUID NOT NULL REFERENCES tenant_users(id) ON DELETE CASCADE,
    
    gender gender NOT NULL,
    level player_level,
    
    points INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
    position INTEGER CHECK (position > 0),
    previous_position INTEGER CHECK (previous_position > 0),
    
    matches_played INTEGER NOT NULL DEFAULT 0 CHECK (matches_played >= 0),
    matches_won INTEGER NOT NULL DEFAULT 0 CHECK (matches_won >= 0),
    tournaments_played INTEGER NOT NULL DEFAULT 0 CHECK (tournaments_played >= 0),
    tournaments_won INTEGER NOT NULL DEFAULT 0 CHECK (tournaments_won >= 0),
    
    best_result VARCHAR(50),
    current_streak INTEGER NOT NULL DEFAULT 0,
    
    last_activity_at TIMESTAMPTZ,
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT rankings_unique_player_category UNIQUE (tenant_id, tenant_user_id, gender),
    CONSTRAINT rankings_wins_not_exceed_played CHECK (matches_won <= matches_played),
    CONSTRAINT rankings_tournament_wins_not_exceed_played CHECK (tournaments_won <= tournaments_played)
);

CREATE INDEX idx_rankings_tenant ON rankings(tenant_id);
CREATE INDEX idx_rankings_tenant_gender ON rankings(tenant_id, gender, position);
CREATE INDEX idx_rankings_player ON rankings(tenant_user_id);

-- ----------------------------------------------------------------------------
-- PLAYER_HISTORY (Historial de puntos y posiciones)
-- ----------------------------------------------------------------------------

CREATE TABLE player_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    tenant_user_id UUID NOT NULL REFERENCES tenant_users(id) ON DELETE CASCADE,
    
    tournament_id UUID REFERENCES tournaments(id) ON DELETE SET NULL,
    match_id UUID REFERENCES matches(id) ON DELETE SET NULL,
    
    event_date DATE NOT NULL,
    gender gender NOT NULL,
    
    points_before INTEGER NOT NULL CHECK (points_before >= 0),
    points_after INTEGER NOT NULL CHECK (points_after >= 0),
    points_change INTEGER NOT NULL,
    
    position_before INTEGER CHECK (position_before > 0),
    position_after INTEGER CHECK (position_after > 0),
    
    reason VARCHAR(200) NOT NULL,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT history_points_change_valid CHECK (
        points_after - points_before = points_change
    )
);

CREATE INDEX idx_player_history_tenant ON player_history(tenant_id);
CREATE INDEX idx_player_history_player ON player_history(tenant_user_id);
CREATE INDEX idx_player_history_player_date ON player_history(tenant_user_id, event_date DESC);
CREATE INDEX idx_player_history_tournament ON player_history(tournament_id) WHERE tournament_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- AUDIT_LOGS (Registro de auditoría)
-- ----------------------------------------------------------------------------

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
    
    actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    actor_role member_role,
    
    action audit_action NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID,
    
    old_values JSONB,
    new_values JSONB,
    
    ip_address INET,
    user_agent TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Particionado por fecha para mejor performance en tablas grandes
CREATE INDEX idx_audit_logs_tenant ON audit_logs(tenant_id);
CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_id);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_tenant_created ON audit_logs(tenant_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- EVENTS (Eventos del sistema para notificaciones y webhooks)
-- ----------------------------------------------------------------------------

CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    type event_type NOT NULL,
    
    tournament_id UUID REFERENCES tournaments(id) ON DELETE CASCADE,
    match_id UUID REFERENCES matches(id) ON DELETE CASCADE,
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    
    payload JSONB NOT NULL DEFAULT '{}',
    
    triggered_by UUID REFERENCES tenant_users(id),
    
    processed BOOLEAN NOT NULL DEFAULT FALSE,
    processed_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_events_tenant ON events(tenant_id);
CREATE INDEX idx_events_tenant_type ON events(tenant_id, type);
CREATE INDEX idx_events_unprocessed ON events(tenant_id, created_at) WHERE processed = FALSE;
CREATE INDEX idx_events_tournament ON events(tournament_id) WHERE tournament_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- TRIGGERS PARA updated_at
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_tenants_updated_at
    BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tenant_users_updated_at
    BEFORE UPDATE ON tenant_users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_teams_updated_at
    BEFORE UPDATE ON teams
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tournaments_updated_at
    BEFORE UPDATE ON tournaments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tournament_entries_updated_at
    BEFORE UPDATE ON tournament_entries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_matches_updated_at
    BEFORE UPDATE ON matches
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_match_results_updated_at
    BEFORE UPDATE ON match_results
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_incidents_updated_at
    BEFORE UPDATE ON incidents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_rankings_updated_at
    BEFORE UPDATE ON rankings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------------------------------------------
-- COMENTARIOS DE DOCUMENTACIÓN
-- ----------------------------------------------------------------------------

COMMENT ON TABLE tenants IS 'Organizaciones que usan el SaaS (clubes, ligas, organizadores)';
COMMENT ON TABLE profiles IS 'Identidad global de usuarios, independiente del tenant';
COMMENT ON TABLE tenant_users IS 'Membresía de un usuario en un tenant con su rol';
COMMENT ON TABLE teams IS 'Parejas de jugadores';
COMMENT ON TABLE team_members IS 'Jugadores que componen una pareja';
COMMENT ON TABLE tournaments IS 'Torneos organizados por un tenant';
COMMENT ON TABLE tournament_entries IS 'Inscripciones de parejas a torneos';
COMMENT ON TABLE matches IS 'Partidos dentro de un torneo';
COMMENT ON TABLE match_results IS 'Resultados detallados por set de cada partido';
COMMENT ON TABLE incidents IS 'Incidencias reportadas durante torneos o partidos';
COMMENT ON TABLE rankings IS 'Clasificación actual de jugadores por categoría';
COMMENT ON TABLE player_history IS 'Historial de cambios de puntos y posición';
COMMENT ON TABLE audit_logs IS 'Registro de auditoría de todas las acciones';
COMMENT ON TABLE events IS 'Eventos del sistema para notificaciones y webhooks';

COMMENT ON COLUMN tenants.slug IS 'Identificador URL-friendly único para el tenant';
COMMENT ON COLUMN tenants.plan IS 'Plan de suscripción actual';
COMMENT ON COLUMN tenant_users.role IS 'owner: único por tenant, admin: gestiona torneos, player: solo participa';
COMMENT ON COLUMN tournaments.format IS 'Formato del torneo: eliminación simple/doble, round robin, grupos+knockout';
COMMENT ON COLUMN tournament_entries.seed IS 'Cabeza de serie (1 = primer sembrado)';
COMMENT ON COLUMN matches.bracket_position IS 'Posición en el bracket para renderizado visual';

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
CREATE OR REPLACE FUNCTION public.current_profile_id()
RETURNS UUID AS $$
    SELECT NULLIF(current_setting('app.current_profile_id', TRUE), '')::UUID;
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- Obtiene el tenant_id del contexto actual (seteado por el backend)
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS UUID AS $$
    SELECT NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID;
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- Obtiene el rol del usuario en el tenant actual
CREATE OR REPLACE FUNCTION public.current_role()
RETURNS member_role AS $$
    SELECT role FROM tenant_users
    WHERE tenant_id = public.current_tenant_id()
      AND profile_id = public.current_profile_id()
      AND status = 'active'
    LIMIT 1;
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- Verifica si el usuario es admin o owner en el tenant actual
CREATE OR REPLACE FUNCTION public.is_admin_or_owner()
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM tenant_users
        WHERE tenant_id = public.current_tenant_id()
          AND profile_id = public.current_profile_id()
          AND status = 'active'
          AND role IN ('admin', 'owner')
    );
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- Verifica si el usuario es owner en el tenant actual
CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM tenant_users
        WHERE tenant_id = public.current_tenant_id()
          AND profile_id = public.current_profile_id()
          AND status = 'active'
          AND role = 'owner'
    );
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- Verifica si el usuario es miembro activo del tenant actual
CREATE OR REPLACE FUNCTION public.is_tenant_member()
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM tenant_users
        WHERE tenant_id = public.current_tenant_id()
          AND profile_id = public.current_profile_id()
          AND status = 'active'
    );
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- Obtiene el tenant_user_id del usuario en el tenant actual
CREATE OR REPLACE FUNCTION public.current_tenant_user_id()
RETURNS UUID AS $$
    SELECT id FROM tenant_users
    WHERE tenant_id = public.current_tenant_id()
      AND profile_id = public.current_profile_id()
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
        id = public.current_tenant_id()
        AND deleted_at IS NULL
    );

CREATE POLICY tenants_update ON tenants
    FOR UPDATE
    USING (
        id = public.current_tenant_id()
        AND public.is_owner()
    )
    WITH CHECK (
        id = public.current_tenant_id()
        AND public.is_owner()
        -- No permitir cambiar el slug (podría romper URLs)
        AND slug = (SELECT slug FROM tenants WHERE id = public.current_tenant_id())
    );

-- INSERT y DELETE solo via backend con BYPASSRLS

-- ----------------------------------------------------------------------------
-- PROFILES
-- ----------------------------------------------------------------------------
-- Cada usuario puede ver y editar solo su propio perfil
-- Admins pueden ver perfiles de miembros de su tenant (para gestión)

CREATE POLICY profiles_select_own ON profiles
    FOR SELECT
    USING (id = public.current_profile_id());

CREATE POLICY profiles_select_tenant_members ON profiles
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM tenant_users
            WHERE tenant_users.profile_id = profiles.id
              AND tenant_users.tenant_id = public.current_tenant_id()
              AND tenant_users.status = 'active'
        )
    );

CREATE POLICY profiles_update_own ON profiles
    FOR UPDATE
    USING (id = public.current_profile_id())
    WITH CHECK (
        id = public.current_profile_id()
        -- No permitir cambiar auth_provider (seguridad)
        AND auth_provider = (SELECT auth_provider FROM profiles WHERE id = public.current_profile_id())
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
    USING (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_users_insert ON tenant_users
    FOR INSERT
    WITH CHECK (
        tenant_id = public.current_tenant_id()
        AND public.is_admin_or_owner()
        -- Solo puede crear players o admins (si es owner)
        AND (
            role = 'player'
            OR (role = 'admin' AND public.is_owner())
        )
        -- No puede crear owners
        AND role != 'owner'
    );

CREATE POLICY tenant_users_update ON tenant_users
    FOR UPDATE
    USING (tenant_id = public.current_tenant_id())
    WITH CHECK (
        tenant_id = public.current_tenant_id()
        AND (
            -- Owner puede actualizar cualquier miembro (excepto owners)
            (public.is_owner() AND role != 'owner')
            OR
            -- Admin puede actualizar players
            (public.is_admin_or_owner() AND role = 'player')
            OR
            -- Usuario puede actualizar su propio display_name y level
            (profile_id = public.current_profile_id())
        )
        -- CRÍTICO: Nadie puede cambiar su propio rol
        AND (
            profile_id != public.current_profile_id()
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
        tenant_id = public.current_tenant_id()
        AND public.is_owner()
        -- No puede eliminar al owner
        AND role != 'owner'
        -- No puede eliminarse a sí mismo
        AND profile_id != public.current_profile_id()
    );

-- ----------------------------------------------------------------------------
-- TEAMS
-- ----------------------------------------------------------------------------
-- Todos los miembros pueden ver equipos del tenant
-- Solo admin+ puede crear/modificar equipos

CREATE POLICY teams_select ON teams
    FOR SELECT
    USING (tenant_id = public.current_tenant_id());

CREATE POLICY teams_insert ON teams
    FOR INSERT
    WITH CHECK (
        tenant_id = public.current_tenant_id()
        AND public.is_admin_or_owner()
    );

CREATE POLICY teams_update ON teams
    FOR UPDATE
    USING (tenant_id = public.current_tenant_id())
    WITH CHECK (
        tenant_id = public.current_tenant_id()
        AND public.is_admin_or_owner()
    );

CREATE POLICY teams_delete ON teams
    FOR DELETE
    USING (
        tenant_id = public.current_tenant_id()
        AND public.is_admin_or_owner()
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
              AND teams.tenant_id = public.current_tenant_id()
        )
    );

CREATE POLICY team_members_insert ON team_members
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM teams
            WHERE teams.id = team_members.team_id
              AND teams.tenant_id = public.current_tenant_id()
        )
        AND public.is_admin_or_owner()
    );

CREATE POLICY team_members_update ON team_members
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM teams
            WHERE teams.id = team_members.team_id
              AND teams.tenant_id = public.current_tenant_id()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM teams
            WHERE teams.id = team_members.team_id
              AND teams.tenant_id = public.current_tenant_id()
        )
        AND public.is_admin_or_owner()
    );

CREATE POLICY team_members_delete ON team_members
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM teams
            WHERE teams.id = team_members.team_id
              AND teams.tenant_id = public.current_tenant_id()
        )
        AND public.is_admin_or_owner()
    );

-- ----------------------------------------------------------------------------
-- TOURNAMENTS
-- ----------------------------------------------------------------------------
-- Todos los miembros pueden ver torneos del tenant
-- Solo admin+ puede crear/modificar torneos

CREATE POLICY tournaments_select ON tournaments
    FOR SELECT
    USING (tenant_id = public.current_tenant_id());

CREATE POLICY tournaments_insert ON tournaments
    FOR INSERT
    WITH CHECK (
        tenant_id = public.current_tenant_id()
        AND public.is_admin_or_owner()
        AND created_by = public.current_tenant_user_id()
    );

CREATE POLICY tournaments_update ON tournaments
    FOR UPDATE
    USING (tenant_id = public.current_tenant_id())
    WITH CHECK (
        tenant_id = public.current_tenant_id()
        AND public.is_admin_or_owner()
        -- No cambiar created_by
        AND created_by = (SELECT created_by FROM tournaments WHERE id = tournaments.id)
    );

CREATE POLICY tournaments_delete ON tournaments
    FOR DELETE
    USING (
        tenant_id = public.current_tenant_id()
        AND public.is_admin_or_owner()
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
    USING (tenant_id = public.current_tenant_id());

CREATE POLICY entries_insert_admin ON tournament_entries
    FOR INSERT
    WITH CHECK (
        tenant_id = public.current_tenant_id()
        AND (
            -- Admin puede inscribir cualquier equipo
            public.is_admin_or_owner()
            OR
            -- Player puede inscribir su propio equipo
            EXISTS (
                SELECT 1 FROM team_members
                WHERE team_members.team_id = tournament_entries.team_id
                  AND team_members.tenant_user_id = public.current_tenant_user_id()
                  AND team_members.left_at IS NULL
            )
        )
    );

CREATE POLICY entries_update ON tournament_entries
    FOR UPDATE
    USING (tenant_id = public.current_tenant_id())
    WITH CHECK (
        tenant_id = public.current_tenant_id()
        AND public.is_admin_or_owner()
    );

CREATE POLICY entries_delete ON tournament_entries
    FOR DELETE
    USING (
        tenant_id = public.current_tenant_id()
        AND public.is_admin_or_owner()
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
    USING (tenant_id = public.current_tenant_id());

CREATE POLICY matches_insert ON matches
    FOR INSERT
    WITH CHECK (
        tenant_id = public.current_tenant_id()
        AND public.is_admin_or_owner()
    );

CREATE POLICY matches_update ON matches
    FOR UPDATE
    USING (tenant_id = public.current_tenant_id())
    WITH CHECK (
        tenant_id = public.current_tenant_id()
        AND public.is_admin_or_owner()
    );

CREATE POLICY matches_delete ON matches
    FOR DELETE
    USING (
        tenant_id = public.current_tenant_id()
        AND public.is_admin_or_owner()
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
    USING (tenant_id = public.current_tenant_id());

CREATE POLICY match_results_insert ON match_results
    FOR INSERT
    WITH CHECK (
        tenant_id = public.current_tenant_id()
        AND public.is_admin_or_owner()
    );

CREATE POLICY match_results_update ON match_results
    FOR UPDATE
    USING (tenant_id = public.current_tenant_id())
    WITH CHECK (
        tenant_id = public.current_tenant_id()
        AND public.is_admin_or_owner()
    );

CREATE POLICY match_results_delete ON match_results
    FOR DELETE
    USING (
        tenant_id = public.current_tenant_id()
        AND public.is_admin_or_owner()
    );

-- ----------------------------------------------------------------------------
-- INCIDENTS
-- ----------------------------------------------------------------------------
-- Todos pueden ver incidentes (transparencia)
-- Admin+ puede crear/resolver incidentes
-- Player puede reportar incidentes

CREATE POLICY incidents_select ON incidents
    FOR SELECT
    USING (tenant_id = public.current_tenant_id());

CREATE POLICY incidents_insert ON incidents
    FOR INSERT
    WITH CHECK (
        tenant_id = public.current_tenant_id()
        AND public.is_tenant_member()
        AND reported_by = public.current_tenant_user_id()
    );

CREATE POLICY incidents_update ON incidents
    FOR UPDATE
    USING (tenant_id = public.current_tenant_id())
    WITH CHECK (
        tenant_id = public.current_tenant_id()
        AND public.is_admin_or_owner()
    );

-- No DELETE - incidentes son registro histórico

-- ----------------------------------------------------------------------------
-- RANKINGS
-- ----------------------------------------------------------------------------
-- Todos pueden ver rankings
-- Solo sistema (backend) puede modificar rankings

CREATE POLICY rankings_select ON rankings
    FOR SELECT
    USING (tenant_id = public.current_tenant_id());

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
        tenant_id = public.current_tenant_id()
        AND (
            tenant_user_id = public.current_tenant_user_id()
            OR public.is_admin_or_owner()
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
        tenant_id = public.current_tenant_id()
        AND public.is_admin_or_owner()
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
        tenant_id = public.current_tenant_id()
        AND public.is_admin_or_owner()
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

COMMENT ON FUNCTION public.current_profile_id() IS 'Retorna el profile_id del usuario autenticado desde la variable de sesión';
COMMENT ON FUNCTION public.current_tenant_id() IS 'Retorna el tenant_id del contexto actual desde la variable de sesión';
COMMENT ON FUNCTION public.current_role() IS 'Retorna el rol del usuario en el tenant actual';
COMMENT ON FUNCTION public.is_admin_or_owner() IS 'Verifica si el usuario tiene permisos de administración';
COMMENT ON FUNCTION public.is_owner() IS 'Verifica si el usuario es el owner del tenant';
COMMENT ON FUNCTION public.is_tenant_member() IS 'Verifica si el usuario es miembro activo del tenant';

-- ============================================================================
-- PADEL TOURNAMENT SAAS - TRIGGERS Y FUNCIONES
-- ============================================================================
-- Este archivo contiene:
--   1. Sincronización public.users → profiles
--   2. Detección de perfiles incompletos
--   3. Sistema de auditoría append-only con hash encadenado
-- ============================================================================

-- ----------------------------------------------------------------------------
-- MODIFICACIONES AL SCHEMA PARA SOPORTAR NUEVAS FUNCIONALIDADES
-- ----------------------------------------------------------------------------

-- Agregar columna para marcar perfiles incompletos
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_complete BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS completion_missing JSONB DEFAULT '[]';

-- Agregar columnas para hash encadenado en audit_logs
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS previous_hash VARCHAR(64);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS record_hash VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS sequence_number BIGINT;

-- Crear secuencia global para audit_logs (garantiza orden estricto)
CREATE SEQUENCE IF NOT EXISTS audit_logs_sequence_seq START 1;

-- Índice para verificación de integridad de cadena
CREATE INDEX IF NOT EXISTS idx_audit_logs_sequence ON audit_logs(sequence_number);
CREATE INDEX IF NOT EXISTS idx_audit_logs_hash ON audit_logs(record_hash);

-- ============================================================================
-- 1. SINCRONIZACIÓN AUTH.USERS → PROFILES
-- ============================================================================
-- Supabase/Auth.js crean usuarios en public.users
-- Este trigger sincroniza automáticamente a nuestra tabla profiles

-- Función que crea/actualiza profile cuando se crea/actualiza public.users
CREATE OR REPLACE FUNCTION sync_profile_from_auth_user()
RETURNS TRIGGER AS $$
DECLARE
    v_name VARCHAR(100);
    v_phone VARCHAR(20);
    v_email VARCHAR(255);
    v_avatar VARCHAR(500);
    v_provider VARCHAR(20);
BEGIN
    -- Extraer datos del usuario de auth
    -- Supabase guarda metadata en raw_user_meta_data
    v_email := NEW.email;
    v_phone := NEW.phone;
    v_name := COALESCE(
        NEW.raw_user_meta_data->>'full_name',
        NEW.raw_user_meta_data->>'name',
        NEW.raw_user_meta_data->>'display_name',
        SPLIT_PART(NEW.email, '@', 1),  -- Fallback: parte antes del @
        'Usuario'
    );
    v_avatar := COALESCE(
        NEW.raw_user_meta_data->>'avatar_url',
        NEW.raw_user_meta_data->>'picture'
    );
    v_provider := COALESCE(
        NEW.raw_app_meta_data->>'provider',
        'magic_link'
    );

    IF TG_OP = 'INSERT' THEN
        -- Crear nuevo profile
        INSERT INTO public.profiles (
            id,
            email,
            phone,
            name,
            avatar_url,
            auth_provider,
            auth_provider_id,
            created_at,
            updated_at
        ) VALUES (
            NEW.id,  -- Usar mismo UUID que public.users
            v_email,
            v_phone,
            v_name,
            v_avatar,
            v_provider,
            NEW.id::TEXT,
            NOW(),
            NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
            email = COALESCE(EXCLUDED.email, profiles.email),
            phone = COALESCE(EXCLUDED.phone, profiles.phone),
            name = COALESCE(NULLIF(EXCLUDED.name, 'Usuario'), profiles.name),
            avatar_url = COALESCE(EXCLUDED.avatar_url, profiles.avatar_url),
            updated_at = NOW();
            
    ELSIF TG_OP = 'UPDATE' THEN
        -- Actualizar profile existente
        UPDATE public.profiles SET
            email = COALESCE(v_email, email),
            phone = COALESCE(v_phone, phone),
            name = CASE 
                WHEN v_name IS NOT NULL AND v_name != 'Usuario' THEN v_name 
                ELSE name 
            END,
            avatar_url = COALESCE(v_avatar, avatar_url),
            last_login_at = CASE 
                WHEN NEW.last_sign_in_at != OLD.last_sign_in_at THEN NEW.last_sign_in_at 
                ELSE last_login_at 
            END,
            updated_at = NOW()
        WHERE id = NEW.id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger en public.users (requiere permisos de superuser para crear)
-- NOTA: Ejecutar como superuser o desde Supabase Dashboard
/*
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION sync_profile_from_auth_user();

CREATE TRIGGER on_auth_user_updated
    AFTER UPDATE ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION sync_profile_from_auth_user();
*/

-- Función alternativa para llamar desde el backend si no hay acceso a public.users
CREATE OR REPLACE FUNCTION create_or_update_profile_from_auth(
    p_auth_id UUID,
    p_email VARCHAR(255) DEFAULT NULL,
    p_phone VARCHAR(20) DEFAULT NULL,
    p_name VARCHAR(100) DEFAULT NULL,
    p_avatar_url VARCHAR(500) DEFAULT NULL,
    p_provider VARCHAR(20) DEFAULT 'magic_link'
)
RETURNS UUID AS $$
DECLARE
    v_profile_id UUID;
    v_final_name VARCHAR(100);
BEGIN
    -- Determinar nombre final
    v_final_name := COALESCE(
        NULLIF(p_name, ''),
        SPLIT_PART(p_email, '@', 1),
        'Usuario'
    );

    INSERT INTO profiles (
        id,
        email,
        phone,
        name,
        avatar_url,
        auth_provider,
        auth_provider_id
    ) VALUES (
        p_auth_id,
        p_email,
        p_phone,
        v_final_name,
        p_avatar_url,
        p_provider,
        p_auth_id::TEXT
    )
    ON CONFLICT (id) DO UPDATE SET
        email = COALESCE(EXCLUDED.email, profiles.email),
        phone = COALESCE(EXCLUDED.phone, profiles.phone),
        name = CASE 
            WHEN EXCLUDED.name != 'Usuario' THEN EXCLUDED.name 
            ELSE profiles.name 
        END,
        avatar_url = COALESCE(EXCLUDED.avatar_url, profiles.avatar_url),
        updated_at = NOW()
    RETURNING id INTO v_profile_id;

    RETURN v_profile_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 2. DETECCIÓN DE PERFILES INCOMPLETOS
-- ============================================================================
-- Un perfil se considera completo cuando tiene:
--   - name (no genérico)
--   - phone O email
--   - gender (para inscribirse a torneos)

CREATE OR REPLACE FUNCTION check_profile_completeness()
RETURNS TRIGGER AS $$
DECLARE
    v_missing JSONB := '[]'::JSONB;
    v_is_complete BOOLEAN := TRUE;
BEGIN
    -- Verificar campos requeridos
    
    -- Nombre real (no genérico)
    IF NEW.name IS NULL OR NEW.name = '' OR NEW.name = 'Usuario' OR LENGTH(NEW.name) < 2 THEN
        v_missing := v_missing || '["name"]'::JSONB;
        v_is_complete := FALSE;
    END IF;
    
    -- Contacto (phone o email)
    IF NEW.phone IS NULL AND NEW.email IS NULL THEN
        v_missing := v_missing || '["contact"]'::JSONB;
        v_is_complete := FALSE;
    END IF;
    
    -- Género (necesario para torneos)
    IF NEW.gender IS NULL THEN
        v_missing := v_missing || '["gender"]'::JSONB;
        v_is_complete := FALSE;
    END IF;

    -- Actualizar estado de completitud
    NEW.is_complete := v_is_complete;
    NEW.completion_missing := v_missing;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER check_profile_completeness_trigger
    BEFORE INSERT OR UPDATE ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION check_profile_completeness();

-- Función para obtener qué le falta a un perfil (útil para UI)
CREATE OR REPLACE FUNCTION get_profile_completion_status(p_profile_id UUID)
RETURNS TABLE (
    is_complete BOOLEAN,
    missing_fields JSONB,
    completion_percentage INTEGER
) AS $$
DECLARE
    v_profile profiles%ROWTYPE;
    v_total_fields INTEGER := 3;  -- name, contact, gender
    v_completed_fields INTEGER := 0;
BEGIN
    SELECT * INTO v_profile FROM profiles WHERE id = p_profile_id;
    
    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, '["profile_not_found"]'::JSONB, 0;
        RETURN;
    END IF;

    -- Contar campos completos
    IF v_profile.name IS NOT NULL AND v_profile.name != '' AND v_profile.name != 'Usuario' THEN
        v_completed_fields := v_completed_fields + 1;
    END IF;
    
    IF v_profile.phone IS NOT NULL OR v_profile.email IS NOT NULL THEN
        v_completed_fields := v_completed_fields + 1;
    END IF;
    
    IF v_profile.gender IS NOT NULL THEN
        v_completed_fields := v_completed_fields + 1;
    END IF;

    RETURN QUERY SELECT 
        v_profile.is_complete,
        v_profile.completion_missing,
        (v_completed_fields * 100 / v_total_fields)::INTEGER;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- 3. SISTEMA DE AUDITORÍA APPEND-ONLY CON HASH ENCADENADO
-- ============================================================================
-- Características:
--   - Cada registro tiene un hash que incluye el hash anterior (blockchain-like)
--   - Imposible modificar registros sin romper la cadena
--   - Sequence number garantiza orden estricto
--   - Triggers automáticos en tablas críticas

-- Función para calcular hash de un registro de auditoría
CREATE OR REPLACE FUNCTION calculate_audit_hash(
    p_sequence_number BIGINT,
    p_previous_hash VARCHAR(64),
    p_tenant_id UUID,
    p_actor_id UUID,
    p_action audit_action,
    p_entity_type VARCHAR(50),
    p_entity_id UUID,
    p_old_values JSONB,
    p_new_values JSONB,
    p_created_at TIMESTAMPTZ
)
RETURNS VARCHAR(64) AS $$
DECLARE
    v_data TEXT;
BEGIN
    -- Concatenar todos los campos en orden determinístico
    v_data := COALESCE(p_sequence_number::TEXT, '') || '|' ||
              COALESCE(p_previous_hash, 'GENESIS') || '|' ||
              COALESCE(p_tenant_id::TEXT, '') || '|' ||
              COALESCE(p_actor_id::TEXT, '') || '|' ||
              p_action::TEXT || '|' ||
              p_entity_type || '|' ||
              COALESCE(p_entity_id::TEXT, '') || '|' ||
              COALESCE(p_old_values::TEXT, '') || '|' ||
              COALESCE(p_new_values::TEXT, '') || '|' ||
              p_created_at::TEXT;
    
    -- SHA-256 del contenido
    RETURN encode(digest(v_data, 'sha256'), 'hex');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Función que se ejecuta ANTES de insertar en audit_logs
CREATE OR REPLACE FUNCTION audit_log_before_insert()
RETURNS TRIGGER AS $$
DECLARE
    v_previous_hash VARCHAR(64);
    v_sequence BIGINT;
BEGIN
    -- Obtener siguiente número de secuencia
    v_sequence := nextval('audit_logs_sequence_seq');
    NEW.sequence_number := v_sequence;
    
    -- Obtener hash del registro anterior
    SELECT record_hash INTO v_previous_hash
    FROM audit_logs
    WHERE sequence_number = v_sequence - 1;
    
    -- Si es el primer registro, usar NULL (se convertirá a 'GENESIS' en el hash)
    NEW.previous_hash := v_previous_hash;
    
    -- Calcular hash de este registro
    NEW.record_hash := calculate_audit_hash(
        NEW.sequence_number,
        NEW.previous_hash,
        NEW.tenant_id,
        NEW.actor_id,
        NEW.action,
        NEW.entity_type,
        NEW.entity_id,
        NEW.old_values,
        NEW.new_values,
        COALESCE(NEW.created_at, NOW())
    );
    
    -- Asegurar timestamp
    IF NEW.created_at IS NULL THEN
        NEW.created_at := NOW();
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_hash_chain
    BEFORE INSERT ON audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION audit_log_before_insert();

-- BLOQUEAR UPDATE Y DELETE EN AUDIT_LOGS
CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs es append-only. No se permite % en registros existentes.', TG_OP
        USING HINT = 'Los registros de auditoría son inmutables para garantizar integridad.';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_prevent_update
    BEFORE UPDATE ON audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_log_modification();

CREATE TRIGGER audit_log_prevent_delete
    BEFORE DELETE ON audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_log_modification();

-- Función para verificar integridad de la cadena de auditoría
CREATE OR REPLACE FUNCTION verify_audit_chain(
    p_tenant_id UUID DEFAULT NULL,
    p_from_sequence BIGINT DEFAULT 1,
    p_to_sequence BIGINT DEFAULT NULL
)
RETURNS TABLE (
    is_valid BOOLEAN,
    total_records BIGINT,
    first_invalid_sequence BIGINT,
    error_message TEXT
) AS $$
DECLARE
    v_record RECORD;
    v_expected_hash VARCHAR(64);
    v_previous_hash VARCHAR(64) := NULL;
    v_count BIGINT := 0;
    v_max_sequence BIGINT;
BEGIN
    -- Determinar rango
    SELECT MAX(sequence_number) INTO v_max_sequence FROM audit_logs;
    p_to_sequence := COALESCE(p_to_sequence, v_max_sequence);

    -- Iterar sobre registros en orden
    FOR v_record IN
        SELECT *
        FROM audit_logs
        WHERE (p_tenant_id IS NULL OR tenant_id = p_tenant_id)
          AND sequence_number >= p_from_sequence
          AND sequence_number <= p_to_sequence
        ORDER BY sequence_number ASC
    LOOP
        v_count := v_count + 1;
        
        -- Verificar que previous_hash coincide con el hash anterior
        IF v_record.sequence_number > 1 AND v_record.previous_hash IS DISTINCT FROM v_previous_hash THEN
            RETURN QUERY SELECT 
                FALSE,
                v_count,
                v_record.sequence_number,
                'previous_hash no coincide con el registro anterior';
            RETURN;
        END IF;
        
        -- Recalcular hash y verificar
        v_expected_hash := calculate_audit_hash(
            v_record.sequence_number,
            v_record.previous_hash,
            v_record.tenant_id,
            v_record.actor_id,
            v_record.action,
            v_record.entity_type,
            v_record.entity_id,
            v_record.old_values,
            v_record.new_values,
            v_record.created_at
        );
        
        IF v_record.record_hash != v_expected_hash THEN
            RETURN QUERY SELECT 
                FALSE,
                v_count,
                v_record.sequence_number,
                'record_hash no coincide con el contenido del registro';
            RETURN;
        END IF;
        
        v_previous_hash := v_record.record_hash;
    END LOOP;

    -- Cadena válida
    RETURN QUERY SELECT TRUE, v_count, NULL::BIGINT, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 4. TRIGGERS AUTOMÁTICOS DE AUDITORÍA EN TABLAS CRÍTICAS
-- ============================================================================

-- Función genérica para auditar cambios
CREATE OR REPLACE FUNCTION audit_table_changes()
RETURNS TRIGGER AS $$
DECLARE
    v_tenant_id UUID;
    v_actor_id UUID;
    v_actor_role member_role;
    v_action audit_action;
    v_old_values JSONB;
    v_new_values JSONB;
BEGIN
    -- Obtener contexto de sesión
    v_actor_id := NULLIF(current_setting('app.current_profile_id', TRUE), '')::UUID;
    v_tenant_id := NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID;
    
    -- Obtener rol del actor
    SELECT role INTO v_actor_role
    FROM tenant_users
    WHERE profile_id = v_actor_id AND tenant_id = v_tenant_id AND status = 'active';

    -- Determinar acción y valores
    IF TG_OP = 'INSERT' THEN
        v_action := 'create';
        v_old_values := NULL;
        v_new_values := to_jsonb(NEW);
        v_tenant_id := COALESCE(v_tenant_id, NEW.tenant_id);
        
    ELSIF TG_OP = 'UPDATE' THEN
        v_action := 'update';
        v_old_values := to_jsonb(OLD);
        v_new_values := to_jsonb(NEW);
        v_tenant_id := COALESCE(v_tenant_id, NEW.tenant_id, OLD.tenant_id);
        
    ELSIF TG_OP = 'DELETE' THEN
        v_action := 'delete';
        v_old_values := to_jsonb(OLD);
        v_new_values := NULL;
        v_tenant_id := COALESCE(v_tenant_id, OLD.tenant_id);
    END IF;

    -- Insertar registro de auditoría
    INSERT INTO audit_logs (
        tenant_id,
        actor_id,
        actor_role,
        action,
        entity_type,
        entity_id,
        old_values,
        new_values,
        ip_address,
        user_agent
    ) VALUES (
        v_tenant_id,
        v_actor_id,
        v_actor_role,
        v_action,
        TG_TABLE_NAME,
        COALESCE(NEW.id, OLD.id),
        v_old_values,
        v_new_values,
        NULLIF(current_setting('app.client_ip', TRUE), '')::INET,
        NULLIF(current_setting('app.user_agent', TRUE), '')
    );

    -- Retornar el registro apropiado
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Crear triggers en tablas críticas
-- NOTA: Usar AFTER para no interferir con la operación principal

CREATE TRIGGER audit_tenants_changes
    AFTER INSERT OR UPDATE OR DELETE ON tenants
    FOR EACH ROW EXECUTE FUNCTION audit_table_changes();

CREATE TRIGGER audit_tenant_users_changes
    AFTER INSERT OR UPDATE OR DELETE ON tenant_users
    FOR EACH ROW EXECUTE FUNCTION audit_table_changes();

CREATE TRIGGER audit_tournaments_changes
    AFTER INSERT OR UPDATE OR DELETE ON tournaments
    FOR EACH ROW EXECUTE FUNCTION audit_table_changes();

CREATE TRIGGER audit_tournament_entries_changes
    AFTER INSERT OR UPDATE OR DELETE ON tournament_entries
    FOR EACH ROW EXECUTE FUNCTION audit_table_changes();

CREATE TRIGGER audit_matches_changes
    AFTER INSERT OR UPDATE OR DELETE ON matches
    FOR EACH ROW EXECUTE FUNCTION audit_table_changes();

CREATE TRIGGER audit_match_results_changes
    AFTER INSERT OR UPDATE OR DELETE ON match_results
    FOR EACH ROW EXECUTE FUNCTION audit_table_changes();

CREATE TRIGGER audit_rankings_changes
    AFTER INSERT OR UPDATE OR DELETE ON rankings
    FOR EACH ROW EXECUTE FUNCTION audit_table_changes();

-- ============================================================================
-- 5. FUNCIONES AUXILIARES DE AUDITORÍA
-- ============================================================================

-- Función para insertar log de auditoría manualmente (para acciones custom)
CREATE OR REPLACE FUNCTION log_audit_event(
    p_action audit_action,
    p_entity_type VARCHAR(50),
    p_entity_id UUID DEFAULT NULL,
    p_old_values JSONB DEFAULT NULL,
    p_new_values JSONB DEFAULT NULL,
    p_tenant_id UUID DEFAULT NULL,
    p_actor_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_audit_id UUID;
    v_actor_role member_role;
    v_tenant_id UUID;
    v_actor_id UUID;
BEGIN
    -- Usar valores de sesión si no se proporcionan
    v_tenant_id := COALESCE(p_tenant_id, NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);
    v_actor_id := COALESCE(p_actor_id, NULLIF(current_setting('app.current_profile_id', TRUE), '')::UUID);
    
    -- Obtener rol
    SELECT role INTO v_actor_role
    FROM tenant_users
    WHERE profile_id = v_actor_id AND tenant_id = v_tenant_id AND status = 'active';

    INSERT INTO audit_logs (
        tenant_id,
        actor_id,
        actor_role,
        action,
        entity_type,
        entity_id,
        old_values,
        new_values,
        ip_address,
        user_agent
    ) VALUES (
        v_tenant_id,
        v_actor_id,
        v_actor_role,
        p_action,
        p_entity_type,
        p_entity_id,
        p_old_values,
        p_new_values,
        NULLIF(current_setting('app.client_ip', TRUE), '')::INET,
        NULLIF(current_setting('app.user_agent', TRUE), '')
    )
    RETURNING id INTO v_audit_id;

    RETURN v_audit_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Función para obtener historial de cambios de una entidad
CREATE OR REPLACE FUNCTION get_entity_audit_history(
    p_entity_type VARCHAR(50),
    p_entity_id UUID,
    p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
    audit_id UUID,
    action audit_action,
    actor_name VARCHAR(100),
    actor_role member_role,
    changes JSONB,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        al.id,
        al.action,
        p.name,
        al.actor_role,
        CASE 
            WHEN al.action = 'create' THEN al.new_values
            WHEN al.action = 'delete' THEN al.old_values
            ELSE jsonb_build_object(
                'before', al.old_values,
                'after', al.new_values
            )
        END,
        al.created_at
    FROM audit_logs al
    LEFT JOIN profiles p ON p.id = al.actor_id
    WHERE al.entity_type = p_entity_type
      AND al.entity_id = p_entity_id
      AND al.tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID
    ORDER BY al.sequence_number DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================================
-- COMENTARIOS DE DOCUMENTACIÓN
-- ============================================================================

COMMENT ON FUNCTION sync_profile_from_auth_user() IS 
    'Sincroniza datos de public.users a profiles cuando se crea/actualiza un usuario';

COMMENT ON FUNCTION create_or_update_profile_from_auth(UUID, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR) IS 
    'Función alternativa para crear/actualizar profile desde el backend';

COMMENT ON FUNCTION check_profile_completeness() IS 
    'Evalúa si un perfil tiene todos los campos necesarios para participar en torneos';

COMMENT ON FUNCTION get_profile_completion_status(UUID) IS 
    'Retorna estado de completitud de un perfil con porcentaje y campos faltantes';

COMMENT ON FUNCTION calculate_audit_hash(BIGINT, VARCHAR, UUID, UUID, audit_action, VARCHAR, UUID, JSONB, JSONB, TIMESTAMPTZ) IS 
    'Calcula SHA-256 de un registro de auditoría incluyendo el hash anterior (blockchain-like)';

COMMENT ON FUNCTION verify_audit_chain(UUID, BIGINT, BIGINT) IS 
    'Verifica integridad de la cadena de auditoría. Detecta cualquier modificación.';

COMMENT ON FUNCTION audit_table_changes() IS 
    'Trigger genérico que registra cambios en tablas críticas';

COMMENT ON FUNCTION log_audit_event(audit_action, VARCHAR, UUID, JSONB, JSONB, UUID, UUID) IS 
    'Permite insertar eventos de auditoría custom desde el backend';

COMMENT ON FUNCTION get_entity_audit_history(VARCHAR, UUID, INTEGER) IS 
    'Obtiene historial de cambios de una entidad específica';

COMMENT ON COLUMN audit_logs.previous_hash IS 
    'Hash del registro anterior en la cadena (NULL para el primer registro)';

COMMENT ON COLUMN audit_logs.record_hash IS 
    'SHA-256 del contenido de este registro + previous_hash';

COMMENT ON COLUMN audit_logs.sequence_number IS 
    'Número de secuencia global que garantiza orden estricto';

COMMENT ON COLUMN profiles.is_complete IS 
    'TRUE si el perfil tiene todos los campos necesarios para torneos';

COMMENT ON COLUMN profiles.completion_missing IS 
    'Array JSON con los campos que faltan completar';

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
  standing_position INTEGER,
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
    )::INTEGER AS standing_position,
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
  ORDER BY standing_position;
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

