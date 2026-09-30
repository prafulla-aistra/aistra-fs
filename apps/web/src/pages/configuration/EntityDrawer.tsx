import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import {
  ERP_LABELS,
  GAAP_LABELS,
  type CurrencyDto,
  type EntityDto,
  type EntityInput,
  type ErpSystem,
  type Gaap,
} from '@finance-close/shared';
import { Button } from '@/components/ui/button';
import { Alert, Checkbox, Field, Input, Select } from '@/components/ui/form';
import { Sheet } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import { TbcBadge, WarningText } from './common';

interface RateRow {
  currency: string;
  rate: string;
  toBeConfirmed: boolean;
  note: string;
}

interface Props {
  entity: EntityDto;
  currencies: CurrencyDto[];
  onClose: () => void;
  onSaved: (saved: EntityDto) => void;
}

/**
 * Edit an entity. The code never changes; the parent and % held change through "Change
 * ownership" (a new ownership row); the active flag through Deactivate / Reactivate.
 * A currency change needs a reason; the functional currency is fixed once reports are final.
 */
export function EntityDrawer({ entity, currencies, onClose, onSaved }: Props) {
  const queryClient = useQueryClient();
  const [legalName, setLegalName] = useState(entity.legalName);
  const [shortName, setShortName] = useState(entity.shortName);
  const [country, setCountry] = useState(entity.country);
  const [functional, setFunctional] = useState(entity.functionalCurrency);
  const [reporting, setReporting] = useState(entity.reportingCurrency);
  const [translated, setTranslated] = useState<string[]>(entity.translatedCurrencies);
  const [materiality, setMateriality] = useState(entity.materiality ?? '');
  const [incorporatedOn, setIncorporatedOn] = useState(entity.incorporatedOn ?? '');
  const [erp, setErp] = useState<ErpSystem>(entity.erp);
  const [gaap, setGaap] = useState<Gaap>(entity.gaap);
  const [tbc, setTbc] = useState(entity.toBeConfirmed);
  const [tbcNote, setTbcNote] = useState(entity.toBeConfirmedNote ?? '');
  const [reason, setReason] = useState('');
  const [rates, setRates] = useState<RateRow[]>(
    entity.historicalRates.map((r) => ({ ...r, note: r.note ?? '' })),
  );

  const currencyChanged =
    functional !== entity.functionalCurrency ||
    reporting !== entity.reportingCurrency ||
    [...translated].sort().join(',') !== [...entity.translatedCurrencies].sort().join(',');

  // Currencies you may pick: active ones, plus any inactive one already in use here.
  const selectable = (current: string[]) =>
    currencies.filter((c) => c.isActive || current.includes(c.code));

  const changeFunctional = (ccy: string) => {
    setFunctional(ccy);
    setTranslated((t) => t.filter((c) => c !== ccy)); // translated must exclude functional
    if (reporting === functional) setReporting(ccy);
  };

  const mutation = useMutation({
    mutationFn: async (): Promise<EntityDto> => {
      const body: EntityInput = {
        legalName,
        shortName,
        country,
        functionalCurrency: functional,
        reportingCurrency: reporting,
        translatedCurrencies: translated,
        parentCode: entity.parentCode,
        heldByParentPct: entity.heldByParentPct,
        materiality: materiality.trim().replace(/,/g, '') || null,
        incorporatedOn: incorporatedOn || null,
        reason: currencyChanged ? reason.trim() : null,
        erp,
        gaap,
        isActive: entity.isActive,
        toBeConfirmed: tbc,
        toBeConfirmedNote: tbc ? tbcNote : null,
        historicalRates: rates.map((r) => ({
          currency: r.currency,
          rate: r.rate.trim(),
          toBeConfirmed: r.toBeConfirmed,
          note: r.note.trim() || null,
        })),
      };
      return api.patch<EntityDto>(`/config/entities/${entity.code}`, body);
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['config'] });
      onSaved(saved);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate();
  };

  const rateCurrencies = rates.map((r) => r.currency);
  const addRate = () => {
    const next = currencies.find(
      (c) => c.isActive && c.code !== functional && !rateCurrencies.includes(c.code),
    );
    if (next)
      setRates([...rates, { currency: next.code, rate: '', toBeConfirmed: true, note: '' }]);
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Edit ${entity.code} — ${entity.shortName}`}
      description="The code cannot change. Parent and % held change with “Change ownership” on the entity page."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="entity-form"
            disabled={mutation.isPending || (currencyChanged && reason.trim().length < 3)}
          >
            {mutation.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      }
    >
      <form id="entity-form" onSubmit={submit} noValidate className="space-y-6">
        {mutation.error && <Alert>{errorMessage(mutation.error)}</Alert>}
        {entity.toBeConfirmed && (
          <Alert variant="info" className="flex items-center gap-2">
            <TbcBadge /> {entity.toBeConfirmedNote}
          </Alert>
        )}

        <section className="grid gap-4 sm:grid-cols-2">
          <Field label="Code" hint="Cannot be changed.">
            <Input value={entity.code} disabled className="font-mono" />
          </Field>
          <Field
            label="Short name"
            htmlFor="e-short"
            hint="Used in lists and as the consolidation level name."
          >
            <Input id="e-short" value={shortName} onChange={(e) => setShortName(e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Legal name" htmlFor="e-legal">
              <Input
                id="e-legal"
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Country" htmlFor="e-country">
            <Input id="e-country" value={country} onChange={(e) => setCountry(e.target.value)} />
          </Field>
          <Field label="Date of incorporation or acquisition" htmlFor="e-inc">
            <Input
              id="e-inc"
              type="date"
              value={incorporatedOn}
              onChange={(e) => setIncorporatedOn(e.target.value)}
            />
          </Field>
          <Field label="ERP" htmlFor="e-erp">
            <Select id="e-erp" value={erp} onChange={(e) => setErp(e.target.value as ErpSystem)}>
              {Object.entries(ERP_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Accounting framework (GAAP)" htmlFor="e-gaap">
            <Select id="e-gaap" value={gaap} onChange={(e) => setGaap(e.target.value as Gaap)}>
              {Object.entries(GAAP_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
        </section>

        <section className="space-y-4">
          <h3 className="text-sm font-semibold">Currencies</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Functional currency"
              htmlFor="e-func"
              hint={
                entity.functionalCurrencyLocked
                  ? undefined
                  : 'Cannot change once the entity has a finalised report.'
              }
            >
              <Select
                id="e-func"
                value={functional}
                disabled={entity.functionalCurrencyLocked}
                onChange={(e) => changeFunctional(e.target.value)}
              >
                {selectable([functional]).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </Select>
              {entity.functionalCurrencyLocked && (
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Lock className="size-3" /> Fixed: {entity.functionalCurrencyLockReason}
                </p>
              )}
            </Field>
            <Field
              label="Reporting currency"
              htmlFor="e-rep"
              hint="Default currency of a consolidation level this entity heads."
            >
              <Select id="e-rep" value={reporting} onChange={(e) => setReporting(e.target.value)}>
                {selectable([reporting]).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Translated into" hint="The functional currency is excluded.">
            <div className="flex flex-wrap gap-x-5 gap-y-2 rounded-md border p-3">
              {selectable(translated)
                .filter((c) => c.code !== functional)
                .map((c) => (
                  <label key={c.code} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={translated.includes(c.code)}
                      onChange={(e) =>
                        setTranslated(
                          e.target.checked
                            ? [...translated, c.code].sort()
                            : translated.filter((x) => x !== c.code),
                        )
                      }
                    />
                    <span className="font-mono">{c.code}</span>
                  </label>
                ))}
            </div>
          </Field>
          <Field
            label={`Materiality (${functional})`}
            htmlFor="e-materiality"
            hint="Variances below this amount are not flagged on the comparatives step."
          >
            <Input
              id="e-materiality"
              inputMode="decimal"
              value={materiality}
              onChange={(e) => setMateriality(e.target.value)}
            />
          </Field>
          {currencyChanged && (
            <Field label="Reason for the currency change (required)" htmlFor="e-reason">
              <Input
                id="e-reason"
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Ownership</h3>
          <p className="rounded-md border bg-muted/40 p-3 text-sm">
            {entity.parentCode ? (
              <>
                {entity.heldByParentPct}% held by <strong>{entity.parentLegalName}</strong>
                {entity.ownershipEffectiveFrom && (
                  <> · from {entity.ownershipEffectiveFrom.slice(0, 7)}</>
                )}
              </>
            ) : (
              'Ultimate parent'
            )}
            <span className="mt-1 block text-xs text-muted-foreground">
              To change the parent or % held, use “Change ownership” on the entity page — the
              history is kept.
            </span>
          </p>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">Historical rates for equity</h3>
              <p className="text-xs text-muted-foreground">
                1 {functional} = rate × target currency (share capital and premium).
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={addRate}>
              <Plus /> Add rate
            </Button>
          </div>
          {rates.length === 0 ? (
            <p className="rounded-md border p-3 text-sm text-muted-foreground">
              No historical rates.
            </p>
          ) : (
            <div className="space-y-2 rounded-md border p-3">
              {rates.map((r, i) => (
                <div key={i} className="grid grid-cols-[6rem_1fr_auto_auto] items-center gap-2">
                  <Select
                    aria-label="Target currency"
                    value={r.currency}
                    onChange={(e) =>
                      setRates(
                        rates.map((x, j) => (j === i ? { ...x, currency: e.target.value } : x)),
                      )
                    }
                  >
                    {selectable([r.currency])
                      .filter(
                        (c) =>
                          c.code !== functional &&
                          (c.code === r.currency || !rateCurrencies.includes(c.code)),
                      )
                      .map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code}
                        </option>
                      ))}
                  </Select>
                  <Input
                    aria-label={`Rate to ${r.currency}`}
                    inputMode="decimal"
                    className="font-mono"
                    placeholder="e.g. 0.0133333333"
                    value={r.rate}
                    onChange={(e) =>
                      setRates(rates.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))
                    }
                  />
                  <label className="flex items-center gap-1.5 text-xs whitespace-nowrap">
                    <Checkbox
                      checked={r.toBeConfirmed}
                      onChange={(e) =>
                        setRates(
                          rates.map((x, j) =>
                            j === i ? { ...x, toBeConfirmed: e.target.checked } : x,
                          ),
                        )
                      }
                    />
                    To be confirmed
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove rate to ${r.currency}`}
                    onClick={() => setRates(rates.filter((_, j) => j !== i))}
                  >
                    <Trash2 />
                  </Button>
                  <Input
                    aria-label={`Date or source of the rate to ${r.currency}`}
                    className="col-span-4 h-8 text-xs"
                    placeholder="Date / source, e.g. share issue 12 May 2021"
                    value={r.note}
                    onChange={(e) =>
                      setRates(rates.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))
                    }
                  />
                </div>
              ))}
            </div>
          )}
          {entity.missingHistoricalRates.length > 0 && (
            <div className="space-y-1">
              {entity.missingHistoricalRates.map((m) => (
                <div key={m.currency}>
                  <WarningText>
                    Missing historical rate to {m.currency} — needed as {m.reasons.join(', ')}.
                  </WarningText>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">To be confirmed</h3>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={tbc} onChange={(e) => setTbc(e.target.checked)} />
            Some details are still to be confirmed
          </label>
          {tbc && (
            <Field label="What is to be confirmed?" htmlFor="e-tbc">
              <Input id="e-tbc" value={tbcNote} onChange={(e) => setTbcNote(e.target.value)} />
            </Field>
          )}
        </section>
      </form>
    </Sheet>
  );
}
