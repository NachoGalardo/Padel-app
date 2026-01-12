import { useEffect, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const { setSession, setLoading, logout } = useAuthStore();

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('[Auth] State changed:', event);
        
        switch (event) {
          case 'SIGNED_IN':
          case 'TOKEN_REFRESHED':
            setSession(session);
            break;
          case 'SIGNED_OUT':
            logout();
            break;
          case 'USER_UPDATED':
            setSession(session);
            break;
          default:
            setLoading(false);
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [setSession, setLoading, logout]);

  return <>{children}</>;
}

