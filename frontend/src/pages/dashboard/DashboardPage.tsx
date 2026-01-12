import { useTenantStore } from '@/stores/tenantStore';

export default function DashboardPage() {
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
          value="3"
          change="+1 este mes"
          trend="up"
        />
        <StatCard
          title="Partidos Hoy"
          value="8"
          change="2 pendientes"
          trend="neutral"
        />
        <StatCard
          title="Jugadores"
          value="124"
          change="+12 este mes"
          trend="up"
        />
        <StatCard
          title="Tu Ranking"
          value="#15"
          change="↑3 posiciones"
          trend="up"
        />
      </div>

      {/* Quick actions */}
      {currentMembership?.role !== 'player' && (
        <div className="card">
          <h2 className="text-lg font-semibold text-surface-100 mb-4">
            Acciones Rápidas
          </h2>
          <div className="flex flex-wrap gap-3">
            <button className="btn-primary">
              Crear Torneo
            </button>
            <button className="btn-secondary">
              Programar Partido
            </button>
            <button className="btn-secondary">
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
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex items-center gap-4 p-3 rounded-lg bg-surface-800/50"
            >
              <div className="w-10 h-10 rounded-full bg-primary-600/20 flex items-center justify-center">
                <span className="text-primary-400">🏆</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-surface-200">
                  Torneo de Verano - Cuartos de Final
                </p>
                <p className="text-xs text-surface-500">
                  Hace {i} hora{i > 1 ? 's' : ''}
                </p>
              </div>
              <span className="badge-success">Finalizado</span>
            </div>
          ))}
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

