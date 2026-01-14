-- Create v2 function to resolve 404/signature issues
-- Using a new name ensures no conflicts with previous versions

CREATE OR REPLACE FUNCTION public.create_tenant_member_v2(
    p_tenant_id UUID,
    p_name TEXT,
    p_gender TEXT,
    p_email TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_profile_id UUID;
    v_email TEXT;
    v_is_admin BOOLEAN;
    v_gender gender;
BEGIN
    -- Cast gender safely
    BEGIN
        v_gender := p_gender::gender;
    EXCEPTION WHEN OTHERS THEN
        v_gender := 'mixed'; -- Fallback
    END;

    -- 1. Check permissions
    SELECT EXISTS (
        SELECT 1 FROM tenant_users
        WHERE tenant_id = p_tenant_id
        AND profile_id = auth.uid()
        AND role IN ('owner', 'admin')
        AND status = 'active'
    ) INTO v_is_admin;

    IF NOT v_is_admin THEN
        RAISE EXCEPTION 'Access denied: You must be an admin to create members.';
    END IF;

    -- 2. Handle contact info
    v_email := p_email;
    IF (p_email IS NULL OR p_email = '') AND (p_phone IS NULL OR p_phone = '') THEN
        v_email := 'ghost.' || gen_random_uuid() || '@placeholder.app';
    END IF;

    -- 3. Create Profile
    INSERT INTO profiles (name, gender, email, phone)
    VALUES (p_name, v_gender, v_email, NULLIF(p_phone, ''))
    RETURNING id INTO v_profile_id;

    -- 4. Create Tenant Membership
    INSERT INTO tenant_users (tenant_id, profile_id, role, status)
    VALUES (p_tenant_id, v_profile_id, 'player', 'active');

    RETURN v_profile_id;
END;
$$;

-- Grant permissions explicitly
GRANT EXECUTE ON FUNCTION public.create_tenant_member_v2 TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_tenant_member_v2 TO service_role;
