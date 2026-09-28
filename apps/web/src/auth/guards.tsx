import { Navigate, Outlet, useLocation } from 'react-router';
import type { PermissionCode } from '@finance-close/shared';
import { NoAccessPage } from '@/pages/SimplePages';
import { useAuth } from './AuthContext';

/** Signed-in users only; users with a temporary password are sent to change it first. */
export function RequireAuth() {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === 'loading') return <FullPageMessage text="Loading…" />;
  if (state.status === 'anonymous') {
    const next = location.pathname + location.search;
    return (
      <Navigate to={`/login${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`} replace />
    );
  }
  if (state.user.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  return <Outlet />;
}

/**
 * Shows the page only to users holding at least one of the permissions; everyone else sees
 * "You don't have access" (the API enforces the same rule independently).
 */
export function RequirePermission({ anyOf }: { anyOf: PermissionCode[] }) {
  const { hasAny } = useAuth();
  return hasAny(...anyOf) ? <Outlet /> : <NoAccessPage />;
}

export function FullPageMessage({ text }: { text: string }) {
  return (
    <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
