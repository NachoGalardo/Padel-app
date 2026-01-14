-- Fix audit_table_changes to handle tables without tenant_id column (like tenants table itself)
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
    IF v_actor_id IS NOT NULL AND v_tenant_id IS NOT NULL THEN
        SELECT role INTO v_actor_role
        FROM tenant_users
        WHERE profile_id = v_actor_id AND tenant_id = v_tenant_id AND status = 'active';
    END IF;

    -- Determinar acción y valores
    IF TG_OP = 'INSERT' THEN
        v_action := 'create';
        v_old_values := NULL;
        v_new_values := to_jsonb(NEW);
        
        -- Intentar extraer tenant_id de manera segura
        IF v_tenant_id IS NULL THEN
            IF TG_TABLE_NAME = 'tenants' THEN
                v_tenant_id := NEW.id;
            ELSE
                -- Usar JSONB para evitar error si la columna no existe
                v_tenant_id := (v_new_values->>'tenant_id')::UUID;
            END IF;
        END IF;
        
    ELSIF TG_OP = 'UPDATE' THEN
        v_action := 'update';
        v_old_values := to_jsonb(OLD);
        v_new_values := to_jsonb(NEW);
        
        IF v_tenant_id IS NULL THEN
            IF TG_TABLE_NAME = 'tenants' THEN
                v_tenant_id := NEW.id;
            ELSE
                v_tenant_id := COALESCE(
                    (v_new_values->>'tenant_id')::UUID, 
                    (v_old_values->>'tenant_id')::UUID
                );
            END IF;
        END IF;
        
    ELSIF TG_OP = 'DELETE' THEN
        v_action := 'delete';
        v_old_values := to_jsonb(OLD);
        v_new_values := NULL;
        
        IF v_tenant_id IS NULL THEN
             IF TG_TABLE_NAME = 'tenants' THEN
                v_tenant_id := OLD.id;
            ELSE
                v_tenant_id := (v_old_values->>'tenant_id')::UUID;
            END IF;
        END IF;
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
