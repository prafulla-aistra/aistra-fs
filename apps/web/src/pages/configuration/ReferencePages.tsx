import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type {
  AccountTypeDefaultDto,
  ExchangeRateRowDto,
  FormatDto,
  FsliDto,
  RateSaveResultDto,
} from '@finance-close/shared';
import { Badge } from '@/components/ui/badge';
import { Alert, Select } from '@/components/ui/form';
import { Table, Td, Th } from '@/components/ui/overlay';
import { Skeleton } from '@/components/ui/skeleton';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { toast } from '@/lib/toast';
import { SearchBox } from './common';
import { ConfigPage, EditButton, EmptyState } from './ConfigPage';
import { matches } from './hooks';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthText = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]}-${iso.slice(0, 4)}`;

export function ExchangeRatesPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['config', 'exchange-rates'],
    queryFn: () => api.get<ExchangeRateRowDto[]>('/config/exchange-rates'),
  });
  const [currency, setCurrency] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: (f: File) => api.upload<RateSaveResultDto>('/exchange-rates/upload', f),
    onSuccess: async (r) => {
      toast(`Rate file loaded: ${r.changed} changed, ${r.unchanged} unchanged.`);
      await qc.invalidateQueries({ queryKey: ['config', 'exchange-rates'] });
    },
  });
  const rows = (q.data ?? []).filter((r) => !currency || r.currency === currency);
  const currencies = useMemo(
    () => [...new Set((q.data ?? []).map((r) => r.currency))].sort(),
    [q.data],
  );
  const months = new Set((q.data ?? []).map((r) => r.month)).size;
  return (
    <ConfigPage
      title="Exchange rates"
      purpose="Units of each currency per 1 USD, per month: opening, closing and average. Months lock once a report using them is finalised."
      count={q.data ? `${q.data.length} monthly rates · ${months} months` : null}
      action={
        <>
          <input
            ref={file}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            aria-label="Choose a rate file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) upload.mutate(f);
            }}
          />
          <EditButton disabled={upload.isPending} onClick={() => file.current?.click()}>
            <Upload /> Upload rate file
          </EditButton>
        </>
      }
    >
      <Select
        aria-label="Currency"
        className="w-40"
        value={currency}
        onChange={(e) => setCurrency(e.target.value)}
      >
        <option value="">All currencies</option>
        {currencies.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>
      {(q.error || upload.error) && <Alert>{errorMessage(q.error ?? upload.error)}</Alert>}
      {!q.data ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No exchange rates yet"
          text="Upload a rate file (Month, Currency, Opening, Closing, Average) or enter rates on step 1 of a task."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Month</Th>
              <Th>Currency</Th>
              <Th className="text-right">Opening</Th>
              <Th className="text-right">Closing</Th>
              <Th className="text-right">Average</Th>
              <Th>Source</Th>
              <Th>Entered</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.month}-${r.currency}`}>
                <Td className="whitespace-nowrap">{monthText(r.month)}</Td>
                <Td className="font-mono">{r.currency}</Td>
                {(['opening', 'closing', 'average'] as const).map((k) => (
                  <Td key={k} className="text-right font-mono tabular-nums">
                    {r[k] ?? <span className="text-destructive">Missing</span>}
                  </Td>
                ))}
                <Td className="text-xs">{r.source}</Td>
                <Td className="text-xs">
                  {r.enteredBy ?? 'Seed'}, {formatDateTime(r.enteredAt)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </ConfigPage>
  );
}

export function FormatsPage() {
  const q = useQuery({
    queryKey: ['config', 'formats'],
    queryFn: () => api.get<FormatDto[]>('/config/formats'),
  });
  return (
    <ConfigPage
      title="Report formats"
      purpose="Layouts of the statements a task produces. Maintenance of the layouts comes with the statements step."
      count={q.data ? `${q.data.length} formats` : null}
      action={
        <EditButton disabled title="Adding formats comes with the statements step">
          Add format
        </EditButton>
      }
    >
      {q.error && <Alert>{errorMessage(q.error)}</Alert>}
      {!q.data ? (
        <Skeleton className="h-32 w-full" />
      ) : q.data.length === 0 ? (
        <EmptyState title="No formats" text="Formats define the statement layouts." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Description</Th>
              <Th className="text-right">Tasks</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {q.data.map((f) => (
              <tr key={f.code}>
                <Td className="font-mono text-xs">{f.code}</Td>
                <Td className="font-medium">{f.name}</Td>
                <Td className="text-sm">{f.description}</Td>
                <Td className="text-right tabular-nums">{f.tasks}</Td>
                <Td>
                  {f.isActive ? (
                    <Badge variant="success">Active</Badge>
                  ) : (
                    <Badge variant="secondary">Inactive</Badge>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </ConfigPage>
  );
}

const CLASS_LABEL = { A: 'Asset', L: 'Liability', E: 'Equity', I: 'Income', X: 'Expense' } as const;

export function FsliPage() {
  const q = useQuery({
    queryKey: ['config', 'fslis'],
    queryFn: () => api.get<FsliDto[]>('/config/fslis'),
  });
  const [query, setQuery] = useState('');
  const rows = (q.data ?? []).filter((f) => matches(query, f.code, f.name));
  return (
    <ConfigPage
      title="FSLI master"
      purpose="The financial statement line items every account maps to, with their translation rate and flags."
      count={q.data ? `${q.data.length} FSLIs` : null}
      action={
        <EditButton disabled title="Editing the FSLI master comes later">
          Add FSLI
        </EditButton>
      }
    >
      <SearchBox value={query} onChange={setQuery} placeholder="Search FSLIs" />
      {q.error && <Alert>{errorMessage(q.error)}</Alert>}
      {!q.data ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState title="No FSLIs match" text="Change the search." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Statement</Th>
              <Th>Class</Th>
              <Th>Rate</Th>
              <Th>Flags</Th>
              <Th className="text-right">Accounts</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.code}>
                <Td className="font-mono text-xs">{f.code}</Td>
                <Td>{f.name}</Td>
                <Td>{f.statement === 'BS' ? 'Balance sheet' : 'Profit and loss'}</Td>
                <Td>{CLASS_LABEL[f.class]}</Td>
                <Td className="text-xs">{f.rateBasis.replace('_', ' ').toLowerCase()}</Td>
                <Td className="space-x-1 text-xs">
                  {f.needsCounterparty && <Badge variant="outline">counterparty</Badge>}
                  {f.intercompany && <Badge variant="outline">intercompany</Badge>}
                  {f.computed && <Badge variant="outline">computed</Badge>}
                  {f.consolidationOnly && <Badge variant="outline">consolidation only</Badge>}
                </Td>
                <Td className="text-right tabular-nums">{f.accounts}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </ConfigPage>
  );
}

export function AccountTypeDefaultsPage() {
  const q = useQuery({
    queryKey: ['config', 'account-type-defaults'],
    queryFn: () => api.get<AccountTypeDefaultDto[]>('/config/account-type-defaults'),
  });
  return (
    <ConfigPage
      title="Account-type defaults"
      purpose="The FSLI suggested for a new account from its ERP account type (chart-of-accounts upload and mapping)."
      count={q.data ? `${q.data.length} defaults` : null}
      action={
        <EditButton disabled title="Editing the defaults comes later">
          Add default
        </EditButton>
      }
    >
      {q.error && <Alert>{errorMessage(q.error)}</Alert>}
      {!q.data ? (
        <Skeleton className="h-64 w-full" />
      ) : q.data.length === 0 ? (
        <EmptyState
          title="No defaults"
          text="Without defaults, new accounts need an FSLI chosen by hand."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>ERP</Th>
              <Th>Account type</Th>
              <Th>Default FSLI</Th>
            </tr>
          </thead>
          <tbody>
            {q.data.map((r) => (
              <tr key={`${r.erp}-${r.accountType}`}>
                <Td>{r.erp === 'ZOHO' ? 'Zoho' : r.erp === 'XERO' ? 'Xero' : 'Other'}</Td>
                <Td>{r.accountType}</Td>
                <Td>
                  {r.fsliName}{' '}
                  <span className="font-mono text-xs text-muted-foreground">{r.fsliCode}</span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </ConfigPage>
  );
}
