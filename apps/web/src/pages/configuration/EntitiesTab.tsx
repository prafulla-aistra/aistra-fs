import { Eye, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { ERP_LABELS, GAAP_LABELS, type EntityDto } from '@finance-close/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/form';
import { Table, Td, Th } from '@/components/ui/overlay';
import { errorMessage } from '@/lib/api';
import { SearchBox, TbcBadge, WarningText } from './common';
import { matches, useCanEditConfig, useCurrencies, useEntities } from './hooks';
import { EntityDrawer } from './EntityDrawer';

export function EntitiesTab() {
  const canEdit = useCanEditConfig();
  const entities = useEntities();
  const currencies = useCurrencies();
  const [query, setQuery] = useState('');
  const [drawer, setDrawer] = useState<{ entity?: EntityDto } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const rows = (entities.data ?? []).filter((e) =>
    matches(query, e.code, e.shortName, e.legalName, e.country, e.functionalCurrency, e.parentCode),
  );
  const withWarnings = (entities.data ?? []).filter((e) => e.missingHistoricalRates.length > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchBox value={query} onChange={setQuery} placeholder="Search entities" />
        {canEdit && (
          <Button onClick={() => setDrawer({})} disabled={!entities.data || !currencies.data}>
            <Plus /> Add entity
          </Button>
        )}
      </div>
      {notice && <Alert variant="success">{notice}</Alert>}
      {(entities.error || currencies.error) && (
        <Alert>{errorMessage(entities.error ?? currencies.error)}</Alert>
      )}
      {withWarnings.length > 0 && (
        <Alert variant="info">
          <WarningText>
            Missing historical rates for {withWarnings.map((e) => e.code).join(', ')}. Share capital
            and premium cannot be translated for those currencies until the rates are added.
          </WarningText>
        </Alert>
      )}

      <Table>
        <thead>
          <tr>
            <Th>Code</Th>
            <Th>Entity</Th>
            <Th>Country</Th>
            <Th>Currency</Th>
            <Th>Translated into</Th>
            <Th>Parent</Th>
            <Th>ERP / GAAP</Th>
            <Th>Status</Th>
            <Th className="text-right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {entities.isPending && (
            <tr>
              <Td colSpan={9} className="text-muted-foreground">
                Loading entities…
              </Td>
            </tr>
          )}
          {rows.map((e) => (
            <tr key={e.code} className="align-top hover:bg-muted/30">
              <Td className="font-mono font-medium">{e.code}</Td>
              <Td>
                <div className="font-medium">{e.shortName}</div>
                <div className="text-xs text-muted-foreground">{e.legalName}</div>
              </Td>
              <Td>{e.country}</Td>
              <Td className="font-mono text-xs">
                {e.functionalCurrency}
                {e.reportingCurrency !== e.functionalCurrency && (
                  <div className="text-muted-foreground">reports in {e.reportingCurrency}</div>
                )}
              </Td>
              <Td className="font-mono text-xs">{e.translatedCurrencies.join(', ') || '—'}</Td>
              <Td>
                {e.parentCode ? (
                  <>
                    <span className="font-mono">{e.parentCode}</span>
                    <span className="text-muted-foreground"> · {e.heldByParentPct}%</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">Ultimate parent</span>
                )}
              </Td>
              <Td className="text-xs">
                {ERP_LABELS[e.erp]}
                <div className="text-muted-foreground">{GAAP_LABELS[e.gaap]}</div>
              </Td>
              <Td>
                <div className="flex flex-col items-start gap-1">
                  {e.isActive ? (
                    <Badge variant="success">Active</Badge>
                  ) : (
                    <Badge variant="secondary">Inactive</Badge>
                  )}
                  {e.toBeConfirmed && <TbcBadge note={e.toBeConfirmedNote} />}
                  {e.missingHistoricalRates.length > 0 && (
                    <WarningText>
                      Missing rate: {e.missingHistoricalRates.map((m) => m.currency).join(', ')}
                    </WarningText>
                  )}
                </div>
              </Td>
              <Td className="text-right">
                <Button variant="ghost" size="sm" onClick={() => setDrawer({ entity: e })}>
                  {canEdit ? (
                    <>
                      <Pencil /> Edit
                    </>
                  ) : (
                    <>
                      <Eye /> View
                    </>
                  )}
                </Button>
              </Td>
            </tr>
          ))}
          {entities.data && rows.length === 0 && (
            <tr>
              <Td colSpan={9} className="text-muted-foreground">
                No entities match “{query}”.
              </Td>
            </tr>
          )}
        </tbody>
      </Table>

      {drawer && entities.data && currencies.data && (
        <EntityDrawer
          entity={drawer.entity}
          entities={entities.data}
          currencies={currencies.data}
          readOnly={!canEdit}
          onClose={() => setDrawer(null)}
          onSaved={(saved, created) => {
            setDrawer(null);
            setNotice(`${created ? 'Created' : 'Saved'} ${saved.code} — ${saved.shortName}.`);
          }}
        />
      )}
    </div>
  );
}
