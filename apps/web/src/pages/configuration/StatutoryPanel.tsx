import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { StatutoryDetailsDto, StatutoryDetailsInput } from '@finance-close/shared';
import { Button } from '@/components/ui/button';
import { Alert, Field, Input } from '@/components/ui/form';
import { Table, Td, Th } from '@/components/ui/overlay';
import { Skeleton } from '@/components/ui/skeleton';
import { api, errorMessage } from '@/lib/api';
import { toast } from '@/lib/toast';
import { EditButton } from './ConfigPage';

/**
 * Statutory details of an entity (decision round 1, Q9): a record of its own, linked to the
 * entity. Directors and officers have effective dates; exports sign with those in office on the
 * board approval date entered on the task.
 */
export function StatutoryPanel({ code }: { code: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['config', 'statutory', code],
    queryFn: () => api.get<StatutoryDetailsDto>(`/config/entities/${code}/statutory`),
  });
  const [draft, setDraft] = useState<StatutoryDetailsInput | null>(null);
  const save = useMutation({
    mutationFn: (x: StatutoryDetailsInput) =>
      api.put<StatutoryDetailsDto>(`/config/entities/${code}/statutory`, x),
    onSuccess: (x) => {
      qc.setQueryData(['config', 'statutory', code], x);
      setDraft(null);
      toast('Statutory details saved.');
    },
  });
  if (q.error) return <Alert>{errorMessage(q.error)}</Alert>;
  const d = q.data;
  if (!d) return <Skeleton className="h-40 w-full" />;
  const cur: StatutoryDetailsInput = draft ?? {
    registeredOffice: d.registeredOffice,
    registrationNo: d.registrationNo,
    officers: d.officers.map(({ id: _id, ...o }) => o),
  };
  const editing = draft !== null;
  const setOfficer = (i: number, patch: Partial<StatutoryDetailsInput['officers'][number]>) =>
    setDraft({ ...cur, officers: cur.officers.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  return (
    <div className="space-y-4">
      {save.error && <Alert>{errorMessage(save.error)}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Registered office" htmlFor="st-office">
          <Input
            id="st-office"
            disabled={!editing}
            value={cur.registeredOffice ?? ''}
            onChange={(e) => setDraft({ ...cur, registeredOffice: e.target.value || null })}
          />
        </Field>
        <Field label="Registration no. (CIN / company number)" htmlFor="st-reg">
          <Input
            id="st-reg"
            disabled={!editing}
            value={cur.registrationNo ?? ''}
            onChange={(e) => setDraft({ ...cur, registrationNo: e.target.value || null })}
          />
        </Field>
      </div>
      <Table>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Designation</Th>
            <Th>DIN / identifier</Th>
            <Th>From</Th>
            <Th>To</Th>
            {editing && <Th />}
          </tr>
        </thead>
        <tbody>
          {cur.officers.map((o, i) => (
            <tr key={i}>
              {(['name', 'designation', 'identifier'] as const).map((k) => (
                <Td key={k}>
                  <Input
                    aria-label={`Officer ${i + 1} ${k}`}
                    disabled={!editing}
                    value={o[k] ?? ''}
                    onChange={(e) =>
                      setOfficer(i, {
                        [k]: k === 'identifier' ? e.target.value || null : e.target.value,
                      })
                    }
                  />
                </Td>
              ))}
              <Td>
                <Input
                  type="date"
                  aria-label={`Officer ${i + 1} effective from`}
                  disabled={!editing}
                  value={o.effectiveFrom}
                  onChange={(e) => setOfficer(i, { effectiveFrom: e.target.value })}
                />
              </Td>
              <Td>
                <Input
                  type="date"
                  aria-label={`Officer ${i + 1} effective to`}
                  disabled={!editing}
                  value={o.effectiveTo ?? ''}
                  onChange={(e) => setOfficer(i, { effectiveTo: e.target.value || null })}
                />
              </Td>
              {editing && (
                <Td>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove officer ${i + 1}`}
                    onClick={() =>
                      setDraft({ ...cur, officers: cur.officers.filter((_, j) => j !== i) })
                    }
                  >
                    <Trash2 />
                  </Button>
                </Td>
              )}
            </tr>
          ))}
          {cur.officers.length === 0 && (
            <tr>
              <Td colSpan={6} className="text-muted-foreground">
                No directors or officers recorded: exports show blank Director / CFO signature
                lines.
              </Td>
            </tr>
          )}
        </tbody>
      </Table>
      <div className="flex flex-wrap justify-end gap-2">
        {editing ? (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setDraft({
                  ...cur,
                  officers: [
                    ...cur.officers,
                    {
                      name: '',
                      designation: 'Director',
                      identifier: null,
                      effectiveFrom: '',
                      effectiveTo: null,
                    },
                  ],
                })
              }
            >
              <Plus /> Add officer
            </Button>
            <Button variant="outline" size="sm" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" disabled={save.isPending} onClick={() => save.mutate(cur)}>
              Save
            </Button>
          </>
        ) : (
          <EditButton size="sm" onClick={() => setDraft(cur)}>
            Edit statutory details
          </EditButton>
        )}
      </div>
    </div>
  );
}
