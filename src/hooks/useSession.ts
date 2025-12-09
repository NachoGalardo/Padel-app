import { useAuth } from './useAuth';

export function useSession() {
  const { session, user, loading } = useAuth();
  return { session, user, loading, isAuthenticated: Boolean(session) };
}

