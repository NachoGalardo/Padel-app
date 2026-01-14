import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useTenantStore } from '@/stores/tenantStore';
import { Spinner } from '@/components/ui/LoadingStates';

interface Ranking {
  id: string;
  points: number;
  position: number;
  category: string;
  player_name?: string; // Need to join with profiles/tenant_users
}

export default function RankingsPage() {
  const { currentTenant } = useTenantStore();
  const [rankings, setRankings] = useState<Ranking[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!currentTenant) return;

    async function fetchRankings() {
      try {
        // For now, let's fetch tenant_users sorted by level as a proxy for ranking
        // since the rankings table might be empty until tournaments are played.
        // Or we can try fetching rankings table directly.
        // Let's try fetching tenant_users for now as it's more likely to have data (the user themselves).

        const { data, error } = await (supabase as any)
          .from('tenant_users')
          .select(`
            id,
            level,
            profile:profiles(name)
          `)
          .eq('tenant_id', currentTenant!.id)
          .eq('status', 'active')
          .order('level', { ascending: false });

        if (error) throw error;

        // Transform to ranking shape
        const rankedUsers = (data || []).map((user: any, index: number) => ({
          id: user.id,
          points: 0, // Placeholder
          position: index + 1,
          category: `Nivel ${user.level || '?'}`,
          player_name: user.profile?.name || 'Usuario'
        }));

        setRankings(rankedUsers);
      } catch (error) {
        console.error('Error fetching rankings:', error);
      } finally {
        setIsLoading(false);
      }
    }

    fetchRankings();
  }, [currentTenant]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-display font-bold text-surface-100">
          Rankings
        </h1>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : rankings.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-surface-300 text-lg mb-2">No hay jugadores en el ranking</p>
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-left">
            <thead className="bg-surface-800/50 text-surface-400 text-xs uppercase font-medium">
              <tr>
                <th className="px-6 py-3">Pos</th>
                <th className="px-6 py-3">Jugador</th>
                <th className="px-6 py-3">Categoría</th>
                <th className="px-6 py-3 text-right">Puntos</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-800">
              {rankings.map((ranking) => (
                <tr key={ranking.id} className="hover:bg-surface-800/30 transition-colors">
                  <td className="px-6 py-4 text-surface-300 font-medium">#{ranking.position}</td>
                  <td className="px-6 py-4 text-surface-100 font-medium">{ranking.player_name}</td>
                  <td className="px-6 py-4 text-surface-400">{ranking.category}</td>
                  <td className="px-6 py-4 text-right text-surface-100 font-bold">{ranking.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
