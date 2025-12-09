import create from 'zustand';
import type { Session, User } from '@supabase/supabase-js';

interface AuthState {
  session: Session | null;
  user: User | null;
  setSession: (session: Session | null) => void;
  setUser: (user: User | null) => void;
  reset: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  user: null,
  setSession: (session) => set({ session }),
  setUser: (user) => set({ user }),
  reset: () => set({ session: null, user: null }),
}));

