import { useMutation } from '@tanstack/react-query';
import { CircleCheck, CircleX, Flag } from 'lucide-react';
import { useState } from 'react';
import type { ComparisonRowDto, EntityComparativesDto } from '@finance-close/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/form';
import { Table, Td, Th } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import { bracketAmount, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { SearchBox } from '@/pages/configuration/common';

type Filter = 'all' | 'flagged' | 'new' | 'nil' | 'unexplained';

/** Current vs comparative per account or per FSLI, with variance flags and explanations. */
export function ComparisonTable({
  taskId,
  data,
  onSaved,
}: {
  taskId: string;
  data: EntityComparativesDto;
  onSaved: (d: EntityComparativesDto) => void;
}) {
  const [view, setView] = useState<'account' | 'fsli'>('account');
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const rows = (view === 'account' ? data.accountRows : data.fsliRows).filter((r) => {
    if (filter === 'flagged' && !r.flagged) return false;
    if (filter === 'new' && r.tag !== 'NEW') return false;
    if (filter === 'nil' && r.tag !== 'NIL_THIS_PERIOD') return false;
    if (filter === 'unexplained' && !(r.flagged && !r.explanation)) return false;
    const s = search.trim().toLowerCase();
    return !s || r.code.toLowerCase().includes(s) || r.name.toLowerCase().includes(s);
  });
  const hasComparative = data.totals.comparative !== null;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Comparison</CardTitle>
          <CardDescription>
            {data.entity.functionalCurrency} · debits positive, credits in brackets · flagged when
            the change is at least {Number(data.pctThreshold) * 100}% and at least{' '}
            {data.materiality ? bracketAmount(data.materiality) : '0'} (materiality).
            {data.flagged > 0 && (
              <strong className="ml-1 text-foreground">
                {data.explained} of {data.flagged} flagged variances explained
              </strong>
            )}
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="View">
            {(['account', 'fsli'] as const).map((v) => (
              <Button
                key={v}
                size="sm"
                variant={view === v ? 'default' : 'ghost'}
                onClick={() => setView(v)}
              >
                {v === 'account' ? 'Account view' : 'FSLI view'}
              </Button>
            ))}
          </div>
          <Select
            aria-label="Filter"
            className="w-44"
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
          >
            <option value="all">All</option>
            <option value="flagged">Flagged</option>
            <option value="new">New</option>
            <option value="nil">Nil this period</option>
            <option value="unexplained">Unexplained</option>
          </Select>
          <SearchBox value={search} onChange={setSearch} placeholder="Search code or name" />
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <thead>
            <tr>
              <Th>{view === 'account' ? 'Code' : 'FSLI'}</Th>
              <Th>{view === 'account' ? 'Account name' : 'Name'}</Th>
              {view === 'account' && <Th>FSLI</Th>}
              <Th className="text-right">Current</Th>
              <Th className="text-right">Comparative</Th>
              <Th className="text-right">Variance</Th>
              <Th className="text-right">Variance %</Th>
              <Th>Flag</Th>
              {view === 'account' && <Th>Explanation</Th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={cn(r.flagged && 'bg-amber-50')}>
                <Td className="font-mono text-xs">{r.code}</Td>
                <Td>{r.name}</Td>
                {view === 'account' && (
                  <Td className="text-xs">
                    {r.fsliName ?? <span className="text-warning-foreground">Unmapped</span>}
                  </Td>
                )}
                <Td className="text-right font-mono tabular-nums">{bracketAmount(r.current)}</Td>
                <Td className="text-right font-mono tabular-nums">
                  {r.comparative === null ? '' : bracketAmount(r.comparative)}
                </Td>
                <Td className="text-right font-mono tabular-nums">
                  {r.variance === null ? '' : bracketAmount(r.variance)}
                </Td>
                <Td className="text-right font-mono tabular-nums">
                  {r.variancePct === null ? '' : `${r.variancePct}%`}
                </Td>
                <Td className="whitespace-nowrap">
                  {r.flagged && (
                    <Badge variant="warning">
                      <Flag /> Flagged
                    </Badge>
                  )}
                  {r.tag === 'NEW' && <Badge variant="review">New</Badge>}
                  {r.tag === 'NIL_THIS_PERIOD' && <Badge variant="neutral">Nil this period</Badge>}
                </Td>
                {view === 'account' && (
                  <Td className="min-w-64">
                    {r.flagged && (
                      <Explanation taskId={taskId} data={data} row={r} onSaved={onSaved} />
                    )}
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-medium">
              <Td colSpan={view === 'account' ? 3 : 2}>Total</Td>
              <Td className="text-right">
                <Total value={data.totals.current} nil={data.totals.currentNil} />
              </Td>
              <Td className="text-right">
                {hasComparative && (
                  <Total value={data.totals.comparative!} nil={data.totals.comparativeNil!} />
                )}
              </Td>
              <Td colSpan={view === 'account' ? 4 : 3} />
            </tr>
          </tfoot>
        </Table>
      </CardContent>
    </Card>
  );
}

function Total({ value, nil }: { value: string; nil: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 font-mono tabular-nums">
      {nil ? (
        <CircleCheck className="size-4 text-success" aria-label="Nets to nil" />
      ) : (
        <CircleX className="size-4 text-destructive" />
      )}
      {bracketAmount(value)}
    </span>
  );
}

function Explanation({
  taskId,
  data,
  row,
  onSaved,
}: {
  taskId: string;
  data: EntityComparativesDto;
  row: ComparisonRowDto;
  onSaved: (d: EntityComparativesDto) => void;
}) {
  const [text, setText] = useState(row.explanation?.text ?? '');
  const save = useMutation({
    mutationFn: () =>
      api.put<EntityComparativesDto>(
        `/tasks/${taskId}/entities/${data.entity.code}/comparatives/explanations`,
        {
          accountCode: row.code,
          text,
        },
      ),
    onSuccess: onSaved,
  });
  const changed = text.trim() !== (row.explanation?.text ?? '');
  if (!data.canEdit) return <span className="text-xs">{row.explanation?.text ?? '—'}</span>;
  return (
    <div className="space-y-1">
      <div className="flex gap-1.5">
        <Input
          aria-label={`Explanation for ${row.code}`}
          value={text}
          maxLength={500}
          placeholder="Why did this change?"
          onChange={(e) => setText(e.target.value)}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={!changed || save.isPending}
          onClick={() => save.mutate()}
        >
          Save
        </Button>
      </div>
      {row.explanation && !changed && (
        <p className="text-xs text-muted-foreground">
          {row.explanation.by}, {formatDateTime(row.explanation.at)}
        </p>
      )}
      {save.error && <p className="text-xs text-destructive">{errorMessage(save.error)}</p>}
    </div>
  );
}
