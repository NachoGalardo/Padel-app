-- ============================================================================
-- PADEL TOURNAMENT SAAS - TRIGGERS Y FUNCIONES
-- ============================================================================
-- Este archivo contiene:
--   1. Sincronización auth.users → profiles
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
-- Supabase/Auth.js crean usuarios en auth.users
-- Este trigger sincroniza automáticamente a nuestra tabla profiles

-- Función que crea/actualiza profile cuando se crea/actualiza auth.users
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
            NEW.id,  -- Usar mismo UUID que auth.users
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

-- Trigger en auth.users (requiere permisos de superuser para crear)
-- NOTA: Ejecutar como superuser o desde Supabase Dashboard
/*
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION sync_profile_from_auth_user();

CREATE TRIGGER on_auth_user_updated
    AFTER UPDATE ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION sync_profile_from_auth_user();
*/

-- Función alternativa para llamar desde el backend si no hay acceso a auth.users
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
    'Sincroniza datos de auth.users a profiles cuando se crea/actualiza un usuario';

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

