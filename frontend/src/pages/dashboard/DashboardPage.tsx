import { useNavigate } from 'react-router-dom';
import { useTenantStore } from '@/stores/tenantStore';

export default function DashboardPage() {
  const navigate = useNavigate();
  const { currentTenant, currentMembership } = useTenantStore();

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-display font-bold text-surface-100">
          Dashboard
        </h1>
        <p className="text-surface-400 mt-1">
          Bienvenido a {currentTenant?.name}
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Torneos Activos"
          value="0"
          change="Sin actividad"
          trend="neutral"
        />
        <StatCard
          title="Partidos Hoy"
          value="0"
          change="Sin partidos"
          trend="neutral"
        />
        <StatCard
          title="Jugadores"
          value="-"
          change="-"
          trend="neutral"
        />
        <StatCard
          title="Tu Ranking"
          value="-"
          change="-"
          trend="neutral"
        />
      </div>

      {/* Quick actions */}
      {currentMembership?.role !== 'player' && (
        <div className="card">
          <h2 className="text-lg font-semibold text-surface-100 mb-4">
            Acciones Rápidas
          </h2>
          <div className="flex flex-wrap gap-3">
            <button
              className="btn-primary"
              onClick={() => navigate('/tournaments/new')}
            >
              Crear Torneo
            </button>
            <button
              className="btn-secondary"
              onClick={() => navigate('/matches')}
            >
              Programar Partido
            </button>
            <button
              className="btn-secondary"
              onClick={() => navigate('/settings')}
            >
              Invitar Jugador
            </button>
          </div>
        </div>
      )}

      {/* Recent activity */}
      <div className="card">
        <h2 className="text-lg font-semibold text-surface-100 mb-4">
          Actividad Reciente
        </h2>
        <div className="text-center py-8">
          <p className="text-surface-500">No hay actividad reciente para mostrar</p>
        </div>
      </div>
    </div>
  );
}

interface StatCardProps {
  title: string;
  value: string;
  change: string;
  trend: 'up' | 'down' | 'neutral';
}

function StatCard({ title, value, change, trend }: StatCardProps) {
  const trendColors = {
    up: 'text-green-400',
    down: 'text-red-400',
    neutral: 'text-surface-400',
  };

  return (
    <div className="card">
      <p className="text-sm text-surface-400">{title}</p>
      <p className="text-3xl font-display font-bold text-surface-100 mt-1">
        {value}
      </p>
      <p className={`text-sm mt-2 ${trendColors[trend]}`}>{change}</p>
    </div>
  );
}
