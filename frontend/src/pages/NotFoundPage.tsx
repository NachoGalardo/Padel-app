import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-950">
      <div className="text-center">
        <h1 className="text-6xl font-display font-bold text-primary-500">404</h1>
        <p className="text-xl text-surface-400 mt-4">Página no encontrada</p>
        <Link to="/dashboard" className="btn-primary mt-8 inline-block">
          Volver al inicio
        </Link>
      </div>
    </div>
  );
}

