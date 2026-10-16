import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type {
  AccountTypeDefaultDto,
  FsliCreateInput,
  FsliCreateResultDto,
  FsliDto,
} from '@finance-close/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, Field, Input, Select } from '@/components/ui/form';
import { Dialog, Table, Td, Th } from '@/components/ui/overlay';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Skeleton } from '@/components/ui/skeleton';
import { api, errorMessage } from '@/lib/api';
import { toast } from '@/lib/toast';
import { SearchBox } from './common';
import { ConfigPage, EditButton, EmptyState } from './ConfigPage';
import { matches } from './hooks';

export { ExchangeRatesPage } from './ExchangeRatesPage';
export { FormatsPage } from './FormatsPage';

const CLASS_LABEL = { A: 'Asset', L: 'Liability', E: 'Equity', I: 'Income', X: 'Expense' } as const;
const ERP_LABEL: Record<string, string> = { ZOHO: 'Zoho', XERO: 'Xero', OTHER: 'Other' };

function useFslis() {
  return useQuery({
    queryKey: ['config', 'fslis'],
    queryFn: () => api.get<FsliDto[]>('/config/fslis'),
  });
}

export function FsliPage() {
  const q = useFslis();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<FsliDto | null>(null);
  const [adding, setAdding] = useState(false);
  const rows = (q.data ?? []).filter((f) => matches(query, f.code, f.name));
  return (
    <ConfigPage
      title="FSLI master"
      purpose="The financial statement line items every account maps to, with their translation rate and flags. New FSLIs (e.g. a new client grouping) can be added; existing ones can only be renamed."
      count={q.data ? `${q.data.length} FSLIs` : null}
      action={
        <EditButton disabled={!q.data} onClick={() => setAdding(true)}>
          <Plus /> Add FSLI
        </EditButton>
      }
    >
      <SearchBox value={query} onChange={setQuery} placeholder="Search FSLIs" />
      {q.error && <Alert>{errorMessage(q.error)}</Alert>}
      {!q.data ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState title="No FSLIs match" text="Change the search." />
      ) : (
        <Table aria-label="FSLI master">
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Statement</Th>
              <Th>Class</Th>
              <Th>Rate</Th>
              <Th>Flags</Th>
              <Th className="text-right">Used by</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.code}>
                <Td className="font-mono text-xs">{f.code}</Td>
                <Td>{f.name}</Td>
                <Td>{f.statement === 'BS' ? 'Balance sheet' : 'Profit and loss'}</Td>
                <Td>{CLASS_LABEL[f.class]}</Td>
                <Td className="text-xs">{f.rateBasis.replace('_', ' ').toLowerCase()}</Td>
                <Td className="space-x-1 text-xs">
                  {f.needsCounterparty && <Badge variant="outline">counterparty</Badge>}
                  {f.intercompany && <Badge variant="outline">intercompany</Badge>}
                  {f.computed && <Badge variant="outline">computed</Badge>}
                  {f.consolidationOnly && <Badge variant="outline">consolidation only</Badge>}
                </Td>
                <Td className="text-right whitespace-nowrap tabular-nums">
                  {f.accounts} account{f.accounts === 1 ? '' : 's'}
                </Td>
                <Td className="text-right">
                  <EditButton
                    variant="ghost"
                    size="sm"
                    aria-label={`Rename ${f.name}`}
                    onClick={() => setEditing(f)}
                  >
                    <Pencil /> Rename
                  </EditButton>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {editing && <RenameFsliDialog fsli={editing} onClose={() => setEditing(null)} />}
      {adding && q.data && <AddFsliDialog fslis={q.data} onClose={() => setAdding(false)} />}
    </ConfigPage>
  );
}

const CLASSES = { BS: ['A', 'L', 'E'], PL: ['I', 'X'] } as const;
const DEFAULT_RATE: Record<string, FsliCreateInput['rateBasis']> = {
  A: 'CLOSING',
  L: 'CLOSING',
  E: 'OPENING',
  I: 'AVERAGE',
  X: 'AVERAGE',
};
const codeFrom = (name: string) =>
  name
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);

/**
 * A new FSLI, e.g. a grouping the client starts using. It is placed in every format next to an
 * existing FSLI (and, by default, as a line of its own in the Aistra management format), so
 * statements keep adding up; "Import groupings" then recognises it by its name.
 */
function AddFsliDialog({ fslis, onClose }: { fslis: FsliDto[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  const [statement, setStatement] = useState<'BS' | 'PL'>('PL');
  const [cls, setCls] = useState<FsliCreateInput['class']>('X');
  const [rate, setRate] = useState<FsliCreateInput['rateBasis']>('AVERAGE');
  const [anchor, setAnchor] = useState('');
  const [ownLine, setOwnLine] = useState(true);
  const anchors = fslis.filter((f) => f.statement === statement && !f.computed);
  const finalCode = codeTouched ? code : codeFrom(name);
  const save = useMutation({
    mutationFn: () =>
      api.post<FsliCreateResultDto>('/config/fslis', {
        code: finalCode,
        name,
        statement,
        class: cls,
        rateBasis: rate,
        anchor,
        ownLineIn: ownLine ? ['MANAGEMENT'] : [],
      } satisfies FsliCreateInput),
    onSuccess: async (r) => {
      toast(
        `${r.fsli.name} added; ${r.formats.map((f) => `${f.name} v${f.version}`).join(', ')} updated.`,
      );
      await qc.invalidateQueries({ queryKey: ['config'] });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add FSLI"
      description="Use the client's grouping name as the FSLI name: Import groupings then maps accounts with that grouping to it. Every report format gets it next to the FSLI you choose (a new format version where finalised reports use the current one)."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending || name.trim().length < 2 || !finalCode || !anchor}
            onClick={() => save.mutate()}
          >
            Add FSLI
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        <Field label="Name (as the client's grouping)" htmlFor="new-fsli-name">
          <Input
            id="new-fsli-name"
            value={name}
            maxLength={120}
            placeholder="e.g. Marketing - Events"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field
          label="Code"
          htmlFor="new-fsli-code"
          hint="Upper case, digits and _; cannot change later."
        >
          <Input
            id="new-fsli-code"
            value={finalCode}
            maxLength={30}
            className="font-mono"
            onChange={(e) => {
              setCodeTouched(true);
              setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''));
            }}
          />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Statement" htmlFor="new-fsli-statement">
            <Select
              id="new-fsli-statement"
              value={statement}
              onChange={(e) => {
                const st = e.target.value as 'BS' | 'PL';
                const c = CLASSES[st][0];
                setStatement(st);
                setCls(c);
                setRate(DEFAULT_RATE[c]!);
                setAnchor('');
              }}
            >
              <option value="PL">Profit and loss</option>
              <option value="BS">Balance sheet</option>
            </Select>
          </Field>
          <Field label="Class" htmlFor="new-fsli-class">
            <Select
              id="new-fsli-class"
              value={cls}
              onChange={(e) => {
                const c = e.target.value as FsliCreateInput['class'];
                setCls(c);
                setRate(DEFAULT_RATE[c]!);
              }}
            >
              {CLASSES[statement].map((c) => (
                <option key={c} value={c}>
                  {CLASS_LABEL[c]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Translation rate" htmlFor="new-fsli-rate">
            <Select
              id="new-fsli-rate"
              value={rate}
              onChange={(e) => setRate(e.target.value as FsliCreateInput['rateBasis'])}
            >
              <option value="CLOSING">Closing</option>
              <option value="AVERAGE">Average</option>
              <option value="HISTORICAL">Historical</option>
              <option value="OPENING">Opening</option>
            </Select>
          </Field>
        </div>
        <Field label="Show it next to">
          <SearchableSelect
            label="Show it next to"
            value={anchor}
            onChange={setAnchor}
            placeholder="Choose an FSLI"
            options={anchors.map((f) => ({ value: f.code, label: f.name, hint: f.code }))}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={ownLine} onChange={(e) => setOwnLine(e.target.checked)} />
          Its own line in the Aistra management format (other formats: on the chosen FSLI&apos;s
          line)
        </label>
      </div>
    </Dialog>
  );
}

function RenameFsliDialog({ fsli, onClose }: { fsli: FsliDto; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(fsli.name);
  const save = useMutation({
    mutationFn: () => api.patch<void>(`/config/fslis/${fsli.code}`, { name }),
    onSuccess: async () => {
      toast('FSLI renamed.');
      await qc.invalidateQueries({ queryKey: ['config'] });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Rename ${fsli.code}`}
      description={`Used by ${fsli.accounts} account${fsli.accounts === 1 ? '' : 's'}. Only the name changes; the code and every mapping stay as they are.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending || !name.trim()} onClick={() => save.mutate()}>
            Save name
          </Button>
        </>
      }
    >
      {save.error && <Alert className="mb-3">{errorMessage(save.error)}</Alert>}
      <Field label="Name" htmlFor="fsli-name">
        <Input
          id="fsli-name"
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
    </Dialog>
  );
}

export function AccountTypeDefaultsPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['config', 'account-type-defaults'],
    queryFn: () => api.get<AccountTypeDefaultDto[]>('/config/account-type-defaults'),
  });
  const fslis = useFslis();
  const [editing, setEditing] = useState<AccountTypeDefaultDto | 'new' | null>(null);
  const remove = useMutation({
    mutationFn: (r: AccountTypeDefaultDto) =>
      api.delete(`/config/account-type-defaults/${r.erp}/${encodeURIComponent(r.accountType)}`),
    onSuccess: async () => {
      toast('Default removed.');
      await qc.invalidateQueries({ queryKey: ['config', 'account-type-defaults'] });
    },
  });
  return (
    <ConfigPage
      title="Account-type defaults"
      purpose="The FSLI given to a new account from its ERP account type, when a chart of accounts is uploaded."
      count={q.data ? `${q.data.length} defaults` : null}
      action={
        <EditButton onClick={() => setEditing('new')}>
          <Plus /> Add default
        </EditButton>
      }
    >
      {(q.error || remove.error) && <Alert>{errorMessage(q.error ?? remove.error)}</Alert>}
      {!q.data ? (
        <Skeleton className="h-64 w-full" />
      ) : q.data.length === 0 ? (
        <EmptyState
          title="No defaults"
          text="Without defaults, new accounts need an FSLI chosen by hand."
        />
      ) : (
        <Table aria-label="Account-type defaults">
          <thead>
            <tr>
              <Th>ERP</Th>
              <Th>Account type</Th>
              <Th>Default FSLI</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {q.data.map((r) => (
              <tr key={`${r.erp}-${r.accountType}`}>
                <Td>{ERP_LABEL[r.erp] ?? r.erp}</Td>
                <Td>{r.accountType}</Td>
                <Td>
                  {r.fsliName}{' '}
                  <span className="font-mono text-xs text-muted-foreground">{r.fsliCode}</span>
                </Td>
                <Td className="space-x-1 text-right whitespace-nowrap">
                  <EditButton
                    variant="ghost"
                    size="sm"
                    aria-label={`Change ${r.accountType}`}
                    onClick={() => setEditing(r)}
                  >
                    <Pencil /> Change
                  </EditButton>
                  <EditButton
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${r.accountType}`}
                    disabled={remove.isPending}
                    onClick={() => {
                      if (window.confirm(`Remove the default for "${r.accountType}"?`))
                        remove.mutate(r);
                    }}
                  >
                    <Trash2 />
                  </EditButton>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {editing && fslis.data && (
        <DefaultDialog
          row={editing === 'new' ? null : editing}
          fslis={fslis.data}
          onClose={() => setEditing(null)}
        />
      )}
    </ConfigPage>
  );
}

function DefaultDialog({
  row,
  fslis,
  onClose,
}: {
  row: AccountTypeDefaultDto | null;
  fslis: FsliDto[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    erp: row?.erp ?? 'ZOHO',
    accountType: row?.accountType ?? '',
    fsliCode: row?.fsliCode ?? '',
  });
  const save = useMutation({
    mutationFn: () => api.put<AccountTypeDefaultDto>('/config/account-type-defaults', form),
    onSuccess: async () => {
      toast('Default saved.');
      await qc.invalidateQueries({ queryKey: ['config', 'account-type-defaults'] });
      onClose();
    },
  });
  const mappable = fslis.filter((f) => !f.computed && !f.consolidationOnly);
  return (
    <Dialog
      open
      onClose={onClose}
      title={row ? `Change ${row.accountType}` : 'Add default'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending || !form.accountType.trim() || !form.fsliCode}
            onClick={() => save.mutate()}
          >
            Save default
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        <Field label="ERP" htmlFor="def-erp">
          <Select
            id="def-erp"
            value={form.erp}
            disabled={!!row}
            onChange={(e) => setForm({ ...form, erp: e.target.value })}
          >
            {Object.entries(ERP_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Account type"
          htmlFor="def-type"
          hint="As it appears in the ERP export, e.g. “Other Current Asset”."
        >
          <Input
            id="def-type"
            value={form.accountType}
            disabled={!!row}
            onChange={(e) => setForm({ ...form, accountType: e.target.value })}
          />
        </Field>
        <Field label="Default FSLI">
          <SearchableSelect
            label="Default FSLI"
            value={form.fsliCode}
            onChange={(v) => setForm({ ...form, fsliCode: v })}
            placeholder="Choose an FSLI"
            options={mappable.map((f) => ({
              value: f.code,
              label: f.name,
              hint: f.code,
              group: f.statement === 'BS' ? 'Balance sheet' : 'Profit and loss',
            }))}
          />
        </Field>
      </div>
    </Dialog>
  );
}
