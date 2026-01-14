-- Fix infinite recursion in profiles policy by removing the subquery
DROP POLICY IF EXISTS profiles_update_own ON profiles;

CREATE POLICY profiles_update_own ON profiles
    FOR UPDATE
    USING (id = public.current_profile_id())
    WITH CHECK (id = public.current_profile_id());

-- Create trigger to prevent auth_provider changes (replaces the policy check)
CREATE OR REPLACE FUNCTION prevent_profile_auth_provider_change()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.auth_provider IS DISTINCT FROM OLD.auth_provider THEN
        RAISE EXCEPTION 'Cannot change auth_provider';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS check_auth_provider_immutable ON profiles;
CREATE TRIGGER check_auth_provider_immutable
    BEFORE UPDATE ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION prevent_profile_auth_provider_change();
