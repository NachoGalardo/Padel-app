import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useTenantStore } from '@/stores/tenantStore';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/LoadingStates';
import { CreateMemberModal } from '@/components/members/CreateMemberModal';

interface Member {
    id: string;
    role: string;
    status: string;
    profile: {
        name: string;
        email: string | null;
        phone: string | null;
        gender: string | null;
    };
}

export default function MembersPage() {
    const { currentTenant } = useTenantStore();
    const [members, setMembers] = useState<Member[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);

    useEffect(() => {
        if (currentTenant) {
            fetchMembers();
        }
    }, [currentTenant]);

    async function fetchMembers() {
        setIsLoading(true);
        try {
            const { data, error } = await (supabase as any)
                .from('tenant_users')
                .select(`
          id,
          role,
          status,
          profile:profiles!tenant_users_profile_id_fkey(name, email, phone, gender)
        `)
                .eq('tenant_id', currentTenant?.id)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setMembers(data || []);
        } catch (error) {
            console.error('Error fetching members:', error);
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-display font-bold text-surface-100">
                    Jugadores
                </h1>
                <Button onClick={() => setIsModalOpen(true)}>
                    Nuevo Jugador
                </Button>
            </div>

            {isLoading ? (
                <div className="flex justify-center py-12">
                    <Spinner size="lg" />
                </div>
            ) : members.length === 0 ? (
                <div className="card text-center py-12">
                    <p className="text-surface-300 text-lg mb-2">No hay jugadores registrados</p>
                    <Button variant="secondary" onClick={() => setIsModalOpen(true)}>
                        Crear el primero
                    </Button>
                </div>
            ) : (
                <div className="card overflow-hidden p-0">
                    <table className="w-full text-left">
                        <thead className="bg-surface-800/50 text-surface-400 text-xs uppercase font-medium">
                            <tr>
                                <th className="px-6 py-3">Nombre</th>
                                <th className="px-6 py-3">Rol</th>
                                <th className="px-6 py-3">Contacto</th>
                                <th className="px-6 py-3">Estado</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-surface-800">
                            {members.map((member) => (
                                <tr key={member.id} className="hover:bg-surface-800/30 transition-colors">
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-surface-700 flex items-center justify-center text-xs font-bold text-surface-300">
                                                {member.profile.name[0]?.toUpperCase()}
                                            </div>
                                            <div>
                                                <p className="font-medium text-surface-100">{member.profile.name}</p>
                                                <p className="text-xs text-surface-500 capitalize">{member.profile.gender === 'male' ? 'Masculino' : member.profile.gender === 'female' ? 'Femenino' : ''}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`text-xs px-2 py-1 rounded-full capitalize ${member.role === 'owner' ? 'bg-purple-900/30 text-purple-400' :
                                            member.role === 'admin' ? 'bg-blue-900/30 text-blue-400' :
                                                'bg-surface-700 text-surface-300'
                                            }`}>
                                            {member.role}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-sm text-surface-400">
                                        <div className="flex flex-col">
                                            <span>{member.profile.email || '-'}</span>
                                            <span className="text-xs text-surface-500">{member.profile.phone}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`text-xs px-2 py-1 rounded-full capitalize ${member.status === 'active' ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'
                                            }`}>
                                            {member.status}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <CreateMemberModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSuccess={fetchMembers}
            />
        </div>
    );
}
