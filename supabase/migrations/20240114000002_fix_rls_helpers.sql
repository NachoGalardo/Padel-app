-- Update RLS helpers to work with Supabase Auth and Frontend headers

-- 1. Update current_profile_id to fallback to auth.uid()
CREATE OR REPLACE FUNCTION public.current_profile_id()
RETURNS UUID AS $$
    SELECT COALESCE(
        NULLIF(current_setting('app.current_profile_id', TRUE), '')::UUID,
        auth.uid()
    );
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- 2. Update current_tenant_id to fallback to x-tenant-id header
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS UUID AS $$
    SELECT COALESCE(
        NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID,
        NULLIF(current_setting('request.headers', TRUE)::json->>'x-tenant-id', '')::UUID
    );
$$ LANGUAGE SQL STABLE SECURITY DEFINER;
