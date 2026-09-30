import { Eye, Pencil, Plus, Power } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ERP_LABELS, GAAP_LABELS, type EntityDto } from '@finance-close/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, Select } from '@/components/ui/form';
import { Table, Td, Th } from '@/components/ui/overlay';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { SearchBox, TbcBadge, WarningText } from './common';
import { ConfigPage, EditButton, EmptyState } from './ConfigPage';
import { ActiveDialog } from './EntityDialogs';
import { EntityDrawer } from './EntityDrawer';
import { matches, useCurrencies, useEntities } from './hooks';

const pct = (v: string | null) =>
  v === null ? '—' : `${Number(v).toLocaleString('en-GB', { maximumFractionDigits: 4 })}%`;

export function EntitiesTab() {
  const entities = useEntities();
  const currencies = useCurrencies();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive' | 'all'>('active');
  const [currency, setCurrency] = useState('');
  const [parent, setParent] = useState('');
  const [editing, setEditing] = useState<EntityDto | null>(null);
  const [activeDialog, setActiveDialog] = useState<EntityDto | null>(null);

  const all = entities.data ?? [];
  const rows = all.filter(
    (e) =>
      (status === 'all' || (status === 'active') === e.isActive) &&
      (!currency || e.functionalCurrency === currency) &&
      (!parent || e.parentCode === parent) &&
      matches(query, e.code, e.shortName, e.legalName, e.country),
  );
  const activeCount = all.filter((e) => e.isActive).length;

  return (
    <ConfigPage
      title="Entities"
      purpose="The companies in the group, their currencies and who owns them."
      count={
        entities.data
          ? `${activeCount} entities${all.length > activeCount ? ` (+${all.length - activeCount} inactive)` : ''}`
          : null
      }
      action={
        <EditButton onClick={() => navigate('/configuration/entities/new')}>
          <Plus /> Add entity
        </EditButton>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={query} onChange={setQuery} placeholder="Search entities" />
        <Select
          aria-label="Status"
          className="w-36"
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All statuses</option>
        </Select>
        <Select
          aria-label="Functional currency"
          className="w-40"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
        >
          <option value="">All currencies</option>
          {[...new Set(all.map((e) => e.functionalCurrency))].sort().map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Parent"
          className="w-48"
          value={parent}
          onChange={(e) => setParent(e.target.value)}
        >
          <option value="">All parents</option>
          {all
            .filter((p) => all.some((e) => e.parentCode === p.code))
            .map((p) => (
              <option key={p.code} value={p.code}>
                {p.code} — {p.shortName}
              </option>
            ))}
        </Select>
      </div>
      {entities.error && <Alert>{errorMessage(entities.error)}</Alert>}
      {!entities.data ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState
          title={all.length === 0 ? 'No entities yet' : 'No entities match'}
          text={
            all.length === 0
              ? 'Add the first entity of the group.'
              : 'Change the search or the filters.'
          }
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Entity</Th>
              <Th>Country</Th>
              <Th>Functional</Th>
              <Th>Translated into</Th>
              <Th>Parent and % held</Th>
              <Th className="text-right">Effective group %</Th>
              <Th>ERP / GAAP</Th>
              <Th>Status</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr
                key={e.code}
                className={e.isActive ? 'hover:bg-muted/30' : 'bg-muted/40 text-muted-foreground'}
              >
                <Td>
                  <Link
                    to={`/configuration/entities/${e.code}`}
                    className="font-semibold text-foreground"
                  >
                    {e.legalName}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    <span className="font-mono">{e.code}</span> · {e.shortName}{' '}
                    {e.toBeConfirmed && <TbcBadge note={e.toBeConfirmedNote} />}
                  </div>
                  {e.missingHistoricalRates.length > 0 && (
                    <WarningText>
                      Missing historical rate:{' '}
                      {e.missingHistoricalRates.map((m) => m.currency).join(', ')}
                    </WarningText>
                  )}
                </Td>
                <Td>{e.country}</Td>
                <Td className="font-mono">{e.functionalCurrency}</Td>
                <Td className="font-mono text-xs">{e.translatedCurrencies.join(', ') || '—'}</Td>
                <Td className="text-sm">
                  {e.parentCode ? (
                    <>
                      {e.parentLegalName}{' '}
                      <span className="whitespace-nowrap text-muted-foreground">
                        · {pct(e.heldByParentPct)}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Ultimate parent</span>
                  )}
                </Td>
                <Td className="text-right tabular-nums">{pct(e.effectiveGroupPct)}</Td>
                <Td className="text-xs">
                  {ERP_LABELS[e.erp]} / {GAAP_LABELS[e.gaap]}
                </Td>
                <Td>
                  {e.isActive ? (
                    <Badge variant="success">Active</Badge>
                  ) : (
                    <Badge variant="secondary">Inactive</Badge>
                  )}
                </Td>
                <Td>
                  <div className="flex justify-end gap-1">
                    <Button asChild variant="ghost" size="sm">
                      <Link to={`/configuration/entities/${e.code}`} className="no-underline">
                        <Eye /> View
                      </Link>
                    </Button>
                    <EditButton
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditing(e)}
                      aria-label={`Edit ${e.code}`}
                    >
                      <Pencil /> Edit
                    </EditButton>
                    <EditButton
                      variant="ghost"
                      size="sm"
                      onClick={() => setActiveDialog(e)}
                      aria-label={`${e.isActive ? 'Deactivate' : 'Reactivate'} ${e.code}`}
                    >
                      <Power /> {e.isActive ? 'Deactivate' : 'Reactivate'}
                    </EditButton>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {editing && currencies.data && (
        <EntityDrawer
          entity={editing}
          currencies={currencies.data}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}
      {activeDialog && <ActiveDialog entity={activeDialog} onClose={() => setActiveDialog(null)} />}
    </ConfigPage>
  );
}
