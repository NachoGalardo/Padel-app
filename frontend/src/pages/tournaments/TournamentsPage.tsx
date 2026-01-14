import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useTenantStore } from '@/stores/tenantStore';
import { Button } from '@/components/ui/Button';

interface Tournament {
  id: string;
  name: string;
  status: string;
  start_date: string;
  format: string;
  gender: string;
}

export default function TournamentsPage() {
  const navigate = useNavigate();
  const { currentTenant } = useTenantStore();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!currentTenant) return;

    async function fetchTournaments() {
      try {
        const { data, error } = await (supabase
          .from('tournaments') as any)
          .select('*')
          .eq('tenant_id', currentTenant!.id)
          .order('created_at', { ascending: false });

        if (error) throw error;
        setTournaments(data || []);
      } catch (error) {
        console.error('Error fetching tournaments:', error);
      } finally {
        setIsLoading(false);
      }
    }

    fetchTournaments();
  }, [currentTenant]);

  const getStatusBadge = (status: string) => {
    const styles = {
      draft: 'bg-surface-600 text-surface-200',
      registration_open: 'bg-green-900/50 text-green-400',
      in_progress: 'bg-blue-900/50 text-blue-400',
      finished: 'bg-surface-700 text-surface-400',
      cancelled: 'bg-red-900/50 text-red-400',
    };
    const labels = {
      draft: 'Borrador',
      registration_open: 'Inscripción Abierta',
      in_progress: 'En Progreso',
      finished: 'Finalizado',
      cancelled: 'Cancelado',
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status as keyof typeof styles] || styles.draft}`}>
        {labels[status as keyof typeof labels] || status}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-display font-bold text-surface-100">
          Torneos
        </h1>
        <Button onClick={() => navigate('/tournaments/new')}>
          Nuevo Torneo
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-surface-400">Cargando torneos...</div>
      ) : tournaments.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-surface-300 text-lg mb-2">No hay torneos creados</p>
          <p className="text-surface-500 mb-6">Comienza creando tu primer torneo para gestionar la competencia.</p>
          <Button variant="secondary" onClick={() => navigate('/tournaments/new')}>
            Crear mi primer torneo
          </Button>
        </div>
      ) : (
        <div className="grid gap-4">
          {tournaments.map((tournament) => (
            <div
              key={tournament.id}
              className="card hover:bg-surface-800/80 transition-colors cursor-pointer flex items-center justify-between group"
              onClick={() => navigate(`/tournaments/${tournament.id}`)}
            >
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="text-lg font-semibold text-surface-100 group-hover:text-primary-400 transition-colors">
                    {tournament.name}
                  </h3>
                  {getStatusBadge(tournament.status)}
                </div>
                <div className="flex gap-4 text-sm text-surface-400">
                  <span>📅 {new Date(tournament.start_date).toLocaleDateString()}</span>
                  <span className="capitalize">👤 {tournament.gender === 'male' ? 'Masculino' : tournament.gender === 'female' ? 'Femenino' : 'Mixto'}</span>
                  <span className="capitalize">🏆 {tournament.format.replace('_', ' ')}</span>
                </div>
              </div>
              <div className="text-surface-500 group-hover:text-surface-300">
                →
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
