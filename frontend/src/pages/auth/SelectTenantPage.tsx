import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useTenantStore, type Tenant, type TenantMembership } from '@/stores/tenantStore';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/LoadingStates';
import { useToast } from '@/stores/uiStore';

export default function SelectTenantPage() {
    const navigate = useNavigate();
    const { user } = useAuthStore();
    const { setCurrentTenant } = useTenantStore();
    const toast = useToast();

    const [loading, setLoading] = useState(true);
    const [tenants, setTenants] = useState<{ tenant: Tenant; membership: TenantMembership }[]>([]);

    useEffect(() => {
        async function loadTenants() {
            if (!user) return;

            try {
                // Fetch memberships and tenants
                // Note: RLS policies must allow this query
                const { data, error } = await supabase
                    .from('tenant_users')
                    .select(`
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
                    .eq('profile_id', user.id);

                if (error) throw error;

                const formattedTenants = data.map((item: any) => ({
                    tenant: {
                        id: item.tenant.id,
                        name: item.tenant.name,
                        slug: item.tenant.slug,
                        plan: item.tenant.plan,
                        status: item.tenant.status,
                        logoUrl: item.tenant.logo_url,
                    },
                    membership: {
                        tenantId: item.tenant.id,
                        tenantUserId: item.id, // This might be missing if not selected, but we need the membership ID? No, tenant_users ID.
                        role: item.role,
                        status: item.status,
                    }
                }));

                setTenants(formattedTenants);

                // Auto-select if only one tenant
                if (formattedTenants.length === 1) {
                    handleSelectTenant(formattedTenants[0].tenant, formattedTenants[0].membership);
                }
            } catch (error) {
                console.error('Error loading tenants:', error);
                toast.error('Error', 'No se pudieron cargar tus organizaciones');
            } finally {
                setLoading(false);
            }
        }

        loadTenants();
    }, [user]);

    const handleSelectTenant = (tenant: Tenant, membership: TenantMembership) => {
        setCurrentTenant(tenant, membership);
        navigate('/dashboard');
    };

    const handleLogout = async () => {
        await supabase.auth.signOut();
        navigate('/login');
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-surface-950">
                <Spinner size="lg" />
            </div>
        );
    }

    return (
        <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-surface-950">
            <div className="w-full max-w-md space-y-8">
                <div className="text-center">
                    <h1 className="text-3xl font-bold text-white">Selecciona una Organización</h1>
                    <p className="mt-2 text-surface-400">
                        Elige dónde quieres trabajar hoy
                    </p>
                </div>

                <div className="space-y-4">
                    {tenants.length === 0 ? (
                        <div className="text-center p-6 bg-surface-900 rounded-lg border border-surface-800">
                            <p className="text-surface-300 mb-4">No perteneces a ninguna organización aún.</p>
                            <Button variant="primary" onClick={() => window.location.href = 'mailto:soporte@apppadel.com'}>
                                Contactar Soporte
                            </Button>
                        </div>
                    ) : (
                        tenants.map(({ tenant, membership }) => (
                            <button
                                key={tenant.id}
                                onClick={() => handleSelectTenant(tenant, membership)}
                                className="w-full p-4 flex items-center justify-between bg-surface-900 hover:bg-surface-800 border border-surface-800 rounded-xl transition-colors group"
                            >
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-lg bg-surface-800 flex items-center justify-center text-xl font-bold text-surface-300 group-hover:text-white group-hover:bg-primary-600 transition-colors">
                                        {tenant.name.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="text-left">
                                        <h3 className="text-white font-medium group-hover:text-primary-400 transition-colors">
                                            {tenant.name}
                                        </h3>
                                        <p className="text-sm text-surface-400 capitalize">
                                            {membership.role}
                                        </p>
                                    </div>
                                </div>
                                <div className="text-surface-500 group-hover:text-primary-400">
                                    →
                                </div>
                            </button>
                        ))
                    )}
                </div>

                <div className="text-center">
                    <button
                        onClick={handleLogout}
                        className="text-sm text-surface-500 hover:text-surface-300 transition-colors"
                    >
                        Cerrar sesión
                    </button>
                </div>
            </div>
        </div>
    );
}
