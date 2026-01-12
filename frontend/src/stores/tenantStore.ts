import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type TenantRole = 'owner' | 'admin' | 'player';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: 'free' | 'starter' | 'pro' | 'enterprise';
  status: 'active' | 'suspended' | 'cancelled';
  logoUrl?: string;
}

export interface TenantMembership {
  tenantId: string;
  tenantUserId: string;
  role: TenantRole;
  status: 'active' | 'invited' | 'suspended';
}

interface TenantState {
  currentTenant: Tenant | null;
  currentMembership: TenantMembership | null;
  availableTenants: Tenant[];
  isLoading: boolean;
  
  // Computed
  isAdmin: boolean;
  isOwner: boolean;
  canManage: boolean;
  
  // Actions
  setCurrentTenant: (tenant: Tenant | null, membership?: TenantMembership | null) => void;
  setAvailableTenants: (tenants: Tenant[]) => void;
  setLoading: (loading: boolean) => void;
  switchTenant: (tenantId: string) => void;
  clear: () => void;
}

export const useTenantStore = create<TenantState>()(
  persist(
    (set, get) => ({
      currentTenant: null,
      currentMembership: null,
      availableTenants: [],
      isLoading: true,
      
      // Computed getters
      get isAdmin() {
        const role = get().currentMembership?.role;
        return role === 'admin' || role === 'owner';
      },
      
      get isOwner() {
        return get().currentMembership?.role === 'owner';
      },
      
      get canManage() {
        const role = get().currentMembership?.role;
        return role === 'admin' || role === 'owner';
      },

      setCurrentTenant: (tenant, membership = null) => set({ 
        currentTenant: tenant,
        currentMembership: membership,
        isLoading: false
      }),
      
      setAvailableTenants: (tenants) => set({ availableTenants: tenants }),
      
      setLoading: (isLoading) => set({ isLoading }),
      
      switchTenant: (tenantId) => {
        const tenants = get().availableTenants;
        const tenant = tenants.find(t => t.id === tenantId);
        if (tenant) {
          set({ currentTenant: tenant });
        }
      },
      
      clear: () => set({
        currentTenant: null,
        currentMembership: null,
        availableTenants: [],
        isLoading: false
      }),
    }),
    {
      name: 'tenant-storage',
      partialize: (state) => ({
        // Persist current tenant selection
        currentTenant: state.currentTenant ? { id: state.currentTenant.id } : null,
      }),
    }
  )
);

// Selector hooks for common patterns
export const useCurrentTenantId = () => useTenantStore(state => state.currentTenant?.id);
export const useIsAdmin = () => useTenantStore(state => {
  const role = state.currentMembership?.role;
  return role === 'admin' || role === 'owner';
});
export const useCanManage = () => useIsAdmin();

