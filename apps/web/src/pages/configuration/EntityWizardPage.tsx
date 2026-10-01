import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Check, CircleX } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  type GroupStructureDto,
  ERP_LABELS,
  GAAP_LABELS,
  type CreateEntityRequest,
  type EntityDto,
  type EntityPreviewDto,
  type ErpSystem,
  type Gaap,
} from '@finance-close/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, Checkbox, Field, Input, Select } from '@/components/ui/form';
import { api, errorMessage } from '@/lib/api';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { ConfigPage } from './ConfigPage';
import { useCanEditConfig, useCurrencies, useEntities } from './hooks';

const STEPS = ['Basics', 'Currencies', 'Ownership', 'Historical rates', 'Review'] as const;
const thisMonth = () => new Date().toISOString().slice(0, 7);

interface RateDraft {
  rate: string;
  note: string;
}

/** Add entity: four steps with validation, then a review. */
export function EntityWizardPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canEdit = useCanEditConfig();
  const entities = useEntities();
  const currencies = useCurrencies();
  const [step, setStep] = useState(0);
  const [f, setF] = useState({
    legalName: '',
    shortName: '',
    code: '',
    country: '',
    erp: 'ZOHO' as ErpSystem,
    gaap: 'IFRS' as Gaap,
    incorporatedOn: '',
    functionalCurrency: 'USD',
    reportingCurrency: 'USD',
    translatedCurrencies: [] as string[],
    materiality: '',
    parentCode: '' as string,
    heldByParentPct: '100',
    month: thisMonth(),
  });
  const [rates, setRates] = useState<Record<string, RateDraft>>({});
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  // The ownership month defaults to the server's current month (its clock, not the browser's).
  const structure = useQuery({
    queryKey: ['config', 'group-structure', ''],
    queryFn: () => api.get<GroupStructureDto>('/config/group-structure'),
  });
  const monthTouched = useRef(false);
  useEffect(() => {
    const m = structure.data?.asAt?.slice(0, 7);
    if (m && !monthTouched.current) setF((x) => ({ ...x, month: m }));
  }, [structure.data?.asAt]);

  useEffect(() => {
    if (!f.parentCode && entities.data) {
      const root = entities.data.find((e) => e.isActive && e.parentCode === null);
      if (root) setF((x) => ({ ...x, parentCode: root.code }));
    }
  }, [entities.data, f.parentCode]);

  const preview = useQuery({
    queryKey: [
      'entity-preview',
      f.code,
      f.functionalCurrency,
      f.reportingCurrency,
      f.translatedCurrencies,
      f.parentCode,
      f.heldByParentPct,
      f.month,
    ],
    queryFn: () =>
      api.post<EntityPreviewDto>('/config/entity-preview', {
        code: f.code,
        functionalCurrency: f.functionalCurrency,
        reportingCurrency: f.reportingCurrency,
        translatedCurrencies: f.translatedCurrencies,
        parentCode: f.parentCode || null,
        heldByParentPct: f.parentCode ? f.heldByParentPct : null,
        effectiveFrom: `${f.month}-01`,
      }),
    enabled: step >= 2,
  });

  const create = useMutation({
    mutationFn: () => {
      const body: CreateEntityRequest = {
        code: f.code.trim().toUpperCase(),
        legalName: f.legalName,
        shortName: f.shortName,
        country: f.country,
        functionalCurrency: f.functionalCurrency,
        reportingCurrency: f.reportingCurrency,
        translatedCurrencies: f.translatedCurrencies,
        parentCode: f.parentCode || null,
        heldByParentPct: f.parentCode ? f.heldByParentPct.trim() : null,
        materiality: f.materiality.trim().replace(/,/g, '') || null,
        incorporatedOn: f.incorporatedOn || null,
        ownershipEffectiveFrom: `${f.month}-01`,
        erp: f.erp,
        gaap: f.gaap,
        isActive: true,
        toBeConfirmed: false,
        toBeConfirmedNote: null,
        historicalRates: Object.entries(rates)
          .filter(([, r]) => r.rate.trim())
          .map(([currency, r]) => ({
            currency,
            rate: r.rate.trim(),
            toBeConfirmed: true,
            note: r.note.trim() || null,
          })),
      };
      return api.post<EntityDto>('/config/entities', body);
    },
    onSuccess: async (e) => {
      toast(`${e.code} — ${e.legalName} added.`);
      await qc.invalidateQueries({ queryKey: ['config'] });
      navigate(`/configuration/entities/${e.code}`);
    },
  });

  const problems: string[][] = [
    [
      !f.legalName.trim() && 'Enter the legal name.',
      !f.shortName.trim() && 'Enter a short name.',
      !/^[A-Z]{2,4}$/.test(f.code.trim().toUpperCase()) && 'The code is 2–4 capital letters.',
      entities.data?.some((e) => e.code === f.code.trim().toUpperCase()) &&
        `Code ${f.code.toUpperCase()} is already used.`,
      !f.country.trim() && 'Enter the country.',
    ].filter(Boolean) as string[],
    [
      f.translatedCurrencies.includes(f.functionalCurrency) &&
        'Translated currencies exclude the functional currency.',
      f.materiality &&
        !/^\d{1,16}(\.\d{1,4})?$/.test(f.materiality.replace(/,/g, '')) &&
        'Materiality must be an amount.',
    ].filter(Boolean) as string[],
    [
      f.parentCode &&
        !/^\d{1,3}(\.\d{1,4})?$/.test(f.heldByParentPct.trim()) &&
        '% held must be a number between 0.01 and 100.',
      !/^\d{4}-\d{2}$/.test(f.month) && 'Choose the month the ownership applies from.',
      ...(preview.data?.issues.map((i) => i.message) ?? []),
    ].filter(Boolean) as string[],
    Object.entries(rates)
      .filter(([, r]) => r.rate.trim() && !/^\d{1,10}(\.\d{1,10})?$/.test(r.rate.trim()))
      .map(([c]) => `The ${c} rate must be a positive number (at most 10 decimals).`),
    [],
  ];
  const active = (currencies.data ?? []).filter((c) => c.isActive);
  const required = preview.data?.requiredHistoricalRates ?? [];
  const missing = required.filter((r) => !rates[r.currency]?.rate.trim());

  if (!canEdit)
    return (
      <ConfigPage title="Add entity" purpose="Needs configuration access – ask your administrator.">
        <Button asChild variant="outline">
          <Link to="/configuration/entities">Back to entities</Link>
        </Button>
      </ConfigPage>
    );

  return (
    <ConfigPage
      title="Add entity"
      purpose="Four steps, then a final review. Nothing is saved until you confirm."
    >
      <ol className="flex flex-wrap gap-2" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              disabled={i > step}
              onClick={() => setStep(i)}
              aria-current={i === step ? 'step' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-full border px-3 py-1 text-sm',
                i === step
                  ? 'border-primary bg-primary text-primary-foreground'
                  : i < step
                    ? 'bg-mint'
                    : 'bg-card text-muted-foreground',
              )}
            >
              {i < step ? <Check className="size-3.5" /> : <span className="text-xs">{i + 1}</span>}
              {s}
            </button>
          </li>
        ))}
      </ol>

      <Card>
        <CardContent className="space-y-4">
          {step === 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label="Legal name" htmlFor="w-legal">
                  <Input
                    id="w-legal"
                    value={f.legalName}
                    onChange={(e) => set('legalName', e.target.value)}
                    autoFocus
                  />
                </Field>
              </div>
              <Field
                label="Short name"
                htmlFor="w-short"
                hint="Used in lists and as a consolidation level name."
              >
                <Input
                  id="w-short"
                  value={f.shortName}
                  onChange={(e) => set('shortName', e.target.value)}
                />
              </Field>
              <Field
                label="Code"
                htmlFor="w-code"
                hint="2–4 capital letters, unique. Cannot change later."
              >
                <Input
                  id="w-code"
                  className="font-mono uppercase"
                  maxLength={4}
                  value={f.code}
                  onChange={(e) => set('code', e.target.value.toUpperCase())}
                />
              </Field>
              <Field label="Country" htmlFor="w-country">
                <Input
                  id="w-country"
                  value={f.country}
                  onChange={(e) => set('country', e.target.value)}
                />
              </Field>
              <Field label="Date of incorporation or acquisition" htmlFor="w-inc">
                <Input
                  id="w-inc"
                  type="date"
                  value={f.incorporatedOn}
                  onChange={(e) => set('incorporatedOn', e.target.value)}
                />
              </Field>
              <Field label="ERP" htmlFor="w-erp">
                <Select
                  id="w-erp"
                  value={f.erp}
                  onChange={(e) => set('erp', e.target.value as ErpSystem)}
                >
                  {Object.entries(ERP_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Accounting framework (GAAP)" htmlFor="w-gaap">
                <Select
                  id="w-gaap"
                  value={f.gaap}
                  onChange={(e) => set('gaap', e.target.value as Gaap)}
                >
                  {Object.entries(GAAP_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}

          {step === 1 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Functional currency" htmlFor="w-func">
                <Select
                  id="w-func"
                  value={f.functionalCurrency}
                  onChange={(e) => {
                    const c = e.target.value;
                    setF((x) => ({
                      ...x,
                      functionalCurrency: c,
                      reportingCurrency:
                        x.reportingCurrency === x.functionalCurrency ? c : x.reportingCurrency,
                      translatedCurrencies: x.translatedCurrencies.filter((t) => t !== c),
                    }));
                  }}
                >
                  {active.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Reporting currency" htmlFor="w-rep">
                <Select
                  id="w-rep"
                  value={f.reportingCurrency}
                  onChange={(e) => set('reportingCurrency', e.target.value)}
                >
                  {active.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="sm:col-span-2">
                <Field
                  label="Translated into"
                  hint="Currencies the statements are translated into (not the functional currency)."
                >
                  <div className="flex flex-wrap gap-x-5 gap-y-2 rounded-md border p-3">
                    {active
                      .filter((c) => c.code !== f.functionalCurrency)
                      .map((c) => (
                        <label key={c.code} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={f.translatedCurrencies.includes(c.code)}
                            onChange={(e) =>
                              set(
                                'translatedCurrencies',
                                e.target.checked
                                  ? [...f.translatedCurrencies, c.code].sort()
                                  : f.translatedCurrencies.filter((x) => x !== c.code),
                              )
                            }
                          />
                          <span className="font-mono">{c.code}</span>
                        </label>
                      ))}
                  </div>
                </Field>
              </div>
              <Field
                label={`Materiality (${f.functionalCurrency})`}
                htmlFor="w-mat"
                hint="Variances below this are not flagged on the comparatives step."
              >
                <Input
                  id="w-mat"
                  inputMode="decimal"
                  value={f.materiality}
                  onChange={(e) => set('materiality', e.target.value)}
                />
              </Field>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Parent entity" htmlFor="w-parent">
                  <Select
                    id="w-parent"
                    value={f.parentCode}
                    onChange={(e) => set('parentCode', e.target.value)}
                  >
                    <option value="">None — ultimate parent</option>
                    {(entities.data ?? [])
                      .filter((e) => e.isActive)
                      .map((e) => (
                        <option key={e.code} value={e.code}>
                          {e.code} — {e.legalName}
                        </option>
                      ))}
                  </Select>
                </Field>
                <Field label="% held by parent" htmlFor="w-pct" hint="Between 0.01 and 100.">
                  <Input
                    id="w-pct"
                    inputMode="decimal"
                    value={f.parentCode ? f.heldByParentPct : ''}
                    disabled={!f.parentCode}
                    onChange={(e) => set('heldByParentPct', e.target.value)}
                  />
                </Field>
                <Field label="Effective from (month)" htmlFor="w-month">
                  <Input
                    id="w-month"
                    type="month"
                    value={f.month}
                    onChange={(e) => {
                      monthTouched.current = true;
                      set('month', e.target.value);
                    }}
                  />
                </Field>
              </div>
              <Preview preview={preview.data} loading={preview.isFetching} code={f.code || 'NEW'} />
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                1 {f.functionalCurrency} = rate × target currency, for share capital and premium.
                One row per currency this entity needs: its translated currencies, its parent’s
                currency and each consolidation-level currency.
              </p>
              {required.length === 0 ? (
                <p className="rounded-md border p-3 text-sm text-muted-foreground">
                  No historical rates needed.
                </p>
              ) : (
                required.map((r) => (
                  <div
                    key={r.currency}
                    className="grid items-end gap-2 sm:grid-cols-[6rem_12rem_1fr]"
                  >
                    <div className="pb-2 font-mono text-sm font-semibold">{r.currency}</div>
                    <Field label="Rate" htmlFor={`w-rate-${r.currency}`}>
                      <Input
                        id={`w-rate-${r.currency}`}
                        inputMode="decimal"
                        className="font-mono"
                        value={rates[r.currency]?.rate ?? ''}
                        onChange={(e) =>
                          setRates((x) => ({
                            ...x,
                            [r.currency]: { rate: e.target.value, note: x[r.currency]?.note ?? '' },
                          }))
                        }
                      />
                    </Field>
                    <Field
                      label="Date / source"
                      htmlFor={`w-note-${r.currency}`}
                      hint={`Needed as ${r.reasons.join(', ')}.`}
                    >
                      <Input
                        id={`w-note-${r.currency}`}
                        value={rates[r.currency]?.note ?? ''}
                        onChange={(e) =>
                          setRates((x) => ({
                            ...x,
                            [r.currency]: { rate: x[r.currency]?.rate ?? '', note: e.target.value },
                          }))
                        }
                      />
                    </Field>
                  </div>
                ))
              )}
              {missing.length > 0 && (
                <p className="text-sm text-warning-foreground">
                  Missing: {missing.map((m) => m.currency).join(', ')}. You can add them later; the
                  entity will be flagged until then.
                </p>
              )}
            </div>
          )}

          {step === 4 && (
            <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
              <Row label="Entity">
                <strong>{f.legalName}</strong> ({f.code.toUpperCase()} · {f.shortName})
              </Row>
              <Row label="Country / ERP / GAAP">
                {f.country} · {ERP_LABELS[f.erp]} · {GAAP_LABELS[f.gaap]}
              </Row>
              <Row label="Incorporated / acquired">{f.incorporatedOn || '—'}</Row>
              <Row label="Currencies">
                {f.functionalCurrency} functional · {f.reportingCurrency} reporting · translated
                into {f.translatedCurrencies.join(', ') || '—'}
              </Row>
              <Row label="Materiality">{f.materiality || '—'}</Row>
              <Row label="Ownership">
                {f.parentCode ? `${f.heldByParentPct}% held by ${f.parentCode}` : 'Ultimate parent'}{' '}
                from {f.month}
                {preview.data?.effectiveGroupPct &&
                  ` · effective group ${preview.data.effectiveGroupPct}%`}
              </Row>
              <Row label="Consolidation levels">
                {preview.data?.levels.map((l) => `L${l.level} ${l.name}`).join(', ') || '—'}
              </Row>
              <Row label="Historical rates">
                {Object.entries(rates)
                  .filter(([, r]) => r.rate.trim())
                  .map(([c, r]) => `${c} ${r.rate}`)
                  .join(', ') || '—'}
                {missing.length > 0 && (
                  <span className="text-warning-foreground">
                    {' '}
                    · missing {missing.map((m) => m.currency).join(', ')}
                  </span>
                )}
              </Row>
            </dl>
          )}

          {problems[step]!.length > 0 && (
            <ul className="space-y-1 text-sm text-destructive">
              {problems[step]!.map((p) => (
                <li key={p} className="flex items-start gap-1.5">
                  <CircleX className="mt-0.5 size-4 shrink-0" /> {p}
                </li>
              ))}
            </ul>
          )}
          {create.error && <Alert>{errorMessage(create.error)}</Alert>}
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={() => (step === 0 ? navigate('/configuration/entities') : setStep(step - 1))}
        >
          <ArrowLeft /> {step === 0 ? 'Cancel' : 'Back'}
        </Button>
        {step < 4 ? (
          <Button
            disabled={
              problems[step]!.length > 0 || (step === 2 && (preview.isFetching || !preview.data))
            }
            onClick={() => setStep(step + 1)}
          >
            Next <ArrowRight />
          </Button>
        ) : (
          <Button disabled={create.isPending} onClick={() => create.mutate()}>
            <Check /> Create entity
          </Button>
        )}
      </div>
    </ConfigPage>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Preview({
  preview,
  loading,
  code,
}: {
  preview: EntityPreviewDto | undefined;
  loading: boolean;
  code: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-4 text-sm">
      <p className="mb-2 font-medium">
        Where it sits in the group{' '}
        {loading && <span className="text-xs text-muted-foreground">(updating…)</span>}
      </p>
      {!preview ? (
        <p className="text-muted-foreground">…</p>
      ) : preview.issues.length > 0 ? (
        <p className="text-destructive">Not a valid structure yet.</p>
      ) : (
        <>
          <ol className="space-y-1">
            {preview.path.map((p, i) => (
              <li
                key={p.code}
                style={{ paddingLeft: `${i * 1.25}rem` }}
                className={p.code === code.toUpperCase() ? 'font-semibold text-primary' : undefined}
              >
                {i > 0 && '└ '}
                <span className="font-mono text-xs">{p.code}</span> {p.legalName}
              </li>
            ))}
          </ol>
          <p className="mt-3">
            Effective group %: <strong>{preview.effectiveGroupPct}%</strong>
          </p>
          <p>
            Joins:{' '}
            {preview.levels.map((l) => `L${l.level} ${l.name} (${l.currency})`).join(', ') ||
              'no consolidation level'}
          </p>
        </>
      )}
    </div>
  );
}
