import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import type { EditAccessRequestDto, EditAccessStatusCode } from '@finance-close/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, Field, Select } from '@/components/ui/form';
import { Dialog, Table, Td, Th } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

const STATUS: Record<
  EditAccessStatusCode,
  { label: string; variant: 'warning' | 'success' | 'destructive' | 'neutral' }
> = {
  PENDING: { label: 'Pending', variant: 'warning' },
  APPROVED: { label: 'Approved', variant: 'success' },
  REJECTED: { label: 'Rejected', variant: 'destructive' },
  CANCELLED: { label: 'Cancelled', variant: 'neutral' },
};

/** Edit-access requests for finalised entities: approve (a v2 working copy) or reject. */
export function EditAccessPage() {
  const [filter, setFilter] = useState<'PENDING' | 'ALL'>('PENDING');
  const list = useQuery({
    queryKey: ['edit-access'],
    queryFn: () => api.get<EditAccessRequestDto[]>('/edit-access-requests'),
  });
  const [deciding, setDeciding] = useState<{ r: EditAccessRequestDto; approve: boolean } | null>(
    null,
  );
  const rows = (list.data ?? []).filter((r) => filter === 'ALL' || r.status === 'PENDING');
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Edit-access requests</h1>
          <p className="text-sm text-muted-foreground">
            Finalised entities are read-only. Approving a request reopens the entity as a new
            working version; the finalised version is kept.
          </p>
        </div>
        <Field label="Show" htmlFor="ea-filter">
          <Select
            id="ea-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value as 'PENDING' | 'ALL')}
          >
            <option value="PENDING">Pending</option>
            <option value="ALL">All requests</option>
          </Select>
        </Field>
      </header>
      {list.error && <Alert>{errorMessage(list.error)}</Alert>}
      <Card>
        <CardContent className="pt-6">
          <Table>
            <thead>
              <tr>
                <Th>Requested</Th>
                <Th>Task · entity</Th>
                <Th>Reason</Th>
                <Th>Status</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap">
                    {formatDateTime(r.requestedAt)}
                    <div className="text-xs text-muted-foreground">{r.requestedBy}</div>
                  </Td>
                  <Td>
                    <Link
                      className="text-primary underline-offset-2 hover:underline"
                      to={`/tasks/${r.taskId}?step=FINALISED&entity=${r.entityCode}`}
                    >
                      {r.taskNumber} · {r.entityCode}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {r.entityName} · {r.periodLabel}
                    </div>
                  </Td>
                  <Td className="max-w-md">
                    {r.reason}
                    {r.blockedReason && r.status === 'PENDING' && (
                      <div className="mt-1 text-xs text-destructive">{r.blockedReason}</div>
                    )}
                    {r.decisionComment && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Decision: {r.decisionComment}
                      </div>
                    )}
                  </Td>
                  <Td>
                    <Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge>
                    {r.decidedBy && (
                      <div className="text-xs text-muted-foreground">{r.decidedBy}</div>
                    )}
                  </Td>
                  <Td>
                    {r.status === 'PENDING' && (
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          disabled={!r.canDecide || r.blockedReason !== null}
                          title={
                            !r.canDecide
                              ? 'You cannot decide your own request'
                              : (r.blockedReason ?? undefined)
                          }
                          onClick={() => setDeciding({ r, approve: true })}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!r.canDecide}
                          onClick={() => setDeciding({ r, approve: false })}
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
              {list.data && rows.length === 0 && (
                <tr>
                  <Td colSpan={5} className="text-muted-foreground">
                    {filter === 'PENDING' ? 'No pending requests.' : 'No requests yet.'}
                  </Td>
                </tr>
              )}
            </tbody>
          </Table>
        </CardContent>
      </Card>
      {deciding && <DecideDialog {...deciding} onClose={() => setDeciding(null)} />}
    </div>
  );
}

function DecideDialog({
  r,
  approve,
  onClose,
}: {
  r: EditAccessRequestDto;
  approve: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [comment, setComment] = useState('');
  const decide = useMutation({
    mutationFn: () =>
      api.post(`/edit-access-requests/${r.id}/decide`, {
        approve,
        comment: comment.trim() || null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries();
      onClose();
    },
  });
  const needsComment = !approve && comment.trim().length === 0;
  return (
    <Dialog
      open
      onClose={onClose}
      title={
        approve
          ? `Approve edit access: ${r.taskNumber} · ${r.entityCode}`
          : `Reject edit access: ${r.taskNumber} · ${r.entityCode}`
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={approve ? 'default' : 'destructive'}
            disabled={needsComment || decide.isPending}
            onClick={() => decide.mutate()}
          >
            {approve ? 'Approve and reopen' : 'Reject'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {decide.error && <Alert>{errorMessage(decide.error)}</Alert>}
        <p>
          <span className="font-medium">{r.requestedBy}</span>: {r.reason}
        </p>
        {approve && (
          <Alert variant="info">
            {r.entityName} goes back to In progress as a new working version. The finalised version
            stays viewable, and the exchange rates of the period unlock if no other finalised report
            uses them.
          </Alert>
        )}
        <Field label={approve ? 'Comment (optional)' : 'Reason for rejecting'} htmlFor="ea-comment">
          <textarea
            id="ea-comment"
            className="min-h-20 w-full rounded-md border bg-card px-3 py-2 text-sm"
            value={comment}
            maxLength={1000}
            onChange={(e) => setComment(e.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}
