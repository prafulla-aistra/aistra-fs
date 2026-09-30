import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { ChartOfAccountDto } from '@finance-close/shared';
import { Badge } from '@/components/ui/badge';
import { Alert, Field, Select } from '@/components/ui/form';
import { Table, Td, Th } from '@/components/ui/overlay';
import { Skeleton } from '@/components/ui/skeleton';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { SearchBox } from './common';
import { useEntities } from './hooks';

/** Each entity's chart of accounts with its FSLI mapping and source (read-only for now). */
export function ChartOfAccountsTab() {
  const entities = useEntities();
  const [code, setCode] = useState('IN');
  const [search, setSearch] = useState('');
  const accounts = useQuery({
    queryKey: ['config', 'accounts', code],
    queryFn: () => api.get<ChartOfAccountDto[]>(`/config/entities/${code}/accounts`),
  });
  const s = search.trim().toLowerCase();
  const rows = (accounts.data ?? []).filter(
    (a) =>
      !s ||
      a.accountCode.toLowerCase().includes(s) ||
      a.accountName.toLowerCase().includes(s) ||
      a.sourceLabel.toLowerCase().includes(s),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-72">
          <Field label="Entity" htmlFor="coa-entity">
            <Select id="coa-entity" value={code} onChange={(e) => setCode(e.target.value)}>
              {(entities.data ?? []).map((e) => (
                <option key={e.code} value={e.code}>
                  {e.code} · {e.legalName}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <SearchBox value={search} onChange={setSearch} placeholder="Search code, name or source" />
      </div>
      <p className="text-xs text-muted-foreground">
        Mappings are set on the “Review and map” step of a task; editing here comes later.
      </p>
      {accounts.error ? (
        <Alert>{errorMessage(accounts.error)}</Alert>
      ) : !accounts.data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Account name</Th>
              <Th>Account type</Th>
              <Th>FSLI</Th>
              <Th>Counterparty</Th>
              <Th>Source</Th>
              <Th>Last changed</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.accountCode}>
                <Td className="font-mono text-xs">{a.accountCode}</Td>
                <Td>{a.accountName}</Td>
                <Td className="text-xs">{a.accountType ?? '—'}</Td>
                <Td className="text-xs">
                  {a.fsliName ? (
                    <>
                      {a.fsliName} <span className="text-muted-foreground">({a.fsliCode})</span>
                      {a.suggested && (
                        <Badge variant="outline" className="ml-1">
                          suggested
                        </Badge>
                      )}
                    </>
                  ) : (
                    <span className="text-warning-foreground">Unmapped</span>
                  )}
                </Td>
                <Td className="font-mono text-xs">{a.counterpartyCode ?? ''}</Td>
                <Td className="text-xs">{a.sourceLabel}</Td>
                <Td className="text-xs">
                  {a.updatedBy ? `${a.updatedBy}, ` : ''}
                  {formatDateTime(a.updatedAt)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
