/**
 * =============================================================================
 * GUARD: REQUIRE COMPLETE PROFILE
 * =============================================================================
 * 
 * HOC y componente para bloquear acceso a usuarios con perfil incompleto.
 * Redirige a la página de completar perfil con mensaje claro.
 */

import { Navigate, useLocation } from 'react-router-dom';
import { useProfile } from '@/hooks/useProfile';
import { Spinner } from '@/components/ui/LoadingStates';

interface RequireCompleteProfileProps {
  children: React.ReactNode;
  /** Mensaje personalizado para mostrar en la página de completar perfil */
  reason?: string;
}

/**
 * Envuelve rutas que requieren perfil completo.
 * Si el perfil está incompleto, redirige a /complete-profile.
 */
export function RequireCompleteProfile({ 
  children, 
  reason 
}: RequireCompleteProfileProps) {
  const location = useLocation();
  const { profile, isLoading, isComplete } = useProfile();

  // Mostrar loading mientras carga el perfil
  if (isLoading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-950">
        <Spinner size="lg" />
      </div>
    );
  }

  // Redirigir si el perfil está incompleto
  if (!isComplete) {
    return (
      <Navigate 
        to="/complete-profile" 
        state={{ 
          from: location.pathname,
          reason: reason ?? 'Completá tu perfil para continuar',
        }}
        replace 
      />
    );
  }

  return <>{children}</>;
}

/**
 * HOC para envolver componentes que requieren perfil completo.
 */
export function withCompleteProfile<P extends object>(
  Component: React.ComponentType<P>,
  reason?: string
) {
  return function WrappedComponent(props: P) {
    return (
      <RequireCompleteProfile reason={reason}>
        <Component {...props} />
      </RequireCompleteProfile>
    );
  };
}

// =============================================================================
// PROFILE INCOMPLETE MODAL
// =============================================================================

interface ProfileIncompleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  action: string;
  missingFields: string[];
}

/**
 * Modal que se muestra cuando el usuario intenta una acción
 * que requiere perfil completo.
 */
export function ProfileIncompleteModal({
  isOpen,
  onClose,
  action,
  missingFields,
}: ProfileIncompleteModalProps) {
  if (!isOpen) return null;

  const fieldLabels: Record<string, string> = {
    name: 'Nombre completo',
    gender: 'Género',
    contact: 'Email o teléfono',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-surface-900 border border-surface-700 rounded-2xl p-6 max-w-md w-full shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        {/* Icon */}
        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 rounded-full bg-amber-500/20 flex items-center justify-center">
            <UserAlertIcon className="w-8 h-8 text-amber-400" />
          </div>
        </div>

        {/* Content */}
        <div className="text-center mb-6">
          <h2 className="text-xl font-bold text-white mb-2">
            Completá tu perfil
          </h2>
          <p className="text-surface-400">
            Para <strong className="text-surface-200">{action}</strong>, necesitás completar tu perfil primero.
          </p>
        </div>

        {/* Missing fields */}
        <div className="bg-surface-800/50 rounded-xl p-4 mb-6">
          <p className="text-sm text-surface-300 mb-2">Campos faltantes:</p>
          <ul className="space-y-1">
            {missingFields.map((field) => (
              <li key={field} className="flex items-center gap-2 text-sm text-surface-400">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                {fieldLabels[field] ?? field}
              </li>
            ))}
          </ul>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-lg border border-surface-700 text-surface-300 hover:bg-surface-800 transition-colors"
          >
            Cancelar
          </button>
          <a
            href="/complete-profile"
            className="flex-1 px-4 py-2.5 rounded-lg bg-gradient-to-r from-primary-600 to-primary-500 text-white font-medium text-center hover:from-primary-500 hover:to-primary-400 transition-all"
          >
            Completar ahora
          </a>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// HOOK: useProfileGate
// =============================================================================

import { useState, useCallback } from 'react';

interface UseProfileGateReturn {
  /** Verificar si puede realizar acción. Muestra modal si no. */
  checkAndProceed: (action: string, onAllowed: () => void) => void;
  /** Modal component */
  ProfileGateModal: React.FC;
}

/**
 * Hook para verificar perfil completo antes de acciones.
 * Muestra un modal si el perfil está incompleto.
 */
export function useProfileGate(): UseProfileGateReturn {
  const { isComplete, missingFields } = useProfile();
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    action: string;
  }>({ isOpen: false, action: '' });

  const checkAndProceed = useCallback((
    action: string,
    onAllowed: () => void
  ) => {
    if (isComplete) {
      onAllowed();
    } else {
      setModalState({ isOpen: true, action });
    }
  }, [isComplete]);

  const closeModal = useCallback(() => {
    setModalState({ isOpen: false, action: '' });
  }, []);

  const ProfileGateModal = useCallback(() => (
    <ProfileIncompleteModal
      isOpen={modalState.isOpen}
      onClose={closeModal}
      action={modalState.action}
      missingFields={missingFields}
    />
  ), [modalState, closeModal, missingFields]);

  return {
    checkAndProceed,
    ProfileGateModal,
  };
}

// =============================================================================
// ICONS
// =============================================================================

function UserAlertIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  );
}

