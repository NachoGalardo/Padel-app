-- 1. Ensure current_tenant_user_id exists and works correctly
CREATE OR REPLACE FUNCTION public.current_tenant_user_id()
RETURNS UUID AS $$
DECLARE
    v_profile_id UUID;
    v_tenant_id UUID;
    v_tenant_user_id UUID;
BEGIN
    -- Get context from session variables (set by RLS helpers or middleware)
    v_profile_id := public.current_profile_id();
    v_tenant_id := public.current_tenant_id();
    
    -- Try to get from session variable first (optimization)
    v_tenant_user_id := NULLIF(current_setting('app.current_tenant_user_id', TRUE), '')::UUID;
    
    -- If not set, look it up in the table
    IF v_tenant_user_id IS NULL AND v_profile_id IS NOT NULL AND v_tenant_id IS NOT NULL THEN
        SELECT id INTO v_tenant_user_id
        FROM tenant_users
        WHERE profile_id = v_profile_id
          AND tenant_id = v_tenant_id
          AND status = 'active';
    END IF;
    
    RETURN v_tenant_user_id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- 2. Update tournaments insert policy to be more robust
DROP POLICY IF EXISTS tournaments_insert ON tournaments;

CREATE POLICY tournaments_insert ON tournaments
    FOR INSERT
    WITH CHECK (
        tenant_id = public.current_tenant_id()
        AND public.is_admin_or_owner()
        -- Ensure the creator is the current user
        AND created_by = public.current_tenant_user_id()
    );
