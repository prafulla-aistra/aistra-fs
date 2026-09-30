import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Pencil, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import {
  ApiErrorCode,
  RATE_BASIS_OVERRIDES,
  type CoaAccountDto,
  type CoaPreviewDto,
  type EntityCoaDto,
  type FsliDto,
} from '@finance-close/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, Field, Input, Select } from '@/components/ui/form';
import { Dialog, Table, Td, Th } from '@/components/ui/overlay';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, api, downloadPath, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { toast } from '@/lib/toast';
import { SearchBox, WarningText } from './common';
import { ConfigPage, EditButton } from './ConfigPage';
import { matches, useEntities } from './hooks';

const RATE_LABEL: Record<string, string> = {
  CLOSING: 'Closing',
  AVERAGE: 'Average',
  HISTORICAL: 'Historical',
  OPENING: 'Opening',
  ROLL_FORWARD: 'Roll forward',
  COMPUTED: 'Computed',
};
type Filter = 'ALL' | 'UNMAPPED' | 'SUGGESTED' | 'IC_NO_CP' | 'OVERRIDE';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'ALL', label: 'All accounts' },
  { value: 'UNMAPPED', label: 'Unmapped' },
  { value: 'SUGGESTED', label: 'Suggested, not confirmed' },
  { value: 'IC_NO_CP', label: 'Intercompany without counterparty' },
  { value: 'OVERRIDE', label: 'Rate-basis override' },
];

/** Each entity's chart of accounts: stats, filters, inline mapping edits, upload and export. */
export function ChartOfAccountsTab() {
  const qc = useQueryClient();
  const entities = useEntities();
  const [code, setCode] = useState('IN');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [fsliFilter, setFsliFilter] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ file: File; result: CoaPreviewDto } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const q = useQuery({
    queryKey: ['config', 'coa', code],
    queryFn: () => api.get<EntityCoaDto>(`/config/entities/${code}/coa`),
  });
  const fslis = useQuery({
    queryKey: ['config', 'fslis'],
    queryFn: () => api.get<FsliDto[]>('/config/fslis'),
  });
  const check = useMutation({
    mutationFn: (f: File) =>
      api
        .upload<CoaPreviewDto>(`/config/entities/${code}/coa/preview`, f)
        .then((result) => ({ file: f, result })),
    onSuccess: setPreview,
  });
  const exportFile = useMutation({
    mutationFn: () =>
      downloadPath(`/config/entities/${code}/coa/export`, `${code}-chart-of-accounts.xlsx`),
  });

  const data = q.data;
  const rows = (data?.accounts ?? []).filter(
    (a) =>
      matches(search, a.accountCode, a.accountName, a.accountType, a.fsliName, a.sourceLabel) &&
      (!fsliFilter || a.fsliCode === fsliFilter) &&
      (filter === 'ALL' ||
        (filter === 'UNMAPPED' && !a.fsliCode) ||
        (filter === 'SUGGESTED' && a.suggested && !!a.fsliCode) ||
        (filter === 'IC_NO_CP' && a.needsCounterparty && !a.counterpartyCode) ||
        (filter === 'OVERRIDE' && !!a.rateBasisOverride)),
  );

  return (
    <ConfigPage
      title="Chart of accounts"
      purpose="Each entity's accounts and the FSLI they map to, with where each mapping came from."
      count={data ? `${data.stats.accounts} accounts` : null}
      action={
        <>
          <Button
            variant="outline"
            disabled={!data || exportFile.isPending}
            onClick={() => exportFile.mutate()}
          >
            <Download /> Export to Excel
          </Button>
          <input
            ref={file}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            aria-label="Choose a chart-of-accounts file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) check.mutate(f);
            }}
          />
          <EditButton disabled={check.isPending} onClick={() => file.current?.click()}>
            <Upload /> Upload Zoho COA
          </EditButton>
        </>
      }
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-72">
          <Field label="Entity" htmlFor="coa-entity">
            <Select
              id="coa-entity"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setEditing(null);
              }}
            >
              {(entities.data ?? []).map((e) => (
                <option key={e.code} value={e.code}>
                  {e.code} · {e.legalName}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Search code, name, type or FSLI"
        />
        <Select
          aria-label="Show"
          className="w-64"
          value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)}
        >
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </Select>
        <Select
          aria-label="FSLI filter"
          className="w-64"
          value={fsliFilter}
          onChange={(e) => setFsliFilter(e.target.value)}
        >
          <option value="">Any FSLI</option>
          {(fslis.data ?? []).map((f) => (
            <option key={f.code} value={f.code}>
              {f.name}
            </option>
          ))}
        </Select>
      </div>

      {data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Chart of accounts stats">
          <Stat label="Accounts" value={String(data.stats.accounts)} />
          <Stat
            label="Mapped"
            value={`${data.stats.mappedPct}%`}
            note={`${data.stats.mapped} of ${data.stats.accounts}`}
          />
          <Stat
            label="Unmapped"
            value={String(data.stats.unmapped)}
            tone={data.stats.unmapped > 0 ? 'warn' : undefined}
          />
          <Stat
            label="Intercompany without counterparty"
            value={String(data.stats.icWithoutCounterparty)}
            tone={data.stats.icWithoutCounterparty > 0 ? 'error' : undefined}
          />
        </div>
      )}
      {(q.error || check.error || exportFile.error) && (
        <Alert>{errorMessage(q.error ?? check.error ?? exportFile.error)}</Alert>
      )}
      {!data || !fslis.data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <Table aria-label="Accounts">
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Account name</Th>
              <Th>Account type</Th>
              <Th>FSLI</Th>
              <Th>Counterparty</Th>
              <Th>Rate basis</Th>
              <Th>Source</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) =>
              editing === a.accountCode ? (
                <EditRow
                  key={a.accountCode}
                  entity={code}
                  account={a}
                  fslis={fslis.data}
                  entities={(entities.data ?? [])
                    .filter((e) => e.isActive && e.code !== code)
                    .map((e) => e.code)}
                  onDone={async (saved) => {
                    setEditing(null);
                    if (saved) {
                      qc.setQueryData(['config', 'coa', code], saved);
                      await qc.invalidateQueries({ queryKey: ['config', 'fslis'] });
                    }
                  }}
                />
              ) : (
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
                  <Td className="font-mono text-xs">
                    {a.counterpartyCode ??
                      (a.needsCounterparty ? (
                        <span className="text-destructive">missing</span>
                      ) : (
                        ''
                      ))}
                  </Td>
                  <Td className="text-xs">
                    {a.rateBasisOverride ? (
                      <Badge variant="warning">Override: {RATE_LABEL[a.rateBasisOverride]}</Badge>
                    ) : a.fsliRateBasis ? (
                      <span className="text-muted-foreground">{RATE_LABEL[a.fsliRateBasis]}</span>
                    ) : (
                      ''
                    )}
                  </Td>
                  <Td
                    className="text-xs"
                    title={`${a.updatedBy ? `${a.updatedBy}, ` : ''}${formatDateTime(a.updatedAt)}`}
                  >
                    {a.sourceLabel}
                  </Td>
                  <Td className="text-right">
                    <EditButton
                      variant="ghost"
                      size="sm"
                      aria-label={`Edit ${a.accountCode}`}
                      disabled={editing !== null}
                      onClick={() => setEditing(a.accountCode)}
                    >
                      <Pencil />
                    </EditButton>
                  </Td>
                </tr>
              ),
            )}
          </tbody>
        </Table>
      )}
      {data && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">No accounts match the filters.</p>
      )}
      {preview && (
        <CoaPreviewDialog
          entity={code}
          preview={preview}
          onClose={() => setPreview(null)}
          onSaved={(saved) => {
            setPreview(null);
            qc.setQueryData(['config', 'coa', code], saved);
          }}
        />
      )}
    </ConfigPage>
  );
}

function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: 'warn' | 'error';
}) {
  return (
    <Card>
      <CardContent className="py-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className={`text-xl font-semibold tabular-nums ${tone === 'error' ? 'text-destructive' : tone === 'warn' ? 'text-warning-foreground' : ''}`}
        >
          {value}
        </p>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </CardContent>
    </Card>
  );
}

function EditRow({
  entity,
  account: a,
  fslis,
  entities,
  onDone,
}: {
  entity: string;
  account: CoaAccountDto;
  fslis: FsliDto[];
  entities: string[];
  onDone: (saved: EntityCoaDto | null) => Promise<void>;
}) {
  const [form, setForm] = useState({
    accountType: a.accountType ?? '',
    fsliCode: a.fsliCode ?? '',
    counterpartyCode: a.counterpartyCode ?? '',
    rateBasisOverride: a.rateBasisOverride ?? '',
    reason: '',
  });
  const [warnings, setWarnings] = useState<string[] | null>(null);
  const fsli = fslis.find((f) => f.code === form.fsliCode);
  const changesMapping =
    a.fsliCode !== null &&
    (a.fsliCode !== form.fsliCode ||
      (a.counterpartyCode ?? '') !== (fsli?.needsCounterparty ? form.counterpartyCode : '') ||
      (a.rateBasisOverride ?? '') !== form.rateBasisOverride);
  const save = useMutation({
    mutationFn: (confirmWarnings: boolean) =>
      api.patch<EntityCoaDto>(
        `/config/entities/${entity}/accounts/${encodeURIComponent(a.accountCode)}`,
        {
          accountType: form.accountType.trim() || null,
          fsliCode: form.fsliCode,
          counterpartyCode: fsli?.needsCounterparty ? form.counterpartyCode || null : null,
          rateBasisOverride: form.rateBasisOverride || null,
          reason: form.reason.trim() || null,
          confirmWarnings,
        },
      ),
    onSuccess: async (saved) => {
      toast(`${a.accountCode} saved.`);
      await onDone(saved);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === ApiErrorCode.ConfirmationRequired) {
        const list = (err.body as { warnings?: { message: string }[] }).warnings ?? [];
        setWarnings(list.length > 0 ? list.map((w) => w.message) : [err.message]);
      }
    },
  });
  const error =
    save.error &&
    !(save.error instanceof ApiError && save.error.code === ApiErrorCode.ConfirmationRequired)
      ? errorMessage(save.error)
      : null;
  return (
    <tr className="bg-mint/50">
      <Td className="align-top font-mono text-xs">{a.accountCode}</Td>
      <Td className="align-top">{a.accountName}</Td>
      <Td className="align-top">
        <Input
          aria-label="Account type"
          className="h-8 text-xs"
          value={form.accountType}
          onChange={(e) => setForm({ ...form, accountType: e.target.value })}
        />
      </Td>
      <Td className="align-top">
        <Select
          aria-label="FSLI"
          className="h-8 text-xs"
          value={form.fsliCode}
          onChange={(e) => setForm({ ...form, fsliCode: e.target.value })}
        >
          <option value="">Choose an FSLI</option>
          {fslis
            .filter((f) => !f.computed && !f.consolidationOnly)
            .map((f) => (
              <option key={f.code} value={f.code}>
                {f.name}
              </option>
            ))}
        </Select>
      </Td>
      <Td className="align-top">
        {fsli?.needsCounterparty ? (
          <Select
            aria-label="Counterparty"
            className="h-8 text-xs"
            value={form.counterpartyCode}
            onChange={(e) => setForm({ ...form, counterpartyCode: e.target.value })}
          >
            <option value="">Choose</option>
            {entities.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        ) : (
          <span className="text-xs text-muted-foreground">n/a</span>
        )}
      </Td>
      <Td className="align-top">
        <Select
          aria-label="Rate-basis override"
          className="h-8 text-xs"
          value={form.rateBasisOverride}
          onChange={(e) => setForm({ ...form, rateBasisOverride: e.target.value })}
        >
          <option value="">FSLI default{fsli ? ` (${RATE_LABEL[fsli.rateBasis]})` : ''}</option>
          {RATE_BASIS_OVERRIDES.map((r) => (
            <option key={r} value={r}>
              {RATE_LABEL[r]}
            </option>
          ))}
        </Select>
      </Td>
      <Td colSpan={2} className="space-y-2 align-top">
        {changesMapping && (
          <Input
            aria-label="Reason for the change"
            placeholder="Reason for changing the mapping (required)"
            className="h-8 text-xs"
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
          />
        )}
        {warnings &&
          warnings.map((w, i) => (
            <div key={i}>
              <WarningText>{w}</WarningText>
            </div>
          ))}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => void onDone(null)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={
              save.isPending || !form.fsliCode || (changesMapping && form.reason.trim().length < 3)
            }
            onClick={() => save.mutate(warnings !== null)}
          >
            {warnings ? 'Confirm and save' : 'Save'}
          </Button>
        </div>
      </Td>
    </tr>
  );
}

function CoaPreviewDialog({
  entity,
  preview,
  onClose,
  onSaved,
}: {
  entity: string;
  preview: { file: File; result: CoaPreviewDto };
  onClose: () => void;
  onSaved: (saved: EntityCoaDto) => void;
}) {
  const p = preview.result;
  const save = useMutation({
    mutationFn: () =>
      api.upload<EntityCoaDto>(`/config/entities/${entity}/coa/upload`, preview.file),
    onSuccess: (saved) => {
      toast(`Chart of accounts merged: ${p.added.length} added, ${p.updated.length} updated.`);
      onSaved(saved);
    },
  });
  const changes = p.added.length + p.updated.length;
  return (
    <Dialog
      open
      size="xl"
      onClose={onClose}
      title={`Check ${p.fileName}`}
      description="New accounts get the default FSLI for their type (marked suggested). Existing accounts keep their FSLI and counterparty; only name, type and parent change."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending || changes === 0} onClick={() => save.mutate()}>
            Merge {changes} change{changes === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm font-medium" role="status">
          {p.added.length} new, {p.updated.length} changed, {p.unchanged} unchanged
        </p>
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        {p.warnings.map((w, i) => (
          <div key={i}>
            <WarningText>{w.message}</WarningText>
          </div>
        ))}
        {p.added.length > 0 && (
          <Table aria-label="New accounts">
            <thead>
              <tr>
                <Th>New account</Th>
                <Th>Type</Th>
                <Th>Default FSLI</Th>
              </tr>
            </thead>
            <tbody>
              {p.added.map((a) => (
                <tr key={a.code}>
                  <Td className="text-xs">
                    <span className="font-mono">{a.code}</span> {a.name}
                  </Td>
                  <Td className="text-xs">{a.type ?? '—'}</Td>
                  <Td className="text-xs">
                    {a.fsliCode ?? (
                      <span className="text-warning-foreground">none – map by hand</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {p.updated.length > 0 && (
          <Table aria-label="Changed accounts">
            <thead>
              <tr>
                <Th>Account</Th>
                <Th>Before</Th>
                <Th>After</Th>
              </tr>
            </thead>
            <tbody>
              {p.updated.map((u) => (
                <tr key={u.code}>
                  <Td className="font-mono text-xs">{u.code}</Td>
                  <Td className="text-xs">
                    {u.before.name} · {u.before.type ?? '—'}
                  </Td>
                  <Td className="text-xs">
                    {u.after.name} · {u.after.type ?? '—'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </Dialog>
  );
}
