import { Navigate, Route, Routes } from 'react-router';
import { RequireAuth, RequirePermission } from '@/auth/guards';
import { navItem } from '@/auth/navigation';
import { AppShell } from '@/components/AppShell';
import { AuditPage } from '@/pages/AuditPage';
import { ChangePasswordPage } from '@/pages/ChangePasswordPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { LoginPage } from '@/pages/LoginPage';
import { ComingSoonPage, NotFoundPage } from '@/pages/SimplePages';
import { UsersPage } from '@/pages/users/UsersPage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/change-password" element={<ChangePasswordPage />} />
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route element={<RequirePermission anyOf={navItem('/tasks/new').anyOf} />}>
            <Route path="/tasks/new" element={<ComingSoonPage title="New task" />} />
          </Route>
          <Route element={<RequirePermission anyOf={navItem('/configuration').anyOf} />}>
            <Route path="/configuration" element={<ComingSoonPage title="Configuration" />} />
          </Route>
          <Route element={<RequirePermission anyOf={navItem('/users').anyOf} />}>
            <Route path="/users" element={<UsersPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={navItem('/audit').anyOf} />}>
            <Route path="/audit" element={<AuditPage />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
