import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Lock, LockOpen, Pencil } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import {
  PERIOD_TYPE_LABELS,
  STATEMENT_LABELS,
  type DueDateDto,
  type FinancialYearDto,
  type FinancialYearOption,
  type PeriodDto,
  type PeriodType,
} from '@finance-close/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, Field, Input, Select } from '@/components/ui/form';
import { Dialog, Table, Td, Th } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { SearchBox } from './common';
import { ConfigPage, EditButton } from './ConfigPage';
import { matches } from './hooks';

const TYPES: PeriodType[] = ['MONTHLY', 'QUARTERLY', 'ANNUAL'];

export function CalendarTab() {
  const queryClient = useQueryClient();
  const years = useQuery({
    queryKey: ['config', 'financial-years'],
    queryFn: () => api.get<FinancialYearDto[]>('/config/financial-years'),
  });
  const [selected, setSelected] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [dueDate, setDueDate] = useState<{ period: PeriodDto; due: DueDateDto } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Default to the latest FY that has started, else the first one.
  useEffect(() => {
    if (selected !== null || !years.data?.length) return;
    const today = new Date().toISOString().slice(0, 10);
    const current = [...years.data].reverse().find((y) => y.startDate <= today) ?? years.data[0]!;
    setSelected(current.startYear);
  }, [years.data, selected]);

  const status = useMutation({
    mutationFn: (p: PeriodDto) =>
      api.patch<PeriodDto>(`/config/periods/${p.id}/status`, {
        status: p.status === 'OPEN' ? 'CLOSED' : 'OPEN',
      }),
    onMutate: () => setError(null),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['config', 'financial-years'] }),
    onError: (err) => setError(errorMessage(err)),
  });

  const fy = years.data?.find((y) => y.startYear === selected);

  return (
    <ConfigPage
      title="Financial years and periods"
      purpose="The April–March financial years, their months, quarters and years, and which are open."
      count={years.data ? `${years.data.length} financial years` : null}
      action={
        <EditButton onClick={() => setCreating(true)}>
          <CalendarPlus /> Create financial year
        </EditButton>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Financial year">
          {years.data?.map((y) => (
            <Button
              key={y.startYear}
              size="sm"
              variant={y.startYear === selected ? 'default' : 'outline'}
              onClick={() => setSelected(y.startYear)}
            >
              {y.label}
            </Button>
          ))}
        </div>
        <div className="flex gap-2">
          <SearchBox value={query} onChange={setQuery} placeholder="Search periods" />
        </div>
      </div>
      {(error || years.error) && <Alert>{error ?? errorMessage(years.error)}</Alert>}

      {fy && (
        <>
          <p className="text-sm text-muted-foreground">
            {fy.label}: {formatDate(fy.startDate)} to {formatDate(fy.endDate)}. Due dates are
            counted in working days (Monday–Friday, excluding holidays) after the period end. Closed
            periods cannot have new tasks.
          </p>
          {TYPES.map((type) => {
            const periods = fy.periods.filter((p) => p.type === type && matches(query, p.label));
            if (periods.length === 0) return null;
            return (
              <section key={type} className="space-y-2">
                <h3 className="text-sm font-semibold">
                  {PERIOD_TYPE_LABELS[type]} ({periods.length})
                </h3>
                <Table>
                  <thead>
                    <tr>
                      <Th>Period</Th>
                      <Th>Start</Th>
                      <Th>End</Th>
                      <Th>Status</Th>
                      <Th>SFS due</Th>
                      <Th>CFS due</Th>
                      <Th className="text-right">Actions</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {periods.map((p) => (
                      <tr
                        key={p.id}
                        className={cn('hover:bg-muted/30', p.status === 'CLOSED' && 'bg-muted/40')}
                      >
                        <Td className="font-medium whitespace-nowrap">{p.label}</Td>
                        <Td className="whitespace-nowrap">{formatDate(p.startDate)}</Td>
                        <Td className="whitespace-nowrap">{formatDate(p.endDate)}</Td>
                        <Td>
                          {p.status === 'OPEN' ? (
                            <Badge variant="success">Open</Badge>
                          ) : (
                            <Badge
                              variant="secondary"
                              title={
                                p.statusChangedBy ? `Closed by ${p.statusChangedBy}` : undefined
                              }
                            >
                              Closed
                            </Badge>
                          )}
                        </Td>
                        {p.dueDates.map((d) => (
                          <Td key={d.statementType} className="whitespace-nowrap">
                            <DueDateCell due={d} onEdit={() => setDueDate({ period: p, due: d })} />
                          </Td>
                        ))}
                        {
                          <Td className="text-right">
                            <EditButton
                              variant="ghost"
                              size="sm"
                              disabled={status.isPending}
                              onClick={() => status.mutate(p)}
                            >
                              {p.status === 'OPEN' ? (
                                <>
                                  <Lock /> Close
                                </>
                              ) : (
                                <>
                                  <LockOpen /> Reopen
                                </>
                              )}
                            </EditButton>
                          </Td>
                        }
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </section>
            );
          })}
        </>
      )}

      {creating && (
        <CreateFinancialYearDialog
          onClose={() => setCreating(false)}
          onCreated={(y) => {
            setCreating(false);
            setSelected(y);
          }}
        />
      )}
      {dueDate && (
        <DueDateDialog period={dueDate.period} due={dueDate.due} onClose={() => setDueDate(null)} />
      )}
    </ConfigPage>
  );
}

function DueDateCell({ due, onEdit }: { due: DueDateDto; onEdit: () => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <div>
        <div className={cn(due.override && 'font-medium')}>{formatDate(due.effective)}</div>
        {due.override ? (
          <div
            className="text-xs text-muted-foreground"
            title={`Reason: ${due.override.reason} — ${due.override.by}`}
          >
            Overridden · calculated {formatDate(due.calculated)}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">{due.workingDays} working days</div>
        )}
      </div>
      <EditButton
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label={`Override ${due.statementType} due date`}
        onClick={onEdit}
      >
        <Pencil className="size-3.5" />
      </EditButton>
    </div>
  );
}

function DueDateDialog({
  period,
  due,
  onClose,
}: {
  period: PeriodDto;
  due: DueDateDto;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(due.override?.dueDate ?? due.calculated);
  const [reason, setReason] = useState('');
  const reasonOk = reason.trim().length >= 5;
  const done = () => {
    void queryClient.invalidateQueries({ queryKey: ['config', 'financial-years'] });
    onClose();
  };
  const save = useMutation({
    mutationFn: () =>
      api.put(`/config/periods/${period.id}/due-dates/${due.statementType}`, {
        dueDate: date,
        reason,
      }),
    onSuccess: done,
  });
  const clear = useMutation({
    mutationFn: () =>
      api.post(`/config/periods/${period.id}/due-dates/${due.statementType}/clear`, { reason }),
    onSuccess: done,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (reasonOk) save.mutate();
  };
  const error = save.error ?? clear.error;

  return (
    <Dialog
      open
      onClose={onClose}
      title={`${period.label} — ${STATEMENT_LABELS[due.statementType]} due date`}
      description={`Calculated: ${formatDate(due.calculated)} (${due.workingDays} working days after ${formatDate(period.endDate)}).`}
      footer={
        <>
          {due.override && (
            <Button
              variant="outline"
              className="mr-auto"
              disabled={!reasonOk || clear.isPending}
              onClick={() => clear.mutate()}
            >
              Use calculated date
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="due-form" disabled={!reasonOk || save.isPending}>
            Save override
          </Button>
        </>
      }
    >
      <form id="due-form" onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert>{errorMessage(error)}</Alert>}
        {due.override && (
          <Alert variant="info">
            Currently overridden to {formatDate(due.override.dueDate)} by {due.override.by}: “
            {due.override.reason}”
          </Alert>
        )}
        <Field label="Due date" htmlFor="due-date">
          <Input id="due-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field
          label="Reason (required)"
          htmlFor="due-reason"
          hint="Recorded in the audit trail. At least 5 characters."
          error={reason.length > 0 && !reasonOk ? 'Give a reason of at least 5 characters.' : null}
        >
          <Input
            id="due-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
        </Field>
      </form>
    </Dialog>
  );
}

function CreateFinancialYearDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (startYear: number) => void;
}) {
  const queryClient = useQueryClient();
  const options = useQuery({
    queryKey: ['config', 'financial-years', 'options'],
    queryFn: () => api.get<FinancialYearOption[]>('/config/financial-years/options'),
  });
  const available = options.data?.filter((o) => !o.exists) ?? [];
  const [startYear, setStartYear] = useState<number | null>(null);
  const chosen = startYear ?? available[0]?.startYear ?? null;
  const create = useMutation({
    mutationFn: () => api.post<FinancialYearDto>('/config/financial-years', { startYear: chosen }),
    onSuccess: async (fy) => {
      await queryClient.invalidateQueries({ queryKey: ['config', 'financial-years'] });
      onCreated(fy.startYear);
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Create financial year"
      description="Creates 12 months, 4 quarters (Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec, Q4 Jan–Mar) and the annual period."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} disabled={chosen === null || create.isPending}>
            Create
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {create.error && <Alert>{errorMessage(create.error)}</Alert>}
        {options.data && available.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Every available financial year has already been created.
          </p>
        ) : (
          <Field label="Financial year" htmlFor="fy-year">
            <Select
              id="fy-year"
              value={chosen ?? ''}
              onChange={(e) => setStartYear(Number(e.target.value))}
            >
              {available.map((o) => (
                <option key={o.startYear} value={o.startYear}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
    </Dialog>
  );
}
