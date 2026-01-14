-- Function to create a member (profile + tenant_user) safely
-- This is needed because profiles is a global table and we don't want to open up INSERT permissions globally.

CREATE OR REPLACE FUNCTION public.create_tenant_member(
    p_tenant_id UUID,
    p_name TEXT,
    p_gender gender,
    p_email TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER -- Runs with privileges of the creator (postgres/admin)
SET search_path = public
AS $$
DECLARE
    v_profile_id UUID;
    v_email TEXT;
    v_is_admin BOOLEAN;
BEGIN
    -- 1. Check permissions: Caller must be admin/owner of the tenant
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

    -- 2. Handle contact info (Ghost players might not have email/phone)
    -- The profiles table requires email OR phone.
    -- If neither provided, generate a placeholder email.
    v_email := p_email;
    IF p_email IS NULL AND p_phone IS NULL THEN
        v_email := 'ghost.' || gen_random_uuid() || '@placeholder.app';
    END IF;

    -- 3. Create Profile
    INSERT INTO profiles (name, gender, email, phone)
    VALUES (p_name, p_gender, v_email, p_phone)
    RETURNING id INTO v_profile_id;

    -- 4. Create Tenant Membership
    INSERT INTO tenant_users (tenant_id, profile_id, role, status)
    VALUES (p_tenant_id, v_profile_id, 'player', 'active');

    RETURN v_profile_id;
END;
$$;
