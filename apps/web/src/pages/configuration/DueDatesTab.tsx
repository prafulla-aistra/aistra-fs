import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import {
  PERIOD_TYPE_LABELS,
  STATEMENT_LABELS,
  type DueDateRuleDto,
  GROUP_CALENDAR,
  type HolidayCalendarsDto,
  type HolidayDto,
} from '@finance-close/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, Checkbox, Field, Input, Select } from '@/components/ui/form';
import { Dialog, Table, Td, Th } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { SearchBox } from './common';
import { matches, NO_CONFIG_ACCESS, useCanEditConfig } from './hooks';
import { ConfigPage, EditButton } from './ConfigPage';

export function DueDatesTab() {
  return (
    <ConfigPage
      title="Due dates and holidays"
      purpose="How many working days after the period end each task is due, and the holidays that are not working days. One group calendar (India) drives every due date; per-entity country calendars are optional and off by default."
    >
      <div className="grid gap-6 xl:grid-cols-2">
        <RulesCard />
        <HolidaysCard />
        <CalendarsCard />
      </div>
    </ConfigPage>
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
                    {
                      <div className="flex items-center gap-2">
                        <Input
                          disabled={!canEdit}
                          title={canEdit ? undefined : NO_CONFIG_ACCESS}
                          aria-label={`Working days for ${PERIOD_TYPE_LABELS[r.periodType]} ${r.statementType}`}
                          className="w-20"
                          inputMode="numeric"
                          value={draft}
                          aria-invalid={!valid}
                          onChange={(e) => setDrafts({ ...drafts, [key]: e.target.value })}
                        />
                        {changed && (
                          <EditButton
                            size="sm"
                            disabled={!valid || save.isPending}
                            onClick={() => save.mutate({ ...r, workingDays: Number(draft) })}
                          >
                            Save
                          </EditButton>
                        )}
                        {!valid && (
                          <span className="text-xs text-destructive">0–120 whole days</span>
                        )}
                      </div>
                    }
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
  const rows = (holidays.data ?? []).filter((h) =>
    matches(query, h.description, h.date, h.calendar),
  );
  const calLabel = (c: string) => (c === GROUP_CALENDAR ? 'Group (India)' : c);

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
          <EditButton size="sm" onClick={() => setDialog({})}>
            <Plus /> Add holiday
          </EditButton>
        </div>
        {(remove.error || holidays.error) && (
          <Alert>{errorMessage(remove.error ?? holidays.error)}</Alert>
        )}
        <Table>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Description</Th>
              <Th>Calendar</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => (
              <tr key={h.id}>
                <Td className="whitespace-nowrap">{formatDate(h.date)}</Td>
                <Td>{h.description}</Td>
                <Td>{calLabel(h.calendar)}</Td>
                {
                  <Td>
                    <div className="flex justify-end gap-1">
                      <EditButton
                        variant="ghost"
                        size="sm"
                        onClick={() => setDialog({ holiday: h })}
                      >
                        Edit
                      </EditButton>
                      <EditButton
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(h)}
                      >
                        Delete
                      </EditButton>
                    </div>
                  </Td>
                }
              </tr>
            ))}
            {holidays.data && rows.length === 0 && (
              <tr>
                <Td colSpan={4} className="text-muted-foreground">
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
  const [calendar, setCalendar] = useState(holiday?.calendar ?? GROUP_CALENDAR);
  const save = useMutation({
    mutationFn: () =>
      holiday
        ? api.patch(`/config/holidays/${holiday.id}`, { date, description, calendar })
        : api.post('/config/holidays', { date, description, calendar }),
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
        <Field
          label="Calendar (GROUP = the group calendar; else a country, e.g. UK)"
          htmlFor="h-cal"
        >
          <Input id="h-cal" value={calendar} onChange={(e) => setCalendar(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}

/** Decision round 1 (Q4): optional per-entity country calendars, off by default. */
function CalendarsCard() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['config', 'holiday-calendars'],
    queryFn: () => api.get<HolidayCalendarsDto>('/config/holiday-calendars'),
  });
  const [draft, setDraft] = useState<{ perEntity: boolean; cals: Record<string, string> } | null>(
    null,
  );
  const d = q.data;
  const cur = draft ?? {
    perEntity: d?.perEntity ?? false,
    cals: Object.fromEntries((d?.entities ?? []).map((e) => [e.code, e.holidayCalendar ?? ''])),
  };
  const save = useMutation({
    mutationFn: () =>
      api.put<HolidayCalendarsDto>('/config/holiday-calendars', {
        perEntity: cur.perEntity,
        entities: Object.entries(cur.cals).map(([code, c]) => ({
          code,
          holidayCalendar: c.trim() || null,
        })),
      }),
    onSuccess: () => {
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ['config'] });
    },
  });
  const canEdit = d?.canEdit ?? false;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Per-entity holiday calendars</CardTitle>
        <CardDescription>
          Off by default: the group calendar decides every due date. Switched on, entities with a
          country calendar also show their own SFS due date on the periods list (task due dates stay
          on the group calendar).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {(q.error || save.error) && <Alert>{errorMessage(q.error ?? save.error)}</Alert>}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            disabled={!canEdit}
            checked={cur.perEntity}
            onChange={(e) => setDraft({ ...cur, perEntity: e.target.checked })}
          />
          Use per-entity country calendars
        </label>
        <Table>
          <thead>
            <tr>
              <Th>Entity</Th>
              <Th>Calendar</Th>
            </tr>
          </thead>
          <tbody>
            {d?.entities.map((e) => (
              <tr key={e.code}>
                <Td>
                  {e.code} · {e.shortName}
                </Td>
                <Td>
                  <Select
                    aria-label={`Holiday calendar for ${e.code}`}
                    disabled={!canEdit}
                    value={cur.cals[e.code] ?? ''}
                    onChange={(x) =>
                      setDraft({ ...cur, cals: { ...cur.cals, [e.code]: x.target.value } })
                    }
                  >
                    <option value="">Group (India)</option>
                    {d.calendars
                      .filter((c) => c !== GROUP_CALENDAR)
                      .map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                  </Select>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {d && d.calendars.length === 1 && (
          <p className="text-xs text-muted-foreground">
            Add holidays with a country calendar name (e.g. UK) to choose it here.
          </p>
        )}
        <div className="flex justify-end">
          <EditButton size="sm" disabled={!draft || save.isPending} onClick={() => save.mutate()}>
            Save calendars
          </EditButton>
        </div>
      </CardContent>
    </Card>
  );
}
