import { useQuery } from '@tanstack/react-query';
import { Permission, type CurrencyDto, type EntityDto } from '@finance-close/shared';
import { useAuth } from '@/auth/AuthContext';
import { api } from '@/lib/api';

/** The Configuration side menu, grouped. */
export const CONFIG_SECTIONS = [
  {
    title: 'Organisation',
    items: [
      { to: '/configuration/entities', label: 'Entities' },
      { to: '/configuration/group', label: 'Group structure' },
    ],
  },
  {
    title: 'Currencies',
    items: [
      { to: '/configuration/currencies', label: 'Currencies' },
      { to: '/configuration/exchange-rates', label: 'Exchange rates' },
    ],
  },
  {
    title: 'Calendar',
    items: [
      { to: '/configuration/calendar', label: 'Financial years and periods' },
      { to: '/configuration/due-dates', label: 'Due dates and holidays' },
    ],
  },
  {
    title: 'Reporting',
    items: [
      { to: '/configuration/formats', label: 'Report formats' },
      { to: '/configuration/fslis', label: 'FSLI master' },
      { to: '/configuration/account-type-defaults', label: 'Account-type defaults' },
      { to: '/configuration/chart-of-accounts', label: 'Chart of accounts' },
    ],
  },
  {
    title: 'Consolidation',
    items: [
      { to: '/configuration/intercompany-pairs', label: 'Intercompany pairs' },
      { to: '/configuration/acquisitions', label: 'Acquisitions' },
    ],
  },
  {
    title: 'Controls',
    items: [
      { to: '/configuration/approvals', label: 'Approvals' },
      { to: '/configuration/control-checks', label: 'Control checks' },
    ],
  },
  { title: 'Access', items: [{ to: '/users', label: 'Users (User management)', adminOnly: true }] },
] as const;

export const NO_CONFIG_ACCESS = 'Needs configuration access – ask your administrator';

/** Only CONFIG_MANAGE can edit; REPORTS_VIEW users see the same pages read-only. */
export function useCanEditConfig(): boolean {
  return useAuth().hasAny(Permission.ConfigManage);
}

export function useEntities() {
  return useQuery({
    queryKey: ['config', 'entities'],
    queryFn: () => api.get<EntityDto[]>('/config/entities'),
  });
}

export function useCurrencies() {
  return useQuery({
    queryKey: ['config', 'currencies'],
    queryFn: () => api.get<CurrencyDto[]>('/config/currencies'),
  });
}

/** Case-insensitive match of `query` against any of the given strings. */
export function matches(query: string, ...fields: (string | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  return !q || fields.some((f) => f?.toLowerCase().includes(q));
}
