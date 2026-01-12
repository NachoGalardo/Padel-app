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
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

