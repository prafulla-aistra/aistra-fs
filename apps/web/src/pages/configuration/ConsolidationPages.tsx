import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Plus } from 'lucide-react';
import { useState } from 'react';
import type {
  AcquisitionDto,
  AcquisitionInput,
  AcquisitionsDto,
  IntercompanyPairDto,
  IntercompanyPairsDto,
} from '@finance-close/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, Checkbox, Field, Input, Select } from '@/components/ui/form';
import { Dialog, Table, Td, Th } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import { amountText, formatDate } from '@/lib/format';
import { TbcBadge } from './common';
import { ConfigPage, EditButton } from './ConfigPage';

/** Configuration → Intercompany pairs: the matrix the eliminations use, with a tolerance each. */
export function IntercompanyPairsPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['config', 'ic-pairs'],
    queryFn: () => api.get<IntercompanyPairsDto>('/config/intercompany-pairs'),
  });
  const [editing, setEditing] = useState<Partial<IntercompanyPairDto> | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/config/intercompany-pairs/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['config', 'ic-pairs'] }),
  });
  const d = q.data;
  return (
    <ConfigPage
      title="Intercompany pairs"
      purpose="Pairs of entities whose intercompany balances and revenue / charges are eliminated against each other. A difference below the tolerance is rounding (to FCTR); a larger one goes to IC difference – unreconciled and is flagged."
      count={d ? `${d.pairs.length} pairs` : null}
      action={
        <EditButton
          size="sm"
          onClick={() => setEditing({ tolerance: '1.00', toBeConfirmed: false })}
        >
          <Plus /> Mark a pair
        </EditButton>
      }
    >
      {(q.error || remove.error) && <Alert>{errorMessage(q.error ?? remove.error)}</Alert>}
      {d && d.suggested.length > 0 && (
        <Alert>
          <div className="font-medium">Intercompany accounts without a marked pair:</div>
          <ul className="list-disc pl-5">
            {d.suggested.map((s) => (
              <li key={`${s.entityA}${s.entityB}`}>
                {s.entityA} ↔ {s.entityB} ({s.accounts} account{s.accounts === 1 ? '' : 's'}){' '}
                <EditButton
                  variant="link"
                  size="sm"
                  onClick={() =>
                    setEditing({
                      entityA: s.entityA,
                      entityB: s.entityB,
                      tolerance: '1.00',
                      toBeConfirmed: false,
                    })
                  }
                >
                  Mark
                </EditButton>
              </li>
            ))}
          </ul>
        </Alert>
      )}
      <Card>
        <CardContent className="pt-6">
          <Table>
            <thead>
              <tr>
                <Th>Pair</Th>
                <Th className="text-right">Tolerance</Th>
                <Th className="text-right">Accounts linked</Th>
                <Th>Note</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {d?.pairs.map((p) => (
                <tr key={p.id}>
                  <Td className="font-medium">
                    {p.entityA} ↔ {p.entityB} {p.toBeConfirmed && <TbcBadge />}
                  </Td>
                  <Td className="text-right tabular-nums">{amountText(p.tolerance)}</Td>
                  <Td className="text-right tabular-nums">{p.accountsLinked}</Td>
                  <Td className="text-xs text-muted-foreground">{p.note}</Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      <EditButton variant="ghost" size="sm" onClick={() => setEditing(p)}>
                        Edit
                      </EditButton>
                      <EditButton
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(p.id)}
                      >
                        Remove
                      </EditButton>
                    </div>
                  </Td>
                </tr>
              ))}
              {d && d.pairs.length === 0 && (
                <tr>
                  <Td colSpan={5} className="text-muted-foreground">
                    No pairs marked.
                  </Td>
                </tr>
              )}
            </tbody>
          </Table>
        </CardContent>
      </Card>
      {editing && d && (
        <PairDialog pair={editing} entities={d.entities} onClose={() => setEditing(null)} />
      )}
    </ConfigPage>
  );
}

function PairDialog({
  pair,
  entities,
  onClose,
}: {
  pair: Partial<IntercompanyPairDto>;
  entities: { code: string; shortName: string }[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [a, setA] = useState(pair.entityA ?? '');
  const [b, setB] = useState(pair.entityB ?? '');
  const [tolerance, setTolerance] = useState(pair.tolerance ?? '1.00');
  const [tbc, setTbc] = useState(pair.toBeConfirmed ?? false);
  const [note, setNote] = useState(pair.note ?? '');
  const save = useMutation({
    mutationFn: () =>
      api.put('/config/intercompany-pairs', {
        entityA: a,
        entityB: b,
        tolerance,
        toBeConfirmed: tbc,
        note: note.trim() || null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['config', 'ic-pairs'] });
      onClose();
    },
  });
  const fixed = Boolean(pair.id);
  return (
    <Dialog
      open
      onClose={onClose}
      title={fixed ? `Pair ${a} ↔ ${b}` : 'Mark an intercompany pair'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              !a || !b || a === b || !/^\d{1,12}(\.\d{1,4})?$/.test(tolerance) || save.isPending
            }
            onClick={() => save.mutate()}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        <div className="grid grid-cols-2 gap-3">
          {[
            ['Entity', a, setA, 'pa'],
            ['Counterparty', b, setB, 'pb'],
          ].map(([label, v, set, id]) => (
            <Field key={id as string} label={label as string} htmlFor={id as string}>
              <Select
                id={id as string}
                value={v as string}
                disabled={fixed}
                onChange={(e) => (set as (x: string) => void)(e.target.value)}
              >
                <option value="">Choose…</option>
                {entities.map((e) => (
                  <option key={e.code} value={e.code}>
                    {e.code} · {e.shortName}
                  </option>
                ))}
              </Select>
            </Field>
          ))}
        </div>
        <Field label="Tolerance (level currency)" htmlFor="p-tol">
          <Input
            id="p-tol"
            inputMode="decimal"
            value={tolerance}
            onChange={(e) => setTolerance(e.target.value)}
          />
        </Field>
        <Field label="Note" htmlFor="p-note">
          <Input
            id="p-note"
            value={note}
            maxLength={300}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={tbc} onChange={(e) => setTbc(e.target.checked)} /> To be confirmed
        </label>
      </div>
    </Dialog>
  );
}

/** Configuration → Acquisitions: the register the investment eliminations use. */
export function AcquisitionsPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['config', 'acquisitions'],
    queryFn: () => api.get<AcquisitionsDto>('/config/acquisitions'),
  });
  const [editing, setEditing] = useState<Partial<AcquisitionDto> | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/config/acquisitions/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['config', 'acquisitions'] }),
  });
  const d = q.data;
  return (
    <ConfigPage
      title="Acquisitions"
      purpose="Each acquisition (step) of a subsidiary: cost, % acquired, share capital, premium and pre-acquisition reserves at acquisition, and the acquisition-date rate into the parent's currency and every consolidation-level currency the subsidiary is in."
      count={d ? `${d.acquisitions.length} acquisitions` : null}
      action={
        <EditButton
          size="sm"
          onClick={() =>
            setEditing({
              pctAcquired: '100',
              premium: '0.00',
              preAcquisitionReserves: '0.00',
              toBeConfirmed: false,
              rates: [],
            })
          }
        >
          <Plus /> Add acquisition
        </EditButton>
      }
    >
      {(q.error || remove.error) && <Alert>{errorMessage(q.error ?? remove.error)}</Alert>}
      {d && d.missing.length > 0 && (
        <Alert>
          Subsidiaries without an acquisitions register row (their investment cannot be eliminated):{' '}
          {d.missing.map((m) => `${m.code} ${m.shortName} (held by ${m.parentCode})`).join(', ')}.
        </Alert>
      )}
      <Card>
        <CardContent className="overflow-x-auto pt-6">
          <Table>
            <thead>
              <tr>
                <Th>Subsidiary</Th>
                <Th>Acquired</Th>
                <Th className="text-right">%</Th>
                <Th className="text-right">Cost</Th>
                <Th className="text-right">Share capital + premium</Th>
                <Th className="text-right">Pre-acq. reserves</Th>
                <Th>Acquisition-date rates</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {d?.acquisitions.map((a) => (
                <tr key={a.id} className="align-top">
                  <Td>
                    <div className="font-medium">
                      {a.subsidiaryCode} {a.subsidiaryName}{' '}
                      {a.toBeConfirmed && <TbcBadge note={a.note} />}
                    </div>
                    <div className="text-xs text-muted-foreground">held by {a.parentCode}</div>
                  </Td>
                  <Td>{formatDate(a.acquiredOn)}</Td>
                  <Td className="text-right tabular-nums">{a.pctAcquired}%</Td>
                  <Td className="text-right tabular-nums">
                    {amountText(a.cost)} {a.parentCurrency}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {amountText(a.shareCapital)} + {amountText(a.premium)} {a.subsidiaryCurrency}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {amountText(a.preAcquisitionReserves)}
                  </Td>
                  <Td className="text-xs tabular-nums">
                    {a.ratesNeeded.map((n) => {
                      const r = a.rates.find((x) => x.currency === n.currency);
                      return (
                        <div
                          key={n.currency}
                          title={n.reasons.join('; ')}
                          className={r ? undefined : 'text-destructive'}
                        >
                          {a.subsidiaryCurrency} → {n.currency}:{' '}
                          {r ? (
                            `${r.rate}${r.toBeConfirmed ? ' (TBC)' : ''}`
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              <AlertTriangle className="size-3" /> missing
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      <EditButton variant="ghost" size="sm" onClick={() => setEditing(a)}>
                        Edit
                      </EditButton>
                      <EditButton
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(a.id)}
                      >
                        Remove
                      </EditButton>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardContent>
      </Card>
      {editing && d && (
        <AcquisitionDialog acq={editing} data={d} onClose={() => setEditing(null)} />
      )}
    </ConfigPage>
  );
}

function AcquisitionDialog({
  acq,
  data,
  onClose,
}: {
  acq: Partial<AcquisitionDto>;
  data: AcquisitionsDto;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState<AcquisitionInput>({
    subsidiaryCode: acq.subsidiaryCode ?? '',
    parentCode: acq.parentCode ?? '',
    acquiredOn: acq.acquiredOn ?? '',
    pctAcquired: acq.pctAcquired ?? '100',
    cost: acq.cost ?? '',
    shareCapital: acq.shareCapital ?? '',
    premium: acq.premium ?? '0.00',
    preAcquisitionReserves: acq.preAcquisitionReserves ?? '0.00',
    toBeConfirmed: acq.toBeConfirmed ?? false,
    note: acq.note ?? null,
    rates: acq.rates ?? [],
  });
  const sub = data.entities.find((e) => e.code === f.subsidiaryCode);
  const parent = data.entities.find((e) => e.code === f.parentCode);
  const needed = acq.ratesNeeded?.map((n) => n.currency) ?? [
    ...new Set(
      [parent?.functionalCurrency].filter(
        (c): c is string => Boolean(c) && c !== sub?.functionalCurrency,
      ),
    ),
  ];
  const currencies = [...new Set([...needed, ...f.rates.map((r) => r.currency)])].sort();
  const save = useMutation({
    mutationFn: () =>
      acq.id ? api.put(`/config/acquisitions/${acq.id}`, f) : api.post('/config/acquisitions', f),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['config', 'acquisitions'] });
      onClose();
    },
  });
  const rateOf = (c: string) => f.rates.find((r) => r.currency === c);
  const setRate = (c: string, patch: Partial<{ rate: string; toBeConfirmed: boolean }>) => {
    const cur = rateOf(c) ?? { currency: c, rate: '', toBeConfirmed: false };
    const next = { ...cur, ...patch };
    setF({
      ...f,
      rates: [...f.rates.filter((r) => r.currency !== c), ...(next.rate ? [next] : [])],
    });
  };
  const field = (label: string, key: keyof AcquisitionInput, suffix = '') => (
    <Field label={`${label}${suffix}`} htmlFor={`acq-${key}`}>
      <Input
        id={`acq-${key}`}
        inputMode="decimal"
        value={String(f[key] ?? '')}
        onChange={(e) => setF({ ...f, [key]: e.target.value })}
      />
    </Field>
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title={acq.id ? `Acquisition of ${acq.subsidiaryCode}` : 'Add acquisition'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              !f.subsidiaryCode ||
              !f.parentCode ||
              !f.acquiredOn ||
              !f.cost ||
              !f.shareCapital ||
              save.isPending
            }
            onClick={() => save.mutate()}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Subsidiary" htmlFor="acq-sub">
            <Select
              id="acq-sub"
              value={f.subsidiaryCode}
              onChange={(e) => {
                const s = data.entities.find((x) => x.code === e.target.value);
                setF({
                  ...f,
                  subsidiaryCode: e.target.value,
                  parentCode: s?.parentCode ?? f.parentCode,
                });
              }}
            >
              <option value="">Choose…</option>
              {data.entities
                .filter((e) => e.parentCode)
                .map((e) => (
                  <option key={e.code} value={e.code}>
                    {e.code} · {e.shortName} ({e.functionalCurrency})
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Acquired by" htmlFor="acq-parent">
            <Select
              id="acq-parent"
              value={f.parentCode}
              onChange={(e) => setF({ ...f, parentCode: e.target.value })}
            >
              <option value="">Choose…</option>
              {data.entities.map((e) => (
                <option key={e.code} value={e.code}>
                  {e.code} · {e.shortName} ({e.functionalCurrency})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Acquisition date" htmlFor="acq-date">
            <Input
              id="acq-date"
              type="date"
              value={f.acquiredOn}
              onChange={(e) => setF({ ...f, acquiredOn: e.target.value })}
            />
          </Field>
          {field('% acquired', 'pctAcquired')}
          {field('Cost', 'cost', parent ? ` (${parent.functionalCurrency})` : '')}
          {field(
            'Share capital at acquisition',
            'shareCapital',
            sub ? ` (${sub.functionalCurrency})` : '',
          )}
          {field('Premium at acquisition', 'premium', sub ? ` (${sub.functionalCurrency})` : '')}
          {field(
            'Pre-acquisition reserves',
            'preAcquisitionReserves',
            sub ? ` (${sub.functionalCurrency})` : '',
          )}
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              Acquisition-date rates (1 {sub?.functionalCurrency ?? 'unit'} = rate)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {currencies.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Choose the subsidiary and parent first.
              </p>
            )}
            {currencies.map((c) => (
              <div key={c} className="flex items-center gap-2">
                <span className="w-24 text-sm">→ {c}</span>
                <Input
                  aria-label={`Rate into ${c}`}
                  className="w-44 text-right"
                  inputMode="decimal"
                  value={rateOf(c)?.rate ?? ''}
                  onChange={(e) => setRate(c, { rate: e.target.value })}
                />
                <label className="flex items-center gap-1 text-xs">
                  <Checkbox
                    checked={rateOf(c)?.toBeConfirmed ?? false}
                    onChange={(e) => setRate(c, { toBeConfirmed: e.target.checked })}
                  />{' '}
                  TBC
                </label>
              </div>
            ))}
          </CardContent>
        </Card>
        <Field label="Note" htmlFor="acq-note">
          <Input
            id="acq-note"
            value={f.note ?? ''}
            maxLength={500}
            onChange={(e) => setF({ ...f, note: e.target.value || null })}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={f.toBeConfirmed}
            onChange={(e) => setF({ ...f, toBeConfirmed: e.target.checked })}
          />{' '}
          To be confirmed
        </label>
      </div>
    </Dialog>
  );
}
