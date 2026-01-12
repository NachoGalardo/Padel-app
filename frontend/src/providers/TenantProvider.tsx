import { useEffect, type ReactNode } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useTenantStore, type Tenant, type TenantMembership } from '@/stores/tenantStore';
import { supabase } from '@/lib/supabase';

interface TenantProviderProps {
  children: ReactNode;
}

export function TenantProvider({ children }: TenantProviderProps) {
  const { user, isAuthenticated } = useAuthStore();
  const { 
    setCurrentTenant, 
    setAvailableTenants, 
    setLoading,
    currentTenant,
    clear 
  } = useTenantStore();

  useEffect(() => {
    if (!isAuthenticated || !user) {
      clear();
      return;
    }

    async function loadTenants() {
      setLoading(true);
      
      try {
        // Get user's tenant memberships
        const { data: memberships, error } = await supabase
          .from('tenant_users')
          .select(`
            id,
            role,
            status,
            tenant:tenants (
              id,
              name,
              slug,
              plan,
              status,
              logo_url
            )
          `)
          .eq('profile_id', user.id)
          .eq('status', 'active');

        if (error) {
          console.error('[Tenant] Error loading memberships:', error);
          setLoading(false);
          return;
        }

        if (!memberships || memberships.length === 0) {
          setAvailableTenants([]);
          setCurrentTenant(null);
          return;
        }

        // Transform to Tenant array
        const tenants: Tenant[] = memberships
          .filter(m => m.tenant)
          .map(m => ({
            id: m.tenant!.id,
            name: m.tenant!.name,
            slug: m.tenant!.slug,
            plan: m.tenant!.plan,
            status: m.tenant!.status,
            logoUrl: m.tenant!.logo_url ?? undefined,
          }));

        setAvailableTenants(tenants);

        // Set current tenant (first one or previously selected)
        const savedTenantId = currentTenant?.id;
        const targetTenant = savedTenantId 
          ? tenants.find(t => t.id === savedTenantId) ?? tenants[0]
          : tenants[0];

        if (targetTenant) {
          const membership = memberships.find(
            m => m.tenant?.id === targetTenant.id
          );
          
          const tenantMembership: TenantMembership | null = membership ? {
            tenantId: targetTenant.id,
            tenantUserId: membership.id,
            role: membership.role,
            status: membership.status,
          } : null;

          setCurrentTenant(targetTenant, tenantMembership);
        }
      } catch (err) {
        console.error('[Tenant] Unexpected error:', err);
      } finally {
        setLoading(false);
      }
    }

    loadTenants();
  }, [isAuthenticated, user, setCurrentTenant, setAvailableTenants, setLoading, clear, currentTenant?.id]);

  return <>{children}</>;
}

