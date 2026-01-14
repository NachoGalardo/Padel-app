-- Allow users to see their own memberships without being in a specific tenant context
CREATE POLICY tenant_users_select_own ON tenant_users
    FOR SELECT
    USING (profile_id = public.current_profile_id());

-- Allow users to see tenants they belong to
CREATE POLICY tenants_select_member ON tenants
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM tenant_users
            WHERE tenant_users.tenant_id = tenants.id
              AND tenant_users.profile_id = public.current_profile_id()
        )
    );
