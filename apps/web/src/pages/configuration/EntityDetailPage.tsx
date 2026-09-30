import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, GitBranch, Pencil, Power } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { ERP_LABELS, GAAP_LABELS, type EntityDetailDto } from '@finance-close/shared';
import { Badge, TaskStatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert } from '@/components/ui/form';
import { Table, Td, Th } from '@/components/ui/overlay';
import { Skeleton } from '@/components/ui/skeleton';
import { api, errorMessage } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { TbcBadge, WarningText } from './common';
import { EditButton } from './ConfigPage';
import { ActiveDialog, OwnershipDialog } from './EntityDialogs';
import { EntityDrawer } from './EntityDrawer';
import { useCurrencies, useEntities } from './hooks';

const TABS = [
  'Overview',
  'Currencies and historical rates',
  'Ownership history',
  'Chart of accounts',
  'Tasks and reports',
  'Change history',
] as const;
type Tab = (typeof TABS)[number];

export function EntityDetailPage() {
  const { code = '' } = useParams();
  const q = useQuery({
    queryKey: ['config', 'entity-detail', code],
    queryFn: () => api.get<EntityDetailDto>(`/config/entities/${code}/detail`),
  });
  const entities = useEntities();
  const currencies = useCurrencies();
  const [tab, setTab] = useState<Tab>('Overview');
  const [dialog, setDialog] = useState<'edit' | 'ownership' | 'active' | null>(null);

  if (q.error) return <Alert>{errorMessage(q.error)}</Alert>;
  if (!q.data) return <Skeleton className="h-96 w-full" />;
  const d = q.data;
  const e = d.entity;

  return (
    <section className="space-y-4" aria-label={e.legalName}>
      <Button asChild variant="ghost" size="sm">
        <Link to="/configuration/entities" className="no-underline">
          <ArrowLeft /> Entities
        </Link>
      </Button>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            {e.legalName}{' '}
            {e.isActive ? (
              <Badge variant="success">Active</Badge>
            ) : (
              <Badge variant="secondary">Inactive</Badge>
            )}
            {e.toBeConfirmed && <TbcBadge note={e.toBeConfirmedNote} />}
          </h2>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">{e.code}</span> · {e.shortName} · {e.country} ·{' '}
            {e.functionalCurrency}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <EditButton variant="outline" onClick={() => setDialog('edit')}>
            <Pencil /> Edit
          </EditButton>
          <EditButton variant="outline" onClick={() => setDialog('ownership')}>
            <GitBranch /> Change ownership
          </EditButton>
          <EditButton
            variant="outline"
            onClick={() => setDialog('active')}
            disabled={e.isActive && d.deactivateBlockedReason !== null}
            title={e.isActive ? (d.deactivateBlockedReason ?? undefined) : undefined}
          >
            <Power /> {e.isActive ? 'Deactivate' : 'Reactivate'}
          </EditButton>
        </div>
      </header>
      {e.isActive && d.deactivateBlockedReason && (
        <p className="text-xs text-muted-foreground">
          Cannot be deactivated now: {d.deactivateBlockedReason}
        </p>
      )}

      <div role="tablist" aria-label="Entity" className="flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={t === tab}
            onClick={() => setTab(t)}
            className={cn(
              '-mb-px border-b-2 border-transparent px-3 py-2 text-sm',
              t === tab
                ? 'border-primary font-medium'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <Card>
        <CardContent>
          {tab === 'Overview' && (
            <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <Item label="Legal name">{e.legalName}</Item>
              <Item label="Code / short name">
                {e.code} / {e.shortName}
              </Item>
              <Item label="Country">{e.country}</Item>
              <Item label="ERP / GAAP">
                {ERP_LABELS[e.erp]} / {GAAP_LABELS[e.gaap]}
              </Item>
              <Item label="Incorporated / acquired">
                {e.incorporatedOn ? formatDate(e.incorporatedOn) : '—'}
              </Item>
              <Item label="Parent and % held">
                {e.parentCode ? `${e.parentLegalName} · ${e.heldByParentPct}%` : 'Ultimate parent'}
              </Item>
              <Item label="Effective group %">
                {e.effectiveGroupPct ? `${e.effectiveGroupPct}%` : '—'}
              </Item>
              <Item label="Consolidation levels">
                {d.levels.map((l) => `L${l.level} ${l.name} (${l.currency})`).join(', ') || '—'}
              </Item>
              <Item label="Materiality">
                {e.materiality ? `${e.materiality} ${e.functionalCurrency}` : '—'}
              </Item>
            </dl>
          )}

          {tab === 'Currencies and historical rates' && (
            <div className="space-y-3 text-sm">
              <p>
                Functional <strong>{e.functionalCurrency}</strong>
                {e.functionalCurrencyLocked && (
                  <span className="text-muted-foreground">
                    {' '}
                    (fixed: {e.functionalCurrencyLockReason})
                  </span>
                )}{' '}
                · reporting <strong>{e.reportingCurrency}</strong> · translated into{' '}
                <strong>{e.translatedCurrencies.join(', ') || '—'}</strong>
              </p>
              <Table>
                <thead>
                  <tr>
                    <Th>Currency</Th>
                    <Th className="text-right">1 {e.functionalCurrency} =</Th>
                    <Th>Date / source</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {e.historicalRates.map((r) => (
                    <tr key={r.currency}>
                      <Td className="font-mono">{r.currency}</Td>
                      <Td className="text-right font-mono">{r.rate}</Td>
                      <Td className="text-xs">{r.note ?? '—'}</Td>
                      <Td>
                        {r.toBeConfirmed ? (
                          <Badge variant="warning">To be confirmed</Badge>
                        ) : (
                          <Badge variant="success">Confirmed</Badge>
                        )}
                      </Td>
                    </tr>
                  ))}
                  {e.missingHistoricalRates.map((m) => (
                    <tr key={m.currency}>
                      <Td className="font-mono">{m.currency}</Td>
                      <Td colSpan={3}>
                        <WarningText>Missing — needed as {m.reasons.join(', ')}.</WarningText>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}

          {tab === 'Ownership history' && (
            <Table>
              <thead>
                <tr>
                  <Th>Effective from</Th>
                  <Th>Parent</Th>
                  <Th className="text-right">% held</Th>
                  <Th>Reason</Th>
                  <Th>Recorded</Th>
                </tr>
              </thead>
              <tbody>
                {d.ownership.map((o) => (
                  <tr key={o.id} className={o.current ? 'bg-mint/40' : undefined}>
                    <Td className="whitespace-nowrap">
                      {o.effectiveFrom.slice(0, 7)}{' '}
                      {o.current && <Badge variant="success">In force</Badge>}
                    </Td>
                    <Td>{o.parentLegalName ?? 'Ultimate parent'}</Td>
                    <Td className="text-right tabular-nums">
                      {o.heldByParentPct ? `${o.heldByParentPct}%` : '—'}
                    </Td>
                    <Td className="text-xs">{o.reason}</Td>
                    <Td className="text-xs">
                      {o.by ?? 'Seed'}, {formatDateTime(o.at)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}

          {tab === 'Chart of accounts' && (
            <p className="text-sm">
              {d.chartOfAccounts.accounts} accounts · {d.chartOfAccounts.mapped} mapped (
              {d.chartOfAccounts.mappedPct}%).{' '}
              <Link to="/configuration/chart-of-accounts">Open the chart of accounts</Link>
            </p>
          )}

          {tab === 'Tasks and reports' &&
            (d.tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tasks include this entity.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Task</Th>
                    <Th>Type</Th>
                    <Th>Period</Th>
                    <Th>Task status</Th>
                    <Th>This entity</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.tasks.map((t) => (
                    <tr key={t.id}>
                      <Td>
                        <Link to={`/tasks/${t.id}`}>{t.number}</Link>
                      </Td>
                      <Td>{t.type}</Td>
                      <Td>{t.periodLabel}</Td>
                      <Td>
                        <TaskStatusBadge status={t.status as never} />
                      </Td>
                      <Td className="text-xs">{t.itemStatus.replace('_', ' ').toLowerCase()}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ))}

          {tab === 'Change history' &&
            (d.history.length === 0 ? (
              <p className="text-sm text-muted-foreground">No changes recorded.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>When</Th>
                    <Th>Who</Th>
                    <Th>What</Th>
                    <Th>Before → after</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.history.map((h) => (
                    <tr key={h.id}>
                      <Td className="text-xs whitespace-nowrap">{formatDateTime(h.timestamp)}</Td>
                      <Td className="text-xs">{h.user ?? 'System'}</Td>
                      <Td className="text-xs">{h.action.replaceAll('_', ' ').toLowerCase()}</Td>
                      <Td className="max-w-xl font-mono text-[11px] break-all">
                        {h.oldValue ? JSON.stringify(h.oldValue) : '—'} →{' '}
                        {h.newValue ? JSON.stringify(h.newValue) : '—'}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ))}
        </CardContent>
      </Card>

      {dialog === 'edit' && currencies.data && (
        <EntityDrawer
          entity={e}
          currencies={currencies.data}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            void q.refetch();
          }}
        />
      )}
      {dialog === 'ownership' && (
        <OwnershipDialog
          entity={e}
          entities={entities.data ?? []}
          onClose={() => setDialog(null)}
          onSaved={() => void q.refetch()}
        />
      )}
      {dialog === 'active' && (
        <ActiveDialog
          entity={e}
          onClose={() => {
            setDialog(null);
            void q.refetch();
          }}
        />
      )}
    </section>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
