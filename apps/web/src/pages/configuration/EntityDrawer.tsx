import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import {
  ERP_LABELS,
  GAAP_LABELS,
  type CreateEntityRequest,
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
  entity?: EntityDto;
  entities: EntityDto[];
  currencies: CurrencyDto[];
  readOnly: boolean;
  onClose: () => void;
  onSaved: (saved: EntityDto, created: boolean) => void;
}

export function EntityDrawer({ entity, entities, currencies, readOnly, onClose, onSaved }: Props) {
  const creating = !entity;
  const queryClient = useQueryClient();
  const firstCurrency = currencies.find((c) => c.isActive)?.code ?? 'USD';

  const [code, setCode] = useState('');
  const [legalName, setLegalName] = useState(entity?.legalName ?? '');
  const [shortName, setShortName] = useState(entity?.shortName ?? '');
  const [country, setCountry] = useState(entity?.country ?? '');
  const [functional, setFunctional] = useState(entity?.functionalCurrency ?? firstCurrency);
  const [reporting, setReporting] = useState(entity?.reportingCurrency ?? firstCurrency);
  const [translated, setTranslated] = useState<string[]>(entity?.translatedCurrencies ?? []);
  const [parentCode, setParentCode] = useState<string | null>(
    entity ? entity.parentCode : (entities[0]?.code ?? null),
  );
  const [pct, setPct] = useState(entity?.heldByParentPct ?? '100');
  const [erp, setErp] = useState<ErpSystem>(entity?.erp ?? 'ZOHO');
  const [gaap, setGaap] = useState<Gaap>(entity?.gaap ?? 'IFRS');
  const [isActive, setIsActive] = useState(entity?.isActive ?? true);
  const [tbc, setTbc] = useState(entity?.toBeConfirmed ?? false);
  const [tbcNote, setTbcNote] = useState(entity?.toBeConfirmedNote ?? '');
  const [rates, setRates] = useState<RateRow[]>(
    (entity?.historicalRates ?? []).map((r) => ({ ...r, note: r.note ?? '' })),
  );

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
        parentCode,
        heldByParentPct: parentCode ? pct.trim() : null,
        erp,
        gaap,
        isActive,
        toBeConfirmed: tbc,
        toBeConfirmedNote: tbc ? tbcNote : null,
        historicalRates: rates.map((r) => ({
          currency: r.currency,
          rate: r.rate.trim(),
          toBeConfirmed: r.toBeConfirmed,
          note: r.note.trim() || null,
        })),
      };
      return creating
        ? api.post<EntityDto>('/config/entities', { ...body, code } satisfies CreateEntityRequest)
        : api.patch<EntityDto>(`/config/entities/${entity.code}`, body);
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['config'] });
      onSaved(saved, creating);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!readOnly) mutation.mutate();
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
      title={
        creating ? 'Add entity' : `${readOnly ? '' : 'Edit '}${entity.code} — ${entity.shortName}`
      }
      description={readOnly ? 'You can view configuration but not change it.' : undefined}
      footer={
        readOnly ? (
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form="entity-form" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : creating ? 'Create entity' : 'Save changes'}
            </Button>
          </>
        )
      }
    >
      <form id="entity-form" onSubmit={submit} noValidate>
        <fieldset disabled={readOnly} className="space-y-6">
          {mutation.error && <Alert>{errorMessage(mutation.error)}</Alert>}
          {entity?.toBeConfirmed && (
            <Alert variant="info" className="flex items-center gap-2">
              <TbcBadge /> {entity.toBeConfirmedNote}
            </Alert>
          )}

          <section className="grid gap-4 sm:grid-cols-2">
            {creating && (
              <Field
                label="Code"
                htmlFor="e-code"
                hint="2–10 letters or digits. Cannot be changed later."
              >
                <Input
                  id="e-code"
                  className="font-mono uppercase"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoFocus
                />
              </Field>
            )}
            <Field
              label="Short name"
              htmlFor="e-short"
              hint="Used in lists and as the consolidation level name."
            >
              <Input
                id="e-short"
                value={shortName}
                onChange={(e) => setShortName(e.target.value)}
              />
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
              <Field label="Functional currency" htmlFor="e-func">
                <Select
                  id="e-func"
                  value={functional}
                  onChange={(e) => changeFunctional(e.target.value)}
                >
                  {selectable([functional]).map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </Select>
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
            <Field
              label="Translated into"
              hint="Currencies this entity's statements are translated into. The functional currency is excluded."
            >
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
          </section>

          <section className="space-y-4">
            <h3 className="text-sm font-semibold">Group structure</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Parent entity" htmlFor="e-parent">
                <Select
                  id="e-parent"
                  value={parentCode ?? ''}
                  onChange={(e) => setParentCode(e.target.value || null)}
                >
                  <option value="">None — ultimate parent</option>
                  {entities
                    .filter((o) => o.code !== entity?.code)
                    .map((o) => (
                      <option key={o.code} value={o.code}>
                        {o.code} — {o.shortName}
                        {o.isActive ? '' : ' (inactive)'}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field
                label="% held by parent"
                htmlFor="e-pct"
                hint={
                  parentCode ? 'Between 0.01 and 100.' : 'Not applicable to the ultimate parent.'
                }
              >
                <Input
                  id="e-pct"
                  inputMode="decimal"
                  value={parentCode ? pct : ''}
                  disabled={!parentCode}
                  onChange={(e) => setPct(e.target.value)}
                />
              </Field>
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Historical rates for equity</h3>
                <p className="text-xs text-muted-foreground">
                  1 {functional} = rate × target currency. Used later to translate share capital and
                  premium.
                </p>
              </div>
              {!readOnly && (
                <Button type="button" variant="outline" size="sm" onClick={addRate}>
                  <Plus /> Add rate
                </Button>
              )}
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
                        setRates(
                          rates.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)),
                        )
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
                    {!readOnly ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove rate to ${r.currency}`}
                        onClick={() => setRates(rates.filter((_, j) => j !== i))}
                      >
                        <Trash2 />
                      </Button>
                    ) : (
                      <span />
                    )}
                    {r.note && (
                      <p className="col-span-4 -mt-1 text-xs text-muted-foreground">{r.note}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
            {entity && entity.missingHistoricalRates.length > 0 && (
              <div className="space-y-1">
                {entity.missingHistoricalRates.map((m) => (
                  <div key={m.currency}>
                    <WarningText>
                      Missing historical rate to {m.currency} — needed as {m.reasons.join(', ')}.
                    </WarningText>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  Warnings are recalculated when you save.
                </p>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Status</h3>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              Active
            </label>
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
        </fieldset>
      </form>
    </Sheet>
  );
}
