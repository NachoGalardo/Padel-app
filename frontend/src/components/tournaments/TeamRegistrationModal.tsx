import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useTenantStore } from '@/stores/tenantStore';
import { Button } from '@/components/ui/Button';
import { FormField, Select } from '@/components/ui/FormField';
import { useToast } from '@/stores/uiStore';

interface Player {
    id: string; // tenant_user_id
    name: string;
}

interface TeamRegistrationModalProps {
    tournamentId: string;
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

export function TeamRegistrationModal({ tournamentId, isOpen, onClose, onSuccess }: TeamRegistrationModalProps) {
    const { currentTenant, currentMembership } = useTenantStore();
    const toast = useToast();

    const [players, setPlayers] = useState<Player[]>([]);
    const [isLoadingPlayers, setIsLoadingPlayers] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [player1Id, setPlayer1Id] = useState<string>('');
    const [player2Id, setPlayer2Id] = useState<string>('');

    useEffect(() => {
        if (isOpen && currentTenant) {
            fetchPlayers();
        }
    }, [isOpen, currentTenant]);

    // Pre-select current user as player 1 if they are opening the modal
    useEffect(() => {
        if (currentMembership && !player1Id) {
            setPlayer1Id(currentMembership.tenantUserId);
        }
    }, [currentMembership, isOpen]);

    async function fetchPlayers() {
        setIsLoadingPlayers(true);
        try {
            const { data, error } = await (supabase as any)
                .from('tenant_users')
                .select(`
          id,
          profile:profiles!tenant_users_profile_id_fkey(name)
        `)
                .eq('tenant_id', currentTenant?.id)
                .eq('status', 'active');

            if (error) throw error;

            const formattedPlayers = data.map((u: any) => ({
                id: u.id,
                name: u.profile?.name || 'Sin nombre',
            })).sort((a: any, b: any) => a.name.localeCompare(b.name));

            setPlayers(formattedPlayers);
        } catch (error) {
            console.error('Error fetching players:', error);
            toast.error('Error', 'No se pudieron cargar los jugadores');
        } finally {
            setIsLoadingPlayers(false);
        }
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!player1Id || !player2Id) {
            toast.error('Error', 'Debes seleccionar dos jugadores');
            return;
        }
        if (player1Id === player2Id) {
            toast.error('Error', 'Los jugadores deben ser diferentes');
            return;
        }

        setIsSubmitting(true);
        try {
            // 1. Check if team exists
            // We'll do a simplified check: fetch teams for player 1, then check if player 2 is in any of them

            // Get all team IDs for player 1
            const { data: p1Teams } = await (supabase
                .from('team_members') as any)
                .select('team_id')
                .eq('tenant_user_id', player1Id);

            const p1TeamIds = p1Teams?.map((t: any) => t.team_id) || [];

            let teamId = null;

            if (p1TeamIds.length > 0) {
                // Check if player 2 is in any of these teams
                const { data: commonTeams } = await (supabase
                    .from('team_members') as any)
                    .select('team_id')
                    .eq('tenant_user_id', player2Id)
                    .in('team_id', p1TeamIds);

                if (commonTeams && commonTeams.length > 0) {
                    teamId = commonTeams[0].team_id;
                }
            }

            // 2. If no team, create one
            if (!teamId) {
                const p1Name = players.find(p => p.id === player1Id)?.name.split(' ')[0];
                const p2Name = players.find(p => p.id === player2Id)?.name.split(' ')[0];
                const teamName = `${p1Name} / ${p2Name}`;

                const { data: newTeam, error: teamError } = await (supabase
                    .from('teams') as any)
                    .insert({
                        tenant_id: currentTenant?.id,
                        name: teamName,
                        gender: 'mixed', // Default
                        is_active: true
                    })
                    .select()
                    .single();

                if (teamError) throw teamError;
                teamId = newTeam.id;

                // Add members
                const { error: membersError } = await (supabase
                    .from('team_members') as any)
                    .insert([
                        { team_id: teamId, tenant_user_id: player1Id, position: 1 },
                        { team_id: teamId, tenant_user_id: player2Id, position: 2 }
                    ]);

                if (membersError) throw membersError;
            }

            // 3. Register team to tournament
            const { error: entryError } = await (supabase
                .from('tournament_entries') as any)
                .insert({
                    tenant_id: currentTenant?.id,
                    tournament_id: tournamentId,
                    team_id: teamId,
                    registered_by: currentMembership?.tenantUserId,
                    status: 'pending_payment'
                });

            if (entryError) {
                if (entryError.code === '23505') { // Unique violation
                    toast.error('Error', 'Este equipo ya está inscripto en el torneo');
                } else {
                    throw entryError;
                }
                return;
            }

            toast.success('Éxito', 'Equipo inscripto correctamente');
            onSuccess();
            onClose();

        } catch (error: any) {
            console.error('Error registering team:', error);
            toast.error('Error', error.message || 'No se pudo inscribir el equipo');
        } finally {
            setIsSubmitting(false);
        }
    }

    if (!isOpen) return null;

    const playerOptions = players.map(p => ({ value: p.id, label: p.name }));

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-surface-900 border border-surface-800 rounded-xl shadow-xl w-full max-w-md overflow-hidden">
                <div className="p-6 border-b border-surface-800">
                    <h2 className="text-xl font-bold text-surface-100">Inscribir Equipo</h2>
                    <p className="text-sm text-surface-400 mt-1">Selecciona los dos jugadores para el equipo</p>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    <FormField label="Jugador 1">
                        <Select
                            value={player1Id}
                            onChange={(e) => setPlayer1Id(e.target.value)}
                            options={[{ value: '', label: 'Seleccionar jugador...' }, ...playerOptions]}
                            disabled={isLoadingPlayers}
                        />
                    </FormField>

                    <FormField label="Jugador 2">
                        <Select
                            value={player2Id}
                            onChange={(e) => setPlayer2Id(e.target.value)}
                            options={[{ value: '', label: 'Seleccionar jugador...' }, ...playerOptions]}
                            disabled={isLoadingPlayers}
                        />
                    </FormField>

                    <div className="flex justify-end gap-3 pt-2">
                        <Button variant="secondary" type="button" onClick={onClose}>
                            Cancelar
                        </Button>
                        <Button type="submit" isLoading={isSubmitting}>
                            Inscribir
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
}
