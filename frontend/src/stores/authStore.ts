import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, Session } from '@supabase/supabase-js';

interface AuthState {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  
  // Actions
  setUser: (user: User | null) => void;
  setSession: (session: Session | null) => void;
  setLoading: (loading: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      session: null,
      isLoading: true,
      isAuthenticated: false,

      setUser: (user) => set({ 
        user, 
        isAuthenticated: !!user,
        isLoading: false 
      }),
      
      setSession: (session) => set({ 
        session,
        user: session?.user ?? null,
        isAuthenticated: !!session,
        isLoading: false
      }),
      
      setLoading: (isLoading) => set({ isLoading }),
      
      logout: () => set({ 
        user: null, 
        session: null, 
        isAuthenticated: false,
        isLoading: false
      }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ 
        // Only persist these fields
        isAuthenticated: state.isAuthenticated 
      }),
    }
  )
);

