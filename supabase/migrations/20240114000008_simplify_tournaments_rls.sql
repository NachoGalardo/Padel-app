-- Simplify tournaments RLS to avoid complex function dependencies
DROP POLICY IF EXISTS tournaments_insert ON tournaments;

CREATE POLICY tournaments_insert ON tournaments
    FOR INSERT
    WITH CHECK (
        tenant_id = public.current_tenant_id()
        AND EXISTS (
            SELECT 1 FROM tenant_users
            WHERE tenant_users.tenant_id = tournaments.tenant_id
            AND tenant_users.profile_id = auth.uid()
            AND tenant_users.role IN ('owner', 'admin')
            AND tenant_users.status = 'active'
        )
    );
