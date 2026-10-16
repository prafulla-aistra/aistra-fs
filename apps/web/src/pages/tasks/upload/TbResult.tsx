import { AlertTriangle, CircleCheck, CircleX, Info } from 'lucide-react';
import type { TbTotalsDto, UploadIssueDto } from '@finance-close/shared';
import { amountText } from '@/lib/format';
import { cn } from '@/lib/utils';

interface ResultLike {
  status: 'ERROR' | 'VALIDATED_WITH_WARNINGS' | 'VALIDATED';
  totals: TbTotalsDto;
  lineCount: number;
  newAccounts: { code: string; name: string }[];
  errors: UploadIssueDto[];
  warnings: UploadIssueDto[];
  info?: UploadIssueDto[];
}

/** ✓ balanced / ✕ not, account count, debits, credits, difference, new accounts, warnings. */
export function TbResult({ version, compact }: { version: ResultLike; compact?: boolean }) {
  const balanced = !version.errors.some((e) => e.code === 'UNBALANCED');
  const ok = version.status !== 'ERROR';
  return (
    <div
      className={cn(
        'space-y-2 rounded-md border px-3 py-2 text-sm',
        !ok
          ? 'border-destructive/20 bg-red-50'
          : version.status === 'VALIDATED_WITH_WARNINGS'
            ? 'border-warning/30 bg-amber-50'
            : 'border-success/20 bg-success-surface',
      )}
    >
      <p
        className={cn(
          'flex items-center gap-1.5 font-medium',
          ok ? 'text-success' : 'text-destructive',
        )}
      >
        {ok ? <CircleCheck className="size-4" /> : <CircleX className="size-4" />}
        {ok
          ? 'Balanced — debits equal credits'
          : balanced
            ? 'Errors in the file'
            : 'Not balanced — cannot continue'}
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-4">
        <Stat label="Accounts" value={String(version.lineCount)} />
        <Stat label="Debits" value={amountText(version.totals.debits)} />
        <Stat label="Credits" value={amountText(version.totals.credits)} />
        <Stat
          label="Difference"
          value={amountText(version.totals.difference)}
          strong={version.totals.difference !== '0.00'}
        />
      </dl>
      {version.newAccounts.length > 0 && (
        <p className="flex gap-1.5 text-xs">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <strong>
              {version.newAccounts.length} new account{version.newAccounts.length === 1 ? '' : 's'}
            </strong>{' '}
            not in the chart of accounts — mapped in the next step
            {!compact && `: ${version.newAccounts.map((a) => `${a.code} ${a.name}`).join(', ')}`}.
          </span>
        </p>
      )}
      {!compact && <Issues issues={version.errors} tone="error" />}
      {compact && version.errors.length > 0 && (
        <Issues issues={version.errors.slice(0, 2)} tone="error" />
      )}
      <Issues issues={version.warnings} tone="warning" />
      {!compact && version.info && (
        <Issues issues={version.info.filter((i) => i.code !== 'NEW_ACCOUNTS')} tone="info" />
      )}
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('font-mono tabular-nums', strong && 'font-semibold text-destructive')}>
        {value}
      </dd>
    </div>
  );
}

export function Issues({
  issues,
  tone,
}: {
  issues: UploadIssueDto[];
  tone: 'error' | 'warning' | 'info';
}) {
  if (issues.length === 0) return null;
  const Icon = tone === 'error' ? CircleX : tone === 'warning' ? AlertTriangle : Info;
  return (
    <ul className="space-y-0.5 text-xs">
      {issues.map((i, n) => (
        <li
          key={`${i.code}-${n}`}
          className={cn(
            'flex gap-1.5',
            tone === 'error' && 'text-destructive',
            tone === 'warning' && 'text-warning-foreground',
            tone === 'info' && 'text-muted-foreground',
          )}
        >
          <Icon className="mt-0.5 size-3.5 shrink-0" />
          {i.message}
        </li>
      ))}
    </ul>
  );
}
