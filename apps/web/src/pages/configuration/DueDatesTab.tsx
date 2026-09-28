import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import {
  PERIOD_TYPE_LABELS,
  STATEMENT_LABELS,
  type DueDateRuleDto,
  type HolidayDto,
} from '@finance-close/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, Field, Input } from '@/components/ui/form';
import { Dialog, Table, Td, Th } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { SearchBox } from './common';
import { matches, useCanEditConfig } from './hooks';

export function DueDatesTab() {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <RulesCard />
      <HolidaysCard />
    </div>
  );
}

function RulesCard() {
  const canEdit = useCanEditConfig();
  const queryClient = useQueryClient();
  const rules = useQuery({
    queryKey: ['config', 'due-date-rules'],
    queryFn: () => api.get<DueDateRuleDto[]>('/config/due-date-rules'),
  });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (r: DueDateRuleDto) =>
      api.patch<DueDateRuleDto>(`/config/due-date-rules/${r.statementType}/${r.periodType}`, {
        workingDays: r.workingDays,
      }),
    onMutate: () => setNotice(null),
    onSuccess: (r) => {
      setNotice(
        `${PERIOD_TYPE_LABELS[r.periodType]} ${r.statementType}: ${r.workingDays} working days. Due dates updated.`,
      );
      setDrafts((d) => {
        const next = { ...d };
        delete next[`${r.statementType}:${r.periodType}`];
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ['config'] });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Due-date rules</CardTitle>
        <CardDescription>Working days after the period end, per task type.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {notice && <Alert variant="success">{notice}</Alert>}
        {(save.error || rules.error) && <Alert>{errorMessage(save.error ?? rules.error)}</Alert>}
        <Table>
          <thead>
            <tr>
              <Th>Task type</Th>
              <Th>Working days after period end</Th>
            </tr>
          </thead>
          <tbody>
            {rules.data?.map((r) => {
              const key = `${r.statementType}:${r.periodType}`;
              const draft = drafts[key] ?? String(r.workingDays);
              const valid = /^\d{1,3}$/.test(draft) && Number(draft) <= 120;
              const changed = draft !== String(r.workingDays);
              return (
                <tr key={key}>
                  <Td>
                    {PERIOD_TYPE_LABELS[r.periodType]} {STATEMENT_LABELS[r.statementType]}
                  </Td>
                  <Td>
                    {canEdit ? (
                      <div className="flex items-center gap-2">
                        <Input
                          aria-label={`Working days for ${PERIOD_TYPE_LABELS[r.periodType]} ${r.statementType}`}
                          className="w-20"
                          inputMode="numeric"
                          value={draft}
                          aria-invalid={!valid}
                          onChange={(e) => setDrafts({ ...drafts, [key]: e.target.value })}
                        />
                        {changed && (
                          <Button
                            size="sm"
                            disabled={!valid || save.isPending}
                            onClick={() => save.mutate({ ...r, workingDays: Number(draft) })}
                          >
                            Save
                          </Button>
                        )}
                        {!valid && (
                          <span className="text-xs text-destructive">0–120 whole days</span>
                        )}
                      </div>
                    ) : (
                      r.workingDays
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </CardContent>
    </Card>
  );
}

function HolidaysCard() {
  const canEdit = useCanEditConfig();
  const queryClient = useQueryClient();
  const holidays = useQuery({
    queryKey: ['config', 'holidays'],
    queryFn: () => api.get<HolidayDto[]>('/config/holidays'),
  });
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<{ holiday?: HolidayDto } | null>(null);
  const remove = useMutation({
    mutationFn: (h: HolidayDto) => api.delete(`/config/holidays/${h.id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['config'] }),
  });
  const rows = (holidays.data ?? []).filter((h) => matches(query, h.description, h.date));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Holidays</CardTitle>
        <CardDescription>
          Days that do not count as working days (in addition to weekends).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SearchBox value={query} onChange={setQuery} placeholder="Search holidays" />
          {canEdit && (
            <Button size="sm" onClick={() => setDialog({})}>
              <Plus /> Add holiday
            </Button>
          )}
        </div>
        {(remove.error || holidays.error) && (
          <Alert>{errorMessage(remove.error ?? holidays.error)}</Alert>
        )}
        <Table>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Description</Th>
              {canEdit && <Th className="text-right">Actions</Th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => (
              <tr key={h.id}>
                <Td className="whitespace-nowrap">{formatDate(h.date)}</Td>
                <Td>{h.description}</Td>
                {canEdit && (
                  <Td>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setDialog({ holiday: h })}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(h)}
                      >
                        Delete
                      </Button>
                    </div>
                  </Td>
                )}
              </tr>
            ))}
            {holidays.data && rows.length === 0 && (
              <tr>
                <Td colSpan={3} className="text-muted-foreground">
                  No holidays.
                </Td>
              </tr>
            )}
          </tbody>
        </Table>
      </CardContent>
      {dialog && <HolidayDialog holiday={dialog.holiday} onClose={() => setDialog(null)} />}
    </Card>
  );
}

function HolidayDialog({ holiday, onClose }: { holiday?: HolidayDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(holiday?.date ?? '');
  const [description, setDescription] = useState(holiday?.description ?? '');
  const save = useMutation({
    mutationFn: () =>
      holiday
        ? api.patch(`/config/holidays/${holiday.id}`, { date, description })
        : api.post('/config/holidays', { date, description }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['config'] });
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={holiday ? 'Edit holiday' : 'Add holiday'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="holiday-form"
            disabled={!date || !description.trim() || save.isPending}
          >
            Save
          </Button>
        </>
      }
    >
      <form id="holiday-form" onSubmit={submit} className="space-y-4" noValidate>
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        <Field label="Date" htmlFor="h-date">
          <Input id="h-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Description" htmlFor="h-desc">
          <Input id="h-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}
