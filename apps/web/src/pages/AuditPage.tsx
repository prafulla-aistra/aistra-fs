import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { AuditLogDto, AuditLogPage, UserDto } from '@finance-close/shared';
import { PageHeader } from '@/components/AppShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, Field, Input, Select } from '@/components/ui/form';
import { Table, Td, Th } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

const PAGE_SIZE = 50;

/** Plain-language names for audit actions. Unknown actions fall back to their code. */
const ACTION_LABELS: Record<string, string> = {
  LOGIN_SUCCESS: 'Signed in',
  LOGIN_FAILURE: 'Sign-in failed',
  ACCOUNT_LOCKED: 'Account locked',
  LOGOUT: 'Signed out',
  PASSWORD_CHANGE: 'Changed own password',
  PASSWORD_RESET: 'Password reset by admin',
  USER_CREATE: 'User created',
  USER_UPDATE: 'User details changed',
  PERMISSION_CHANGE: 'Permissions changed',
  USER_DEACTIVATE: 'User deactivated',
  USER_REACTIVATE: 'User reactivated',
};
const label = (action: string) => ACTION_LABELS[action] ?? action;

interface Filters {
  userId: string;
  action: string;
  from: string; // yyyy-mm-dd (local)
  to: string;
}
const EMPTY: Filters = { userId: '', action: '', from: '', to: '' };

export function AuditPage() {
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);

  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<UserDto[]>('/users') });
  const actions = useQuery({
    queryKey: ['audit', 'actions'],
    queryFn: () => api.get<string[]>('/audit-logs/actions'),
  });
  const log = useQuery({
    queryKey: ['audit', filters, page],
    queryFn: () => api.get<AuditLogPage>(`/audit-logs?${toQuery(filters, page)}`),
    placeholderData: keepPreviousData,
  });
  const userName = (id: string | null) => users.data?.find((u) => u.id === id)?.name;

  const dateError =
    draft.from && draft.to && draft.from > draft.to ? '"From" must be on or before "To".' : null;
  const apply = () => {
    setFilters(draft);
    setPage(1);
  };

  const totalPages = log.data ? Math.max(1, Math.ceil(log.data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <PageHeader
        title="Audit trail"
        description="Every sign-in, user change and permission change, newest first. Entries can never be edited or deleted."
      />

      <form
        className="mb-4 grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-[2fr_2fr_1fr_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          if (!dateError) apply();
        }}
      >
        <Field label="User" htmlFor="f-user">
          <Select
            id="f-user"
            value={draft.userId}
            onChange={(e) => setDraft({ ...draft, userId: e.target.value })}
          >
            <option value="">All users</option>
            {users.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.email})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Action" htmlFor="f-action">
          <Select
            id="f-action"
            value={draft.action}
            onChange={(e) => setDraft({ ...draft, action: e.target.value })}
          >
            <option value="">All actions</option>
            {actions.data?.map((a) => (
              <option key={a} value={a}>
                {label(a)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="From" htmlFor="f-from">
          <Input
            id="f-from"
            type="date"
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </Field>
        <Field label="To" htmlFor="f-to">
          <Input
            id="f-to"
            type="date"
            value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </Field>
        <div className="flex items-end gap-2">
          <Button type="submit" disabled={Boolean(dateError)}>
            Apply
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setDraft(EMPTY);
              setFilters(EMPTY);
              setPage(1);
            }}
          >
            Clear
          </Button>
        </div>
        {dateError && <p className="text-xs text-destructive sm:col-span-full">{dateError}</p>}
        <p className="text-xs text-muted-foreground sm:col-span-full">
          Filtering by user shows actions they performed and actions performed on their account.
        </p>
      </form>

      {log.error && <Alert className="mb-4">{errorMessage(log.error)}</Alert>}

      <Table>
        <thead>
          <tr>
            <Th>When</Th>
            <Th>Performed by</Th>
            <Th>Action</Th>
            <Th>Affected user</Th>
            <Th>Details</Th>
            <Th>IP address</Th>
          </tr>
        </thead>
        <tbody>
          {log.data?.items.length === 0 && (
            <tr>
              <Td colSpan={6} className="text-muted-foreground">
                No entries match these filters.
              </Td>
            </tr>
          )}
          {log.data?.items.map((row) => (
            <tr key={row.id} className="align-top hover:bg-muted/30">
              <Td className="whitespace-nowrap">{formatDateTime(row.timestamp)}</Td>
              <Td>
                {row.user ? (
                  <>
                    <div className="font-medium">{row.user.name}</div>
                    <div className="text-xs text-muted-foreground">{row.user.email}</div>
                  </>
                ) : (
                  <span className="text-muted-foreground">Unknown / system</span>
                )}
              </Td>
              <Td>
                <Badge
                  variant={
                    row.action === 'LOGIN_FAILURE' || row.action === 'ACCOUNT_LOCKED'
                      ? 'destructive'
                      : 'secondary'
                  }
                >
                  {label(row.action)}
                </Badge>
              </Td>
              <Td>
                {row.entityType === 'USER'
                  ? (userName(row.entityId) ?? '—')
                  : (row.entityType ?? '—')}
              </Td>
              <Td className="max-w-md">
                <Details row={row} />
              </Td>
              <Td className="font-mono text-xs text-muted-foreground">{row.ip ?? '—'}</Td>
            </tr>
          ))}
        </tbody>
      </Table>

      <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
        <span>{log.data ? `${log.data.total} entr${log.data.total === 1 ? 'y' : 'ies'}` : ''}</span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </Button>
          <span>
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </>
  );
}

/** Old → new values, one line per field. */
function Details({ row }: { row: AuditLogDto }) {
  const oldV = asRecord(row.oldValue);
  const newV = asRecord(row.newValue);
  const keys = [...new Set([...Object.keys(oldV), ...Object.keys(newV)])];
  if (keys.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <dl className="space-y-0.5 text-xs">
      {keys.map((k) => (
        <div key={k} className="flex flex-wrap gap-x-1">
          <dt className="text-muted-foreground">{k}:</dt>
          <dd>
            {k in oldV && (
              <span className="text-muted-foreground line-through">{show(oldV[k])}</span>
            )}
            {k in oldV && k in newV && ' → '}
            {k in newV && <span>{show(newV[k])}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function show(v: unknown): string {
  if (v === null) return 'all / none';
  if (Array.isArray(v)) return v.length === 0 ? '(none)' : v.join(', ');
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

function toQuery(f: Filters, page: number): string {
  const q = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (f.userId) q.set('userId', f.userId);
  if (f.action) q.set('action', f.action);
  // Dates are the user's local days: from start of "From" to start of the day after "To".
  if (f.from) q.set('from', new Date(`${f.from}T00:00:00`).toISOString());
  if (f.to) {
    const end = new Date(`${f.to}T00:00:00`);
    end.setDate(end.getDate() + 1);
    q.set('to', end.toISOString());
  }
  return q.toString();
}
