import { useParams } from 'react-router-dom';

export default function TournamentDetailPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-display font-bold text-surface-100">
        Detalle del Torneo
      </h1>
      <div className="card">
        <p className="text-surface-400">
          Torneo ID: {id}
        </p>
        <p className="text-surface-400 mt-2">
          Por implementar
        </p>
      </div>
    </div>
  );
}

