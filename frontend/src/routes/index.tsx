import { Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useTenantStore } from '@/stores/tenantStore';
import { MainLayout } from '@/components/layout/MainLayout';
import { LoadingScreen } from '@/components/ui/LoadingScreen';
import { RequireCompleteProfile } from '@/components/guards/RequireCompleteProfile';

// Lazy load pages - Auth
const LoginPage = lazy(() => import('@/pages/auth/LoginPage'));
const VerifyOtpPage = lazy(() => import('@/pages/auth/VerifyOtpPage'));
const CompleteProfilePage = lazy(() => import('@/pages/auth/CompleteProfilePage'));
const AuthCallbackPage = lazy(() => import('@/pages/auth/AuthCallbackPage'));

// Lazy load pages - Profile
const EditProfilePage = lazy(() => import('@/pages/profile/EditProfilePage'));

// Lazy load pages - App
const DashboardPage = lazy(() => import('@/pages/dashboard/DashboardPage'));
const TournamentsPage = lazy(() => import('@/pages/tournaments/TournamentsPage'));
const TournamentDetailPage = lazy(() => import('@/pages/tournaments/TournamentDetailPage'));
const MatchesPage = lazy(() => import('@/pages/matches/MatchesPage'));
const RankingsPage = lazy(() => import('@/pages/rankings/RankingsPage'));
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));

// =============================================================================
// ROUTE GUARDS
// =============================================================================

/** Rutas públicas - redirige a dashboard si ya está logueado */
function PublicOnlyRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

/** Rutas que requieren autenticación */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading: authLoading } = useAuthStore();
  const { currentTenant, isLoading: tenantLoading } = useTenantStore();

  if (authLoading || tenantLoading) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!currentTenant) {
    return <Navigate to="/select-tenant" replace />;
  }

  return <>{children}</>;
}

/** Rutas que requieren autenticación pero NO tenant (ej: completar perfil) */
function AuthOnlyRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

/** Rutas solo para admins */
function AdminRoute({ children }: { children: React.ReactNode }) {
  const { currentMembership } = useTenantStore();
  const isAdmin = currentMembership?.role === 'admin' || currentMembership?.role === 'owner';

  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

// =============================================================================
// ROUTES
// =============================================================================

export function AppRoutes() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        {/* ============================================
            PUBLIC ROUTES (only for non-authenticated)
            ============================================ */}
        <Route
          path="/login"
          element={
            <PublicOnlyRoute>
              <LoginPage />
            </PublicOnlyRoute>
          }
        />
        <Route
          path="/auth/verify"
          element={
            <PublicOnlyRoute>
              <VerifyOtpPage />
            </PublicOnlyRoute>
          }
        />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />

        {/* ============================================
            AUTH-ONLY ROUTES (no tenant required)
            ============================================ */}
        <Route
          path="/complete-profile"
          element={
            <AuthOnlyRoute>
              <CompleteProfilePage />
            </AuthOnlyRoute>
          }
        />

        {/* ============================================
            PROTECTED ROUTES (auth + tenant required)
            ============================================ */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <MainLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          
          {/* Dashboard */}
          <Route path="dashboard" element={<DashboardPage />} />
          
          {/* Profile */}
          <Route path="profile" element={<EditProfilePage />} />
          
          {/* Tournaments - requiere perfil completo para inscribirse */}
          <Route path="tournaments" element={<TournamentsPage />} />
          <Route
            path="tournaments/:id"
            element={
              <RequireCompleteProfile reason="inscribirte a torneos">
                <TournamentDetailPage />
              </RequireCompleteProfile>
            }
          />
          
          {/* Matches - requiere perfil completo para reportar */}
          <Route
            path="matches"
            element={
              <RequireCompleteProfile reason="ver y reportar partidos">
                <MatchesPage />
              </RequireCompleteProfile>
            }
          />
          
          {/* Rankings */}
          <Route path="rankings" element={<RankingsPage />} />
          
          {/* Admin only */}
          <Route
            path="settings"
            element={
              <AdminRoute>
                <SettingsPage />
              </AdminRoute>
            }
          />
        </Route>

        {/* ============================================
            404
            ============================================ */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
