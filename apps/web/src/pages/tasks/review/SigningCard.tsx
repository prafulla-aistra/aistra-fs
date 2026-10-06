import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { SigningDetailsDto } from '@finance-close/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, Field, Input } from '@/components/ui/form';
import { api, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { toast } from '@/lib/toast';

/**
 * Board approval date and place of signing (decision round 1, Q9), entered on the task at
 * finalisation. The Word / PDF exports sign with the officers effective at that date.
 */
export function SigningCard({ taskId, itemKey }: { taskId: string; itemKey: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['signing', taskId, itemKey],
    queryFn: () => api.get<SigningDetailsDto>(`/tasks/${taskId}/signing/${itemKey}`),
  });
  const [draft, setDraft] = useState<{ date: string; place: string } | null>(null);
  const d = q.data;
  const cur = draft ?? { date: d?.boardApprovalDate ?? '', place: d?.place ?? '' };
  const save = useMutation({
    mutationFn: () =>
      api.put<SigningDetailsDto>(`/tasks/${taskId}/signing/${itemKey}`, {
        boardApprovalDate: cur.date,
        place: cur.place,
      }),
    onSuccess: (x) => {
      qc.setQueryData(['signing', taskId, itemKey], x);
      setDraft(null);
      toast('Signing details saved.');
    },
  });
  if (q.error) return <Alert>{errorMessage(q.error)}</Alert>;
  if (!d) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Signing details</CardTitle>
        <CardDescription>
          Board approval date and place of signing for the Word / PDF statements. The signatories
          are {d.entityCode}&apos;s directors and officers in office on that date (Configuration →
          Entities → Statutory details).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Board approval date" htmlFor={`sign-date-${itemKey}`}>
            <Input
              id={`sign-date-${itemKey}`}
              type="date"
              disabled={!d.canEdit}
              value={cur.date}
              onChange={(e) => setDraft({ ...cur, date: e.target.value })}
            />
          </Field>
          <Field label="Place of signing" htmlFor={`sign-place-${itemKey}`}>
            <Input
              id={`sign-place-${itemKey}`}
              disabled={!d.canEdit}
              value={cur.place}
              maxLength={120}
              onChange={(e) => setDraft({ ...cur, place: e.target.value })}
            />
          </Field>
        </div>
        <div className="text-sm">
          <div className="font-medium">
            Signatories{d.boardApprovalDate ? ` on ${formatDate(d.boardApprovalDate)}` : ' (today)'}
          </div>
          {!d.officersConfigured && (
            <p className="text-xs text-warning-foreground">
              No officers recorded for {d.entityCode}: the exports show blank Director / CFO lines.
            </p>
          )}
          <ul className="list-disc pl-5">
            {d.signatories.map((s, i) => (
              <li key={i}>
                {s.designation}
                {s.name ? `: ${s.name}${s.identifier ? ` (${s.identifier})` : ''}` : ''}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-center justify-end gap-2">
          {d.readOnlyReason && (
            <span className="text-xs text-muted-foreground">{d.readOnlyReason}</span>
          )}
          <Button
            size="sm"
            disabled={
              !d.canEdit || !draft || !cur.date || cur.place.trim().length < 2 || save.isPending
            }
            onClick={() => save.mutate()}
          >
            Save signing details
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
