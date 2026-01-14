-- Fix ensure_user_profile to satisfy contact_required constraint
CREATE OR REPLACE FUNCTION public.ensure_user_profile(user_id UUID)
RETURNS VOID AS $$
BEGIN
    -- Insert a placeholder profile with a dummy email derived from UUID to satisfy uniqueness and not-null constraint
    INSERT INTO public.profiles (id, name, email, created_at, updated_at)
    VALUES (
        user_id, 
        'Usuario', 
        'missing_' || user_id || '@placeholder.com', -- Placeholder email
        NOW(), 
        NOW()
    )
    ON CONFLICT (id) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
