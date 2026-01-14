import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/LoadingStates';
import { TeamRegistrationModal } from '@/components/tournaments/TeamRegistrationModal';

interface Tournament {
  id: string;
  name: string;
  status: string;
  start_date: string;
  end_date: string | null;
  format: string;
  gender: string;
  max_teams: number;
  entry_fee_cents: number;
  currency: string;
  description: string | null;
}

interface TeamEntry {
  id: string;
  status: string;
  team: {
    id: string;
    name: string;
  };
}

export default function TournamentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [entries, setEntries] = useState<TeamEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    if (id) {
      fetchTournamentData();
    }
  }, [id]);

  async function fetchTournamentData() {
    try {
      // Fetch tournament
      const { data: tournamentData, error: tournamentError } = await (supabase
        .from('tournaments') as any)
        .select('*')
        .eq('id', id)
        .single();

      if (tournamentError) throw tournamentError;
      setTournament(tournamentData);

      // Fetch entries
      const { data: entriesData, error: entriesError } = await (supabase
        .from('tournament_entries') as any)
        .select(`
          id,
          status,
          team:teams (
            id,
            name
          )
        `)
        .eq('tournament_id', id);

      if (entriesError) throw entriesError;
      setEntries(entriesData || []);

    } catch (error) {
      console.error('Error fetching tournament data:', error);
    } finally {
      setIsLoading(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="text-center py-12">
        <p className="text-surface-400 mb-4">Torneo no encontrado</p>
        <Button variant="secondary" onClick={() => navigate('/tournaments')}>
          Volver a la lista
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <button
            onClick={() => navigate('/tournaments')}
            className="text-surface-400 hover:text-white transition-colors mb-2 text-sm"
          >
            ← Volver a torneos
          </button>
          <h1 className="text-3xl font-display font-bold text-surface-100">
            {tournament.name}
          </h1>
          <div className="flex gap-4 mt-2 text-surface-400 text-sm">
            <span>📅 {new Date(tournament.start_date).toLocaleDateString()}</span>
            <span className="capitalize">👤 {tournament.gender === 'male' ? 'Masculino' : tournament.gender === 'female' ? 'Femenino' : 'Mixto'}</span>
            <span className="capitalize">🏆 {tournament.format.replace('_', ' ')}</span>
          </div>
        </div>
        <div className="flex gap-3">
          <Button onClick={() => setIsModalOpen(true)}>
            Inscribir Equipo
          </Button>
        </div>
      </div>

      {/* Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Column */}
        <div className="lg:col-span-2 space-y-8">
          {/* Description */}
          <div className="card">
            <h2 className="text-xl font-semibold text-surface-100 mb-4">Detalles</h2>
            <div className="space-y-4 text-surface-300">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="block text-sm text-surface-500">Precio de Inscripción</span>
                  <span className="text-lg font-medium">
                    {tournament.entry_fee_cents > 0
                      ? `$${tournament.entry_fee_cents} ${tournament.currency}`
                      : 'Gratis'}
                  </span>
                </div>
                <div>
                  <span className="block text-sm text-surface-500">Equipos Máximos</span>
                  <span className="text-lg font-medium">{tournament.max_teams}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Teams List */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-surface-100">Equipos Inscriptos</h2>
              <span className="text-sm text-surface-400">{entries.length} / {tournament.max_teams}</span>
            </div>

            {entries.length === 0 ? (
              <div className="text-center py-8 border-2 border-dashed border-surface-800 rounded-lg">
                <p className="text-surface-500">No hay equipos inscriptos aún</p>
                <button
                  onClick={() => setIsModalOpen(true)}
                  className="text-primary-400 hover:text-primary-300 text-sm mt-2 font-medium"
                >
                  Inscribir el primero
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {entries.map((entry) => (
                  <div key={entry.id} className="p-3 bg-surface-800/50 rounded-lg border border-surface-700 flex justify-between items-center">
                    <span className="font-medium text-surface-200">{entry.team.name}</span>
                    <span className={`text-xs px-2 py-1 rounded-full ${entry.status === 'confirmed' ? 'bg-green-900/30 text-green-400' : 'bg-yellow-900/30 text-yellow-400'
                      }`}>
                      {entry.status === 'confirmed' ? 'Confirmado' : 'Pendiente'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <div className="card bg-surface-800/50">
            <h3 className="font-medium text-surface-200 mb-3">Estado</h3>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${tournament.status === 'draft' ? 'bg-surface-400' : 'bg-green-400'
                }`} />
              <span className="capitalize text-surface-100">
                {tournament.status === 'draft' ? 'Borrador' : tournament.status.replace('_', ' ')}
              </span>
            </div>
          </div>
        </div>
      </div>

      <TeamRegistrationModal
        tournamentId={id!}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={fetchTournamentData}
      />
    </div>
  );
}
