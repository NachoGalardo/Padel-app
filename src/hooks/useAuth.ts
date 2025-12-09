import { useEffect, useState } from 'react';
import { supabase } from '@app/services/supabase';
import { useAuthStore } from '@app/store/authStore';

export function useAuth() {
  const { session, user, setSession, setUser, reset } = useAuthStore();
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
    });

    return () => {
      subscription.unsubscribe();
      reset();
    };
  }, [reset, setSession, setUser]);

  return { session, user, loading };
}

