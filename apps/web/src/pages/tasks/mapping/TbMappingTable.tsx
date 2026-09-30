import { useMutation } from '@tanstack/react-query';
import { CircleCheck, CircleX, Pencil } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  CHANGE_MAPPING_NOTICE,
  type EntityMappingDto,
  type MappedLineDto,
  type MappingRowIssuesDto,
} from '@finance-close/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, Checkbox, Field, Input, Select } from '@/components/ui/form';
import { Dialog, Table, Td, Th } from '@/components/ui/overlay';
import { api, ApiError, errorMessage } from '@/lib/api';
import { amountText } from '@/lib/format';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { SearchBox } from '@/pages/configuration/common';
import { CounterpartySelect, FsliSelect } from './FsliSelect';

type Filter = 'all' | 'unmapped' | 'intercompany' | `fsli:${string}`;

/** The TB with its mapping: debit / credit columns, filters, totals, and mapping changes. */
export function TbMappingTable({
  taskId,
  mapping,
  onSaved,
}: {
  taskId: string;
  mapping: EntityMappingDto;
  onSaved: (m: EntityMappingDto) => Promise<void>;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<MappedLineDto | null>(null);
  const fslisUsed = useMemo(
    () => [
      ...new Map(
        mapping.lines.filter((l) => l.fsliCode).map((l) => [l.fsliCode!, l.fsliName!]),
      ).entries(),
    ],
    [mapping.lines],
  );
  const rows = mapping.lines.filter((l) => {
    if (filter === 'unmapped' && l.mapped) return false;
    if (filter === 'intercompany' && !l.intercompany) return false;
    if (filter.startsWith('fsli:') && l.fsliCode !== filter.slice(5)) return false;
    const s = search.trim().toLowerCase();
    return !s || l.code.toLowerCase().includes(s) || l.name.toLowerCase().includes(s);
  });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle>Trial balance with mapping</CardTitle>
        <div className="flex flex-wrap gap-2">
          <Select
            aria-label="Filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
            className="w-56"
          >
            <option value="all">All accounts</option>
            <option value="unmapped">Unmapped</option>
            <option value="intercompany">Intercompany</option>
            <optgroup label="By FSLI">
              {fslisUsed.map(([code, name]) => (
                <option key={code} value={`fsli:${code}`}>
                  {name}
                </option>
              ))}
            </optgroup>
          </Select>
          <SearchBox value={search} onChange={setSearch} placeholder="Search code or name" />
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Account name</Th>
              <Th>Account type</Th>
              <Th>FSLI</Th>
              <Th>Counterparty</Th>
              <Th className="text-right">Debit</Th>
              <Th className="text-right">Credit</Th>
              {mapping.canEdit && <Th />}
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.code} className={cn(!l.mapped && 'bg-amber-50')}>
                <Td className="font-mono text-xs">{l.code}</Td>
                <Td>{l.name}</Td>
                <Td className="text-xs">{l.accountType ?? '—'}</Td>
                <Td className="text-xs">
                  {l.fsliName ?? (
                    <span className="font-medium text-warning-foreground">Unmapped</span>
                  )}
                </Td>
                <Td className="font-mono text-xs">{l.counterpartyCode ?? ''}</Td>
                <Td className="text-right font-mono tabular-nums">
                  {l.amount.startsWith('-') ? '' : amountText(l.amount)}
                </Td>
                <Td className="text-right font-mono tabular-nums">
                  {l.amount.startsWith('-') ? amountText(l.amount.slice(1)) : ''}
                </Td>
                {mapping.canEdit && (
                  <Td className="text-right">
                    {l.mapped && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Change mapping of ${l.code}`}
                        onClick={() => setEditing(l)}
                      >
                        <Pencil />
                      </Button>
                    )}
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-medium">
              <Td colSpan={5}>
                <span className="inline-flex items-center gap-1.5">
                  {mapping.totals.balanced ? (
                    <CircleCheck className="size-4 text-success" />
                  ) : (
                    <CircleX className="size-4 text-destructive" />
                  )}
                  Total ({mapping.lines.length} accounts){' '}
                  {mapping.totals.balanced ? '— debits equal credits' : '— not balanced'}
                </span>
              </Td>
              <Td className="text-right font-mono tabular-nums">
                {amountText(mapping.totals.debits)}
              </Td>
              <Td className="text-right font-mono tabular-nums">
                {amountText(mapping.totals.credits)}
              </Td>
              {mapping.canEdit && <Td />}
            </tr>
          </tfoot>
        </Table>
      </CardContent>
      {editing && (
        <ChangeMappingDialog
          taskId={taskId}
          mapping={mapping}
          line={editing}
          onClose={() => setEditing(null)}
          onSaved={async (m) => {
            setEditing(null);
            await onSaved(m);
          }}
        />
      )}
    </Card>
  );
}

function ChangeMappingDialog({
  taskId,
  mapping,
  line,
  onClose,
  onSaved,
}: {
  taskId: string;
  mapping: EntityMappingDto;
  line: MappedLineDto;
  onClose: () => void;
  onSaved: (m: EntityMappingDto) => Promise<void>;
}) {
  const [fsliCode, setFsli] = useState(line.fsliCode ?? '');
  const [counterparty, setCounterparty] = useState(line.counterpartyCode ?? '');
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [issue, setIssue] = useState<MappingRowIssuesDto | null>(null);
  const fsli = mapping.options.fslis.find((f) => f.code === fsliCode);
  const save = useMutation({
    mutationFn: () =>
      api.put<EntityMappingDto>(`/tasks/${taskId}/entities/${mapping.entity.code}/mappings`, {
        mappings: [
          {
            accountCode: line.code,
            accountType: line.accountType,
            fsliCode,
            counterpartyCode: fsli?.needsCounterparty ? counterparty || null : null,
            reason,
            confirmWarnings: confirm,
          },
        ],
      }),
    onSuccess: async (m) => {
      toast(`${line.code} mapping changed.`);
      await onSaved(m);
    },
    onError: (err) => {
      const rows =
        err instanceof ApiError ? (err.body as { rows?: MappingRowIssuesDto[] }).rows : undefined;
      setIssue(rows?.[0] ?? null);
    },
  });
  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title={`Change mapping — ${line.code} ${line.name}`}
      description={CHANGE_MAPPING_NOTICE}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!fsliCode || reason.trim().length < 3 || save.isPending}
            onClick={() => save.mutate()}
          >
            Save change
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="FSLI">
          <FsliSelect
            label="FSLI"
            options={mapping.options}
            value={fsliCode}
            onChange={(v) => {
              setFsli(v);
              setConfirm(false);
            }}
          />
        </Field>
        {fsli?.needsCounterparty && (
          <Field label="Counterparty">
            <CounterpartySelect
              label="Counterparty"
              options={mapping.options}
              investment={fsli.code === 'INV_SUB'}
              value={counterparty}
              onChange={setCounterparty}
            />
          </Field>
        )}
        <Field label="Reason (required)">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </Field>
        {issue?.errors.map((e) => (
          <Alert key={e.code}>{e.message}</Alert>
        ))}
        {issue &&
          issue.errors.length === 0 &&
          issue.warnings.map((w) => (
            <label key={w.code} className="flex items-start gap-2 text-sm text-warning-foreground">
              <Checkbox
                className="mt-0.5"
                checked={confirm}
                onChange={(e) => setConfirm(e.target.checked)}
              />
              {w.message} Tick to confirm.
            </label>
          ))}
        {save.error && !issue && <Alert>{errorMessage(save.error)}</Alert>}
      </div>
    </Dialog>
  );
}
