import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Info,
  MessageSquare,
  XCircle,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import {
  CHECK_SEVERITY_LABELS,
  QUERY_TARGET_LABELS,
  type CheckResultDto,
  type QueryDto,
  type QueryTargetType,
  type ReviewPackDto,
  type ReviewStepDto,
  type SignOffDto,
} from '@finance-close/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, Checkbox, Field, Input, Select } from '@/components/ui/form';
import { Table, Td, Th } from '@/components/ui/overlay';
import { Skeleton } from '@/components/ui/skeleton';
import { api, apiFetch, errorMessage } from '@/lib/api';
import { formatDateTime, statementAmount } from '@/lib/format';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { useApiBase } from '../api-base';
import { SigningCard } from './SigningCard';
import { EntityTabs } from '../EntityTabs';
import { useSelectedEntity } from '../useSelectedEntity';
import { useEntityFromUrl } from './markers';

export type GoTo = (step: string, key?: string) => void;

/** Step "Review": the review pack, submission, queries and the reviewer's decision. */
export function ReviewStep({ taskId, onGo }: { taskId: string; onGo: GoTo }) {
  const step = useQuery({
    queryKey: ['review-step', taskId],
    queryFn: () => api.get<ReviewStepDto>(`/tasks/${taskId}/review-step`),
  });
  const entities = useMemo(
    () => (step.data?.entities ?? []).map((e) => ({ ...e, hasValidatedTb: true })),
    [step.data],
  );
  const [selected, choose] = useSelectedEntity(taskId, entities);
  useEntityFromUrl(entities, choose);
  if (step.error) return <Alert>{errorMessage(step.error)}</Alert>;
  if (!step.data || !selected) return <Skeleton className="h-96 w-full" />;
  return (
    <div className="space-y-5">
      <EntityTabs
        entities={entities}
        selected={selected}
        onSelect={choose}
        markerText={(e) => (e.openQueries ? `${e.openQueries} open queries` : '')}
        marker={(e) =>
          e.openQueries ? (
            <span className="inline-flex items-center gap-1 text-xs text-warning-foreground tabular-nums">
              <MessageSquare className="size-3" /> {e.openQueries}
            </span>
          ) : null
        }
      />
      <EntityReview key={selected} taskId={taskId} entityCode={selected} onGo={onGo} />
    </div>
  );
}

const RESULT_ICON = {
  PASS: <CheckCircle2 className="size-4 text-success" aria-label="Pass" />,
  FAIL: <XCircle className="size-4 text-destructive" aria-label="Fail" />,
  NA: <Info className="size-4 text-muted-foreground" aria-label="Not applicable" />,
};
const SIGN_OFF_TEXT: Record<SignOffDto['status'], string> = {
  NOT_STARTED: 'Not started',
  SUBMITTED: 'Submitted',
  WAITING: 'Waiting',
  APPROVED: 'Approved',
  RETURNED: 'Returned',
  NOT_REQUIRED: 'Not required',
};

export function EntityReview({
  taskId,
  entityCode,
  onGo,
}: {
  taskId: string;
  entityCode: string;
  onGo: GoTo;
}) {
  const qc = useQueryClient();
  const apiBase = useApiBase(taskId, entityCode);
  const key = ['review', taskId, entityCode];
  const q = useQuery({
    queryKey: key,
    queryFn: () => api.get<ReviewPackDto>(`${apiBase}/review`),
  });
  const refresh = (p: ReviewPackDto) => {
    qc.setQueryData(key, p);
    void qc.invalidateQueries({ queryKey: ['review-step', taskId] });
    void qc.invalidateQueries({ queryKey: ['task', taskId] });
    void qc.invalidateQueries({ queryKey: ['cfs', taskId] });
    void qc.invalidateQueries({ queryKey: ['notifications'] });
  };
  if (q.error) return <Alert>{errorMessage(q.error)}</Alert>;
  if (!q.data) return <Skeleton className="h-96 w-full" />;
  const p = q.data;
  const base = `${apiBase}/review`;
  const failing = p.checks.filter((c) => c.result === 'FAIL');
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-start justify-between gap-4 pt-6">
          <div>
            <h2 className="text-lg font-semibold text-ink">
              {p.entity.legalName} · {p.periodLabel}
            </h2>
            <p className="text-sm text-muted-foreground">
              {p.entity.functionalCurrency} · {p.entity.erp} · comparative{' '}
              {p.comparativeLabel || 'none'}
              {p.state.reviewLevels === 2 && ' · two review levels'}
            </p>
            {p.fromSnapshot && p.state.finalised && (
              <p className="mt-1 text-sm">
                Finalised {formatDateTime(p.state.finalised.at)} by {p.state.finalised.by} ·
                snapshot v{p.state.finalised.version} · hash{' '}
                <code className="text-xs">{p.state.finalised.hash.slice(0, 12)}…</code>
              </p>
            )}
          </div>
          <SignOffStrip signOffs={p.signOffs} />
        </CardContent>
      </Card>

      {p.periodCheck && <PeriodCheckPanel p={p} base={base} onDone={refresh} />}
      {p.actions.decidingAs && <SigningCard taskId={taskId} itemKey={entityCode} />}
      {p.actions.decidingAs && <DecisionPanel p={p} base={base} onDone={refresh} />}

      <Section
        n={1}
        title="Control checks"
        summary={`${failing.length} failing of ${p.checks.length}`}
        open={failing.length > 0}
      >
        <ChecksTable checks={p.checks} queries={p.queries} onGo={onGo} />
      </Section>
      <Section n={2} title="Key figures" summary={p.keyFigures.map((k) => k.currency).join(', ')}>
        <div className="grid gap-4 lg:grid-cols-2">
          {p.keyFigures.map((k) => (
            <Table key={k.currency}>
              <thead>
                <tr>
                  <Th>{k.currency}</Th>
                  <Th className="text-right">{p.periodLabel}</Th>
                  <Th className="text-right">{p.comparativeLabel || 'Comparative'}</Th>
                  <Th className="text-right">Variance</Th>
                </tr>
              </thead>
              <tbody>
                {k.rows.map((r) => (
                  <tr key={r.label}>
                    <Td>{r.label}</Td>
                    <Td className="text-right tabular-nums">{statementAmount(r.current)}</Td>
                    <Td className="text-right tabular-nums">{statementAmount(r.comparative)}</Td>
                    <Td className="text-right tabular-nums">
                      {statementAmount(r.variance)}
                      {r.variancePct && (
                        <span className="ml-1 text-xs text-muted-foreground">{r.variancePct}%</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ))}
        </div>
      </Section>
      <Section n={3} title="Significant variances" summary={`${p.variances.length} flagged`}>
        {p.variances.length === 0 ? (
          <Empty>No variance above the materiality threshold.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Account</Th>
                <Th className="text-right">Current</Th>
                <Th className="text-right">Comparative</Th>
                <Th className="text-right">Variance</Th>
                <Th>Explanation</Th>
              </tr>
            </thead>
            <tbody>
              {p.variances.map((v) => (
                <tr key={v.code}>
                  <Td>
                    {v.code} {v.name}
                  </Td>
                  <Td className="text-right tabular-nums">{statementAmount(v.current)}</Td>
                  <Td className="text-right tabular-nums">{statementAmount(v.comparative)}</Td>
                  <Td className="text-right tabular-nums">
                    {statementAmount(v.variance)}
                    {v.variancePct && (
                      <span className="ml-1 text-xs text-muted-foreground">{v.variancePct}%</span>
                    )}
                  </Td>
                  <Td className={cn(!v.explanation && 'text-destructive')}>
                    {v.explanation ?? 'Not explained'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
      <Section
        n={4}
        title="Notes to accounts"
        summary={`${p.notes.reviewed} of ${p.notes.visible} reviewed · ${p.notes.staleFlags} stale numbers`}
      >
        {p.notes.notReviewed.length === 0 ? (
          <Empty>Every note is reviewed.</Empty>
        ) : (
          <div className="text-sm">
            Not reviewed:{' '}
            {p.notes.notReviewed.map((n, i) => (
              <span key={n}>
                {i > 0 && ', '}
                {n}
              </span>
            ))}
            <Button variant="link" size="sm" onClick={() => onGo('NOTES')}>
              Open notes <ChevronRight />
            </Button>
          </div>
        )}
      </Section>
      <Section
        n={5}
        title="Translation"
        summary={
          p.translation.length ? p.translation.map((t) => t.currency).join(', ') : 'Not translated'
        }
      >
        {p.translation.length === 0 ? (
          <Empty>This entity is reported in its functional currency only.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Currency</Th>
                <Th className="text-right">Opening</Th>
                <Th className="text-right">Closing</Th>
                <Th className="text-right">Average</Th>
                <Th className="text-right">Historical</Th>
                <Th className="text-right">FCTR</Th>
                <Th className="text-right">FCTR movement</Th>
                <Th>Retained earnings</Th>
              </tr>
            </thead>
            <tbody>
              {p.translation.map((t) => (
                <tr key={t.currency}>
                  <Td>{t.currency}</Td>
                  <Td className="text-right tabular-nums">{t.rates.opening ?? '–'}</Td>
                  <Td className="text-right tabular-nums">{t.rates.closing ?? '–'}</Td>
                  <Td className="text-right tabular-nums">{t.rates.average ?? '–'}</Td>
                  <Td className="text-right tabular-nums">{t.rates.historical ?? '–'}</Td>
                  <Td className="text-right tabular-nums">{statementAmount(t.fctr)}</Td>
                  <Td className="text-right tabular-nums">{statementAmount(t.fctrMovement)}</Td>
                  <Td className="text-xs">{t.reMethod}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
      <Section
        n={6}
        title="Intercompany balances"
        summary={`${p.intercompany.length} counterparties`}
      >
        {p.intercompany.length === 0 ? (
          <Empty>No intercompany balances.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Counterparty</Th>
                <Th className="text-right">Receivable</Th>
                <Th className="text-right">Payable</Th>
                <Th className="text-right">Revenue</Th>
                <Th className="text-right">Charges</Th>
              </tr>
            </thead>
            <tbody>
              {p.intercompany.map((r) => (
                <tr key={r.counterpartyCode}>
                  <Td>
                    {r.counterpartyCode} · {r.counterpartyName}
                  </Td>
                  <Td className="text-right tabular-nums">{statementAmount(r.receivable)}</Td>
                  <Td className="text-right tabular-nums">{statementAmount(r.payable)}</Td>
                  <Td className="text-right tabular-nums">{statementAmount(r.revenue)}</Td>
                  <Td className="text-right tabular-nums">{statementAmount(r.charges)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
      <Section n={7} title="Source files" summary={`${p.files.length} files`}>
        <Table>
          <thead>
            <tr>
              <Th>File</Th>
              <Th>Uploaded</Th>
              <Th>SHA-256</Th>
            </tr>
          </thead>
          <tbody>
            {p.files.map((f) => (
              <tr key={`${f.name}${f.uploadedAt}`}>
                <Td>
                  {f.name}
                  {f.version && (
                    <span className="ml-1 text-xs text-muted-foreground">TB v{f.version}</span>
                  )}
                </Td>
                <Td className="whitespace-nowrap">
                  {formatDateTime(f.uploadedAt)} · {f.uploadedBy}
                </Td>
                <Td>
                  <code className="text-xs">{f.sha256.slice(0, 16)}…</code>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>
      <Section
        n={8}
        title="Changes since the last submission"
        summary={`${p.changes.length} changes`}
      >
        {p.changes.length === 0 ? (
          <Empty>No changes recorded.</Empty>
        ) : (
          <ul className="space-y-1 text-sm">
            {p.changes.map((c, i) => (
              <li key={i}>
                <span className="text-muted-foreground">{formatDateTime(c.at)}</span> ·{' '}
                {c.user ?? 'System'} · {c.action}
                {c.summary && <span className="text-muted-foreground"> — {c.summary}</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section
        n={9}
        title="Review queries"
        summary={`${p.queries.filter((x) => x.status !== 'CLOSED').length} not closed of ${p.queries.length}`}
        open={p.queries.some((x) => x.status !== 'CLOSED')}
      >
        <Queries p={p} base={base} onDone={refresh} onGo={onGo} />
      </Section>
      <Section
        n={10}
        title="Sign-offs and acknowledgements"
        summary={`${p.acknowledgements.length} acknowledged warnings`}
      >
        <SignOffTable signOffs={p.signOffs} />
        {p.acknowledgements.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm">
            {p.acknowledgements.map((a) => (
              <li key={a.key}>
                <span className="font-medium">{checkName(p, a.key)}</span>: “{a.comment}”{' '}
                {a.by && <span className="text-muted-foreground">— {a.by}</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {p.consolidation && <ConsolidationSections p={p} />}

      {!p.fromSnapshot && !p.actions.decidingAs && p.entity.itemStatus !== 'FINALISED' && (
        <SubmitPanel p={p} base={base} onDone={refresh} />
      )}
    </div>
  );
}

const checkName = (p: ReviewPackDto, key: string) => {
  const c = p.checks.find((x) => x.key === key);
  return c ? `${c.name}${c.currency ? ` (${c.currency})` : ''}` : key;
};

function Section({
  n,
  title,
  summary,
  open,
  children,
}: {
  n: number;
  title: string;
  summary: string;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={open} className="group rounded-lg border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
        <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
        <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-semibold">
          {n}
        </span>
        <span className="font-medium">{title}</span>
        <span className="ml-auto text-sm text-muted-foreground">{summary}</span>
      </summary>
      <div className="border-t px-4 py-3">{children}</div>
    </details>
  );
}

const Empty = ({ children }: { children: ReactNode }) => (
  <p className="text-sm text-muted-foreground">{children}</p>
);

function SignOffStrip({ signOffs }: { signOffs: SignOffDto[] }) {
  return (
    <ol className="flex flex-wrap gap-2" aria-label="Sign-offs">
      {signOffs.map((s) => (
        <li
          key={s.role}
          className={cn(
            'rounded-md border px-3 py-1.5 text-xs',
            s.status === 'APPROVED' || s.status === 'SUBMITTED'
              ? 'border-success/30 bg-mint'
              : s.status === 'RETURNED'
                ? 'border-destructive/30 bg-red-50'
                : 'bg-card',
          )}
        >
          <div className="font-semibold capitalize">{s.role.toLowerCase()}</div>
          <div>
            {SIGN_OFF_TEXT[s.status]}
            {s.name && ` · ${s.name}`}
          </div>
          {s.at && <div className="text-muted-foreground">{formatDateTime(s.at)}</div>}
        </li>
      ))}
    </ol>
  );
}

function SignOffTable({ signOffs }: { signOffs: SignOffDto[] }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Role</Th>
          <Th>Name</Th>
          <Th>Status</Th>
          <Th>When</Th>
          <Th>Comment</Th>
        </tr>
      </thead>
      <tbody>
        {signOffs.map((s) => (
          <tr key={s.role}>
            <Td className="capitalize">{s.role.toLowerCase()}</Td>
            <Td>{s.name ?? '–'}</Td>
            <Td>{SIGN_OFF_TEXT[s.status]}</Td>
            <Td>{s.at ? formatDateTime(s.at) : '–'}</Td>
            <Td>{s.comment ?? ''}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function ChecksTable({
  checks,
  queries,
  onGo,
}: {
  checks: CheckResultDto[];
  queries: QueryDto[];
  onGo: GoTo;
}) {
  const open = new Set(
    queries
      .filter((q) => q.targetType === 'CHECK' && q.status !== 'CLOSED')
      .map((q) => q.targetKey),
  );
  return (
    <Table>
      <thead>
        <tr>
          <Th>Result</Th>
          <Th>Check</Th>
          <Th>Severity</Th>
          <Th>Details</Th>
          <Th />
        </tr>
      </thead>
      <tbody>
        {checks.map((c) => (
          <tr
            key={c.key}
            className={cn(c.result === 'FAIL' && c.severity === 'BLOCKING' && 'bg-red-50/60')}
          >
            <Td>{RESULT_ICON[c.result]}</Td>
            <Td>
              {c.name}
              {c.currency && (
                <span className="ml-1 text-xs text-muted-foreground">({c.currency})</span>
              )}
              {open.has(c.key) && <QueryMarker />}
            </Td>
            <Td>
              <Badge
                variant={
                  c.severity === 'BLOCKING'
                    ? 'destructive'
                    : c.severity === 'WARNING'
                      ? 'warning'
                      : 'neutral'
                }
              >
                {CHECK_SEVERITY_LABELS[c.severity]}
              </Badge>
            </Td>
            <Td className="text-xs tabular-nums">{c.details}</Td>
            <Td>
              <Button variant="link" size="sm" onClick={() => onGo(c.link.step, c.link.key)}>
                Go to <ChevronRight />
              </Button>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** A small marker shown next to anything with an open review query. */
export function QueryMarker({ count }: { count?: number }) {
  return (
    <span
      className="ml-1 inline-flex items-center gap-0.5 rounded bg-amber-50 px-1 text-xs text-warning-foreground"
      title="Open review query"
    >
      <MessageSquare className="size-3" />
      {count && count > 1 ? count : ''}
    </span>
  );
}

function SubmitPanel({
  p,
  base,
  onDone,
}: {
  p: ReviewPackDto;
  base: string;
  onDone: (p: ReviewPackDto) => void;
}) {
  const [acks, setAcks] = useState<Record<string, string>>({});
  const [declared, setDeclared] = useState(false);
  const submit = useMutation({
    mutationFn: () =>
      api.post<ReviewPackDto>(`${base}/submit`, {
        declaration: declared,
        acknowledgements: p.warningsToAcknowledge.map((key) => ({ key, comment: acks[key] ?? '' })),
      }),
    onSuccess: (r) => {
      toast(`${p.entity.shortName} submitted for review.`);
      onDone(r);
    },
  });
  const submitted = p.signOffs[0]?.status === 'SUBMITTED' && p.state.submissionNumber !== null;
  if (submitted)
    return (
      <Alert variant="info">
        Submitted for review on {formatDateTime(p.state.submittedAt)} (submission{' '}
        {p.state.submissionNumber}). Any change to the data withdraws the submission.
      </Alert>
    );
  const acksOk = p.warningsToAcknowledge.every((k) => (acks[k] ?? '').trim().length >= 10);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Submit for review</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {submit.error && <Alert>{errorMessage(submit.error)}</Alert>}
        {p.actions.submitBlockedBy.length > 0 && (
          <Alert>
            <div className="font-medium">You cannot submit yet:</div>
            <ul className="list-disc pl-5">
              {p.actions.submitBlockedBy.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </Alert>
        )}
        {p.warningsToAcknowledge.length > 0 && (
          <div className="space-y-3">
            <p className="flex items-center gap-1 text-sm font-medium">
              <CircleAlert className="size-4 text-warning" /> Acknowledge each failing warning (at
              least 10 characters)
            </p>
            {p.warningsToAcknowledge.map((k) => {
              const c = p.checks.find((x) => x.key === k)!;
              const v = acks[k] ?? '';
              return (
                <Field
                  key={k}
                  label={`${c.name}${c.currency ? ` (${c.currency})` : ''}: ${c.details}`}
                  htmlFor={`ack-${k}`}
                >
                  <Input
                    id={`ack-${k}`}
                    value={v}
                    maxLength={1000}
                    aria-invalid={v.length > 0 && v.trim().length < 10}
                    placeholder="Why this is acceptable"
                    onChange={(e) => setAcks({ ...acks, [k]: e.target.value })}
                  />
                </Field>
              );
            })}
          </div>
        )}
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={declared}
            onChange={(e) => setDeclared(e.target.checked)}
            className="mt-0.5"
          />
          <span>{p.declaration}</span>
        </label>
        <Button
          disabled={!p.actions.canSubmit || !acksOk || !declared || submit.isPending}
          onClick={() => submit.mutate()}
        >
          Submit for review
        </Button>
      </CardContent>
    </Card>
  );
}

function DecisionPanel({
  p,
  base,
  onDone,
}: {
  p: ReviewPackDto;
  base: string;
  onDone: (p: ReviewPackDto) => void;
}) {
  const [comment, setComment] = useState('');
  const approve = useMutation({
    mutationFn: () =>
      api.post<ReviewPackDto>(`${base}/approve`, { comment: comment.trim() || null }),
    onSuccess: (r) => {
      toast(
        r.entity.itemStatus === 'FINALISED'
          ? `${p.entity.shortName} finalised.`
          : 'Approved; sent to the approver.',
      );
      setComment('');
      onDone(r);
    },
  });
  const ret = useMutation({
    mutationFn: () => api.post<ReviewPackDto>(`${base}/return`, { comment }),
    onSuccess: (r) => {
      toast(`${p.entity.shortName} returned to the preparer.`);
      setComment('');
      onDone(r);
    },
  });
  const as = p.actions.decidingAs === 'APPROVER' ? 'approver' : 'reviewer';
  const final = p.actions.decidingAs === 'APPROVER' || p.state.reviewLevels === 1;
  return (
    <Card className="border-primary/40">
      <CardHeader>
        <CardTitle>
          Your decision as {as}
          {final && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              Approving finalises the entity.
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {(approve.error || ret.error) && <Alert>{errorMessage(approve.error ?? ret.error)}</Alert>}
        {p.actions.approveBlockedBy.length > 0 && (
          <Alert variant="info">
            <div className="font-medium">Approval is blocked:</div>
            <ul className="list-disc pl-5">
              {p.actions.approveBlockedBy.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </Alert>
        )}
        <Field
          label="Comment (required to return, at least 10 characters)"
          htmlFor="decision-comment"
        >
          <textarea
            id="decision-comment"
            className="min-h-20 w-full rounded-md border bg-card px-3 py-2 text-sm"
            value={comment}
            maxLength={2000}
            onChange={(e) => setComment(e.target.value)}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={p.actions.approveBlockedBy.length > 0 || approve.isPending}
            onClick={() => approve.mutate()}
          >
            {final ? 'Approve and finalise' : 'Approve (send to approver)'}
          </Button>
          <Button
            variant="outline"
            disabled={!p.actions.canReturn || comment.trim().length < 10 || ret.isPending}
            onClick={() => ret.mutate()}
          >
            Return to preparer
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

const STATUS_VARIANT = { OPEN: 'warning', ANSWERED: 'review', CLOSED: 'success' } as const;

function Queries({
  p,
  base,
  onDone,
  onGo,
}: {
  p: ReviewPackDto;
  base: string;
  onDone: (p: ReviewPackDto) => void;
  onGo: GoTo;
}) {
  return (
    <div className="space-y-3">
      {p.queries.length === 0 && <Empty>No queries yet.</Empty>}
      {p.queries.map((q) => (
        <QueryCard key={q.id} q={q} base={base} onDone={onDone} onGo={onGo} />
      ))}
      {p.actions.canRaiseQuery && <RaiseQuery p={p} base={base} onDone={onDone} />}
    </div>
  );
}

function QueryCard({
  q,
  base,
  onDone,
  onGo,
}: {
  q: QueryDto;
  base: string;
  onDone: (p: ReviewPackDto) => void;
  onGo: GoTo;
}) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const answer = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append('text', text);
      if (file) form.append('file', file);
      return apiFetch<ReviewPackDto>(`${base}/queries/${q.id}/answer`, {
        method: 'POST',
        body: form,
      });
    },
    onSuccess: (r) => {
      setText('');
      setFile(null);
      onDone(r);
    },
  });
  const status = useMutation({
    mutationFn: (close: boolean) =>
      api.post<ReviewPackDto>(`${base}/queries/${q.id}/status`, {
        status: close ? 'CLOSED' : 'OPEN',
        comment: text.trim() || null,
      }),
    onSuccess: (r) => {
      setText('');
      onDone(r);
    },
  });
  return (
    <div className="rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={STATUS_VARIANT[q.status]}>
          {q.status === 'OPEN' ? 'Open' : q.status === 'ANSWERED' ? 'Answered' : 'Closed'}
        </Badge>
        <span className="text-xs text-muted-foreground">{QUERY_TARGET_LABELS[q.targetType]}</span>
        {q.link && q.link.step !== 'REVIEW' ? (
          <button
            type="button"
            className="font-medium text-primary hover:underline"
            onClick={() => onGo(q.link!.step, q.link!.key)}
          >
            {q.targetLabel}
          </button>
        ) : (
          <span className="font-medium">{q.targetLabel}</span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {q.raisedBy} · {formatDateTime(q.raisedAt)}
        </span>
      </div>
      <p className="mt-2">{q.text}</p>
      {q.messages.map((m, i) => (
        <div key={i} className="mt-2 border-l-2 pl-3">
          <div className="text-xs text-muted-foreground">
            {m.kind === 'ANSWER' ? 'Answer' : m.kind === 'CLOSE' ? 'Closed' : 'Reopened'} ·{' '}
            {m.author} · {formatDateTime(m.at)}
          </div>
          {m.text && <div>{m.text}</div>}
          {m.file && <div className="text-xs">Attachment: {m.file.name}</div>}
        </div>
      ))}
      {(q.canAnswer || q.canClose || q.canReopen) && (
        <div className="mt-3 space-y-2">
          {(answer.error || status.error) && (
            <Alert>{errorMessage(answer.error ?? status.error)}</Alert>
          )}
          <Input
            value={text}
            maxLength={2000}
            placeholder={q.canAnswer ? 'Your answer' : 'Comment (optional)'}
            onChange={(e) => setText(e.target.value)}
            aria-label="Reply"
          />
          <div className="flex flex-wrap items-center gap-2">
            {q.canAnswer && (
              <>
                <input
                  type="file"
                  aria-label="Attach a file"
                  className="text-xs"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <Button
                  size="sm"
                  disabled={text.trim().length < 3 || answer.isPending}
                  onClick={() => answer.mutate()}
                >
                  Answer
                </Button>
              </>
            )}
            {q.canClose && (
              <Button
                size="sm"
                variant="outline"
                disabled={status.isPending}
                onClick={() => status.mutate(true)}
              >
                Close query
              </Button>
            )}
            {q.canReopen && (
              <Button
                size="sm"
                variant="outline"
                disabled={status.isPending}
                onClick={() => status.mutate(false)}
              >
                Reopen
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RaiseQuery({
  p,
  base,
  onDone,
}: {
  p: ReviewPackDto;
  base: string;
  onDone: (p: ReviewPackDto) => void;
}) {
  const [type, setType] = useState<QueryTargetType>('NOTE');
  const [target, setTarget] = useState('');
  const [text, setText] = useState('');
  const options = type === 'ENTITY' ? [] : p.queryTargets[type];
  const raise = useMutation({
    mutationFn: () =>
      api.post<ReviewPackDto>(`${base}/queries`, {
        targetType: type,
        targetKey: type === 'ENTITY' ? null : target,
        text,
      }),
    onSuccess: (r) => {
      setText('');
      toast('Query raised; the preparer is notified.');
      onDone(r);
    },
  });
  return (
    <div className="space-y-2 rounded-md border border-dashed p-3">
      <div className="text-sm font-medium">Raise a query</div>
      {raise.error && <Alert>{errorMessage(raise.error)}</Alert>}
      <div className="grid gap-2 md:grid-cols-[12rem_1fr]">
        <Select
          aria-label="Query about"
          value={type}
          onChange={(e) => {
            setType(e.target.value as QueryTargetType);
            setTarget('');
          }}
        >
          {(Object.keys(QUERY_TARGET_LABELS) as QueryTargetType[]).map((t) => (
            <option key={t} value={t}>
              {QUERY_TARGET_LABELS[t]}
            </option>
          ))}
        </Select>
        {type !== 'ENTITY' && (
          <Select aria-label="Item" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Choose…</option>
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </Select>
        )}
      </div>
      <textarea
        aria-label="Query"
        className="min-h-16 w-full rounded-md border bg-card px-3 py-2 text-sm"
        value={text}
        maxLength={2000}
        placeholder="What needs explaining or fixing?"
        onChange={(e) => setText(e.target.value)}
      />
      <Button
        size="sm"
        disabled={text.trim().length < 3 || (type !== 'ENTITY' && !target) || raise.isPending}
        onClick={() => raise.mutate()}
      >
        Raise query
      </Button>
    </div>
  );
}

/** Review pack sections of a consolidation level (page 10). */
function ConsolidationSections({ p }: { p: ReviewPackDto }) {
  const c = p.consolidation!;
  return (
    <>
      {c.membersChanged.length > 0 && (
        <Alert>
          Member data changed – regenerate eliminations ({c.membersChanged.join(', ')}). Submission
          is blocked until then.
        </Alert>
      )}
      <Section
        n={11}
        title="Intercompany differences"
        summary={`${c.icDifferences.length} parked in IC suspense`}
        open={c.icDifferences.some((x) => !x.explanation)}
      >
        {c.icDifferences.length === 0 ? (
          <Empty>No intercompany differences above the tolerances.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Entry</Th>
                <Th className="text-right">In IC suspense</Th>
                <Th>Explanation</Th>
              </tr>
            </thead>
            <tbody>
              {c.icDifferences.map((x) => (
                <tr key={x.entryId}>
                  <Td>{x.title}</Td>
                  <Td className="text-right tabular-nums">
                    {statementAmount(x.amount.replace('-', ''))}
                  </Td>
                  <Td className={cn(!x.explanation && 'text-destructive')}>
                    {x.explanation ?? 'Not explained (explain it on step 3)'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
      <Section
        n={12}
        title="Manual adjustments"
        summary={`${c.manualAdjustments.length} adjustments`}
      >
        {c.manualAdjustments.length === 0 ? (
          <Empty>No manual adjustments.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Narration</Th>
                <Th>Reason</Th>
                <Th>Level</Th>
                <Th>By</Th>
                <Th className="text-right">Amount</Th>
              </tr>
            </thead>
            <tbody>
              {c.manualAdjustments.map((m, i) => (
                <tr key={i}>
                  <Td>{m.narration}</Td>
                  <Td>{m.reason}</Td>
                  <Td>{m.originLevel}</Td>
                  <Td>{m.by}</Td>
                  <Td className="text-right tabular-nums">{statementAmount(m.total)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
      <Section
        n={13}
        title="Goodwill and NCI"
        summary={`${c.goodwill.length} acquisitions · ${c.nci.length} NCI`}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <Table>
            <thead>
              <tr>
                <Th>Acquisition</Th>
                <Th className="text-right">Goodwill / (capital reserve)</Th>
              </tr>
            </thead>
            <tbody>
              {c.goodwill.map((g) => (
                <tr key={g.title}>
                  <Td>{g.title}</Td>
                  <Td className="text-right tabular-nums">{statementAmount(g.goodwill)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Table>
            <thead>
              <tr>
                <Th>Non-controlling interests</Th>
                <Th className="text-right">Share of profit</Th>
                <Th className="text-right">NCI</Th>
              </tr>
            </thead>
            <tbody>
              {c.nci.map((n) => (
                <tr key={n.title}>
                  <Td>{n.title}</Td>
                  <Td className="text-right tabular-nums">{statementAmount(n.nciProfit)}</Td>
                  <Td className="text-right tabular-nums">{statementAmount(n.nciEquity)}</Td>
                </tr>
              ))}
              {c.nci.length === 0 && (
                <tr>
                  <Td colSpan={3} className="text-muted-foreground">
                    No partly owned subsidiaries at this level.
                  </Td>
                </tr>
              )}
            </tbody>
          </Table>
        </div>
      </Section>
      <Section n={14} title="Members' snapshots used" summary={`${c.members.length} members`}>
        <Table>
          <thead>
            <tr>
              <Th>Member</Th>
              <Th>SFS task</Th>
              <Th>Snapshot</Th>
              <Th>SHA-256</Th>
            </tr>
          </thead>
          <tbody>
            {c.members.map((m) => (
              <tr key={m.code}>
                <Td>
                  {m.code} {m.shortName}
                </Td>
                <Td>{m.taskNumber ?? '–'}</Td>
                <Td>{m.snapshotVersion ?? '–'}</Td>
                <Td>
                  <code className="text-xs">{m.hash ? `${m.hash.slice(0, 16)}…` : '–'}</code>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>
    </>
  );
}

/** Quarterly / annual tasks (decision round 1, Q10b): the period against its months. */
function PeriodCheckPanel({
  p,
  base,
  onDone,
}: {
  p: ReviewPackDto;
  base: string;
  onDone: (p: ReviewPackDto) => void;
}) {
  const c = p.periodCheck!;
  const [text, setText] = useState(c.explanation ?? '');
  const save = useMutation({
    mutationFn: () => api.post<ReviewPackDto>(base + '/period-explanation', { text }),
    onSuccess: onDone,
  });
  if (c.monthsNotFinalised.length === 0 && c.differences === 0 && !c.explanation) return null;
  return (
    <Card>
      <CardContent className="space-y-2 pt-6 text-sm">
        {c.monthsNotFinalised.length > 0 ? (
          <Alert variant="info">
            Months of the period not finalised: {c.monthsNotFinalised.join(', ')}. The period is
            checked against its months once every month is finalised.
          </Alert>
        ) : (
          <>
            <p>
              {c.differences > 0
                ? c.differences +
                  ' difference(s) between the period and its months (see the check "Period agrees to its months").'
                : 'The period agrees to its months.'}{' '}
              {c.differences > 0 && !c.explanation && 'Blocking until explained.'}
            </p>
            {(c.differences > 0 || c.explanation) && (
              <div className="space-y-2">
                {save.error && <Alert>{errorMessage(save.error)}</Alert>}
                <textarea
                  className="min-h-16 w-full rounded-md border bg-card px-3 py-2 text-sm"
                  aria-label="Why the period does not tie to its months"
                  disabled={!c.canExplain}
                  value={text}
                  maxLength={1000}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Explain the difference (at least 20 characters)"
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    disabled={
                      !c.canExplain ||
                      text.trim().length < 20 ||
                      text.trim() === (c.explanation ?? '') ||
                      save.isPending
                    }
                    onClick={() => save.mutate()}
                  >
                    Save explanation
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
