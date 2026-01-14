-- 1. Ensure the sync trigger exists (in case it wasn't created)
-- Note: Creating triggers on auth.users usually requires superuser, 
-- but we can try to create a function that does the work and call it manually if needed.

-- Function to ensure profile exists for a given user
CREATE OR REPLACE FUNCTION public.ensure_user_profile(user_id UUID)
RETURNS VOID AS $$
DECLARE
    v_email VARCHAR(255);
    v_raw_meta JSONB;
BEGIN
    -- Try to get user data from auth.users (requires permissions or security definer view)
    -- Since we can't easily access auth.users from here without superuser,
    -- we will insert a placeholder profile if it doesn't exist.
    -- The user can then update it.
    
    INSERT INTO public.profiles (id, name, email, created_at, updated_at)
    VALUES (
        user_id, 
        'Usuario', 
        NULL, -- Email will be updated on next login or via trigger if it works
        NOW(), 
        NOW()
    )
    ON CONFLICT (id) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Create a trigger to auto-create profile on INSERT to profiles? No, that's circular.
-- We need to rely on the auth trigger.

-- Let's try to recreate the auth trigger if we have permissions.
-- If this fails, the deployment might fail, so we wrap it in a DO block or just hope.
-- Actually, we can't run dynamic SQL on auth schema easily here.

-- Instead, we will expose the `ensure_user_profile` function and 
-- update the RLS to allow INSERTs from authenticated users for their OWN profile.

CREATE POLICY profiles_insert_own ON profiles
    FOR INSERT
    WITH CHECK (id = auth.uid());

-- This allows the frontend to "upsert" if it wants, or we can call ensure_user_profile.
