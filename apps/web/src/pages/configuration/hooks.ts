import { useQuery } from '@tanstack/react-query';
import { Permission, type CurrencyDto, type EntityDto } from '@finance-close/shared';
import { useAuth } from '@/auth/AuthContext';
import { api } from '@/lib/api';

export const CONFIG_TABS = [
  { to: 'entities', label: 'Entities' },
  { to: 'group', label: 'Group structure' },
  { to: 'currencies', label: 'Currencies' },
  { to: 'calendar', label: 'Financial years and periods' },
  { to: 'due-dates', label: 'Due dates and holidays' },
  { to: 'formats', label: 'Formats', later: true },
  { to: 'chart-of-accounts', label: 'Chart of accounts' },
  { to: 'exchange-rates', label: 'Exchange rates', later: true },
] as const;

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
