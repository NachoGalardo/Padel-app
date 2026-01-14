-- Fix RLS policies to not rely on session variables (which are not set by frontend)
-- Instead, check permissions directly against tenant_users table

-- 1. Fix INSERT policy
DROP POLICY IF EXISTS tournaments_insert ON tournaments;

CREATE POLICY tournaments_insert ON tournaments
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM tenant_users
            WHERE tenant_users.tenant_id = tournaments.tenant_id
            AND tenant_users.profile_id = auth.uid()
            AND tenant_users.role IN ('owner', 'admin')
            AND tenant_users.status = 'active'
        )
    );

-- 2. Fix SELECT policy
DROP POLICY IF EXISTS tournaments_select ON tournaments;

CREATE POLICY tournaments_select ON tournaments
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM tenant_users
            WHERE tenant_users.tenant_id = tournaments.tenant_id
            AND tenant_users.profile_id = auth.uid()
            AND tenant_users.status = 'active'
        )
    );

-- 3. Fix UPDATE policy
DROP POLICY IF EXISTS tournaments_update ON tournaments;

CREATE POLICY tournaments_update ON tournaments
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM tenant_users
            WHERE tenant_users.tenant_id = tournaments.tenant_id
            AND tenant_users.profile_id = auth.uid()
            AND tenant_users.role IN ('owner', 'admin')
            AND tenant_users.status = 'active'
        )
    );

-- 4. Fix DELETE policy
DROP POLICY IF EXISTS tournaments_delete ON tournaments;

CREATE POLICY tournaments_delete ON tournaments
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM tenant_users
            WHERE tenant_users.tenant_id = tournaments.tenant_id
            AND tenant_users.profile_id = auth.uid()
            AND tenant_users.role IN ('owner', 'admin')
            AND tenant_users.status = 'active'
        )
        AND status = 'draft'
    );
