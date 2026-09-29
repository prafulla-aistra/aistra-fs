import { Navigate, Route, Routes } from 'react-router';
import { RequireAuth, RequirePermission } from '@/auth/guards';
import { navItem } from '@/auth/navigation';
import { AppShell } from '@/components/AppShell';
import { AuditPage } from '@/pages/AuditPage';
import { ChangePasswordPage } from '@/pages/ChangePasswordPage';
import { CalendarTab } from '@/pages/configuration/CalendarTab';
import { ComingNextStep } from '@/pages/configuration/common';
import { ConfigurationLayout } from '@/pages/configuration/ConfigurationLayout';
import { CurrenciesTab } from '@/pages/configuration/CurrenciesTab';
import { DueDatesTab } from '@/pages/configuration/DueDatesTab';
import { EntitiesTab } from '@/pages/configuration/EntitiesTab';
import { GroupStructureTab } from '@/pages/configuration/GroupStructureTab';
import { DashboardPage } from '@/pages/dashboard/DashboardPage';
import { NewTaskPage } from '@/pages/tasks/NewTaskPage';
import { TaskWorkspacePage } from '@/pages/tasks/TaskWorkspacePage';
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
            <Route path="/tasks/new" element={<NewTaskPage />} />
          </Route>
          <Route
            element={
              <RequirePermission
                anyOf={['SFS_PREPARE', 'SFS_REVIEW', 'CFS_PREPARE', 'CFS_REVIEW', 'REPORTS_VIEW']}
              />
            }
          >
            <Route path="/tasks/:id" element={<TaskWorkspacePage />} />
          </Route>
          <Route element={<RequirePermission anyOf={['EDIT_ACCESS_APPROVE']} />}>
            <Route path="/edit-access" element={<ComingSoonPage title="Edit-access requests" />} />
          </Route>
          <Route element={<RequirePermission anyOf={navItem('/configuration').anyOf} />}>
            <Route path="/configuration" element={<ConfigurationLayout />}>
              <Route index element={<Navigate to="entities" replace />} />
              <Route path="entities" element={<EntitiesTab />} />
              <Route path="group" element={<GroupStructureTab />} />
              <Route path="currencies" element={<CurrenciesTab />} />
              <Route path="calendar" element={<CalendarTab />} />
              <Route path="due-dates" element={<DueDatesTab />} />
              <Route path="formats" element={<ComingNextStep title="Formats" />} />
              <Route
                path="chart-of-accounts"
                element={<ComingNextStep title="Chart of accounts" />}
              />
              <Route path="exchange-rates" element={<ComingNextStep title="Exchange rates" />} />
            </Route>
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
