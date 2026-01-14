import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useTenantStore } from '@/stores/tenantStore';
import { Spinner } from '@/components/ui/LoadingStates';

interface Match {
  id: string;
  tournament_id: string;
  status: string;
  start_time: string | null;
  court_name: string | null;
  tournament?: {
    name: string;
  };
}

export default function MatchesPage() {
  const { currentTenant } = useTenantStore();
  const [matches, setMatches] = useState<Match[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!currentTenant) return;

    async function fetchMatches() {
      try {
        const { data, error } = await (supabase
          .from('matches') as any)
          .select(`
            *,
            tournament:tournaments(name)
          `)
          .eq('tenant_id', currentTenant!.id)
          .order('start_time', { ascending: true });

        if (error) throw error;
        setMatches(data || []);
      } catch (error) {
        console.error('Error fetching matches:', error);
      } finally {
        setIsLoading(false);
      }
    }

    fetchMatches();
  }, [currentTenant]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-display font-bold text-surface-100">
          Partidos
        </h1>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : matches.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-surface-300 text-lg mb-2">No hay partidos programados</p>
          <p className="text-surface-500">Los partidos aparecerán aquí cuando se generen los cuadros de los torneos.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {matches.map((match) => (
            <div key={match.id} className="card flex items-center justify-between">
              <div>
                <p className="text-sm text-surface-400 mb-1">{match.tournament?.name}</p>
                <p className="font-medium text-surface-100">
                  {match.start_time ? new Date(match.start_time).toLocaleString() : 'Por programar'}
                </p>
                {match.court_name && (
                  <p className="text-sm text-surface-500 mt-1">📍 {match.court_name}</p>
                )}
              </div>
              <div className="text-right">
                <span className="px-2 py-1 rounded-full text-xs font-medium bg-surface-700 text-surface-300 capitalize">
                  {match.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
