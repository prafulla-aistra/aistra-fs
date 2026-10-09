import { Navigate, Route, Routes } from 'react-router';
import { RequireAuth, RequirePermission } from '@/auth/guards';
import { navItem } from '@/auth/navigation';
import { AppShell } from '@/components/AppShell';
import { AuditPage } from '@/pages/AuditPage';
import { ChangePasswordPage } from '@/pages/ChangePasswordPage';
import { CalendarTab } from '@/pages/configuration/CalendarTab';
import { ChartOfAccountsTab } from '@/pages/configuration/ChartOfAccountsTab';
import { EntityDetailPage } from '@/pages/configuration/EntityDetailPage';
import { EntityWizardPage } from '@/pages/configuration/EntityWizardPage';
import {
  AccountTypeDefaultsPage,
  ExchangeRatesPage,
  FormatsPage,
  FsliPage,
} from '@/pages/configuration/ReferencePages';
import { ConfigurationLayout } from '@/pages/configuration/ConfigurationLayout';
import { CurrenciesTab } from '@/pages/configuration/CurrenciesTab';
import { DueDatesTab } from '@/pages/configuration/DueDatesTab';
import { EntitiesTab } from '@/pages/configuration/EntitiesTab';
import { GroupStructureTab } from '@/pages/configuration/GroupStructureTab';
import { IntegrationsPage } from '@/pages/configuration/IntegrationsPage';
import { ApprovalsPage, ControlChecksPage } from '@/pages/configuration/ControlsPages';
import { AcquisitionsPage, IntercompanyPairsPage } from '@/pages/configuration/ConsolidationPages';
import { DashboardPage } from '@/pages/dashboard/DashboardPage';
import { EditAccessPage } from '@/pages/EditAccessPage';
import { NewTaskPage } from '@/pages/tasks/NewTaskPage';
import { TaskWorkspacePage } from '@/pages/tasks/TaskWorkspacePage';
import { LoginPage } from '@/pages/LoginPage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { NotFoundPage } from '@/pages/SimplePages';
import { UsersPage } from '@/pages/users/UsersPage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
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
            <Route path="/edit-access" element={<EditAccessPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={navItem('/configuration').anyOf} />}>
            <Route path="/configuration" element={<ConfigurationLayout />}>
              <Route index element={<Navigate to="entities" replace />} />
              <Route path="entities" element={<EntitiesTab />} />
              <Route path="entities/new" element={<EntityWizardPage />} />
              <Route path="entities/:code" element={<EntityDetailPage />} />
              <Route path="group" element={<GroupStructureTab />} />
              <Route path="currencies" element={<CurrenciesTab />} />
              <Route path="calendar" element={<CalendarTab />} />
              <Route path="due-dates" element={<DueDatesTab />} />
              <Route path="formats" element={<FormatsPage />} />
              <Route path="fslis" element={<FsliPage />} />
              <Route path="account-type-defaults" element={<AccountTypeDefaultsPage />} />
              <Route path="chart-of-accounts" element={<ChartOfAccountsTab />} />
              <Route path="exchange-rates" element={<ExchangeRatesPage />} />
              <Route path="approvals" element={<ApprovalsPage />} />
              <Route path="control-checks" element={<ControlChecksPage />} />
              <Route path="intercompany-pairs" element={<IntercompanyPairsPage />} />
              <Route path="acquisitions" element={<AcquisitionsPage />} />
              <Route path="integrations" element={<IntegrationsPage />} />
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
