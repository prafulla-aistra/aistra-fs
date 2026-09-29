import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import {
  SIGN_CONVENTIONS,
  type SignConvention,
  type TbColumnSettingsDto,
  type TbPreviewDto,
  type TbVersionDto,
  type UploadEntityCardDto,
} from '@finance-close/shared';
import { Button } from '@/components/ui/button';
import { Alert, Checkbox, Field, Input, Select } from '@/components/ui/form';
import { Dialog, Table, Td, Th } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import { amountText } from '@/lib/format';
import { toast } from '@/lib/toast';
import { TbResult } from './TbResult';

const SOURCE_TEXT: Record<TbPreviewDto['settingsSource'], string> = {
  PROFILE: 'Pre-filled from this entity’s last upload.',
  DETECTED: 'Detected from the file. Check each column.',
  EDITED: 'Your settings.',
  NONE: 'No "Account Code" header found in the first 40 rows — choose the header row and columns.',
};

const EMPTY: TbColumnSettingsDto = {
  headerRow: 0,
  codeColumn: 0,
  nameColumn: 1,
  balanceColumn: 2,
  debitColumn: null,
  creditColumn: null,
  signConvention: 'DEBIT_POSITIVE',
};

/** Column confirmation: editable column choices, sign convention, preview and checks. */
export function TbColumnsDialog({
  taskId,
  entity,
  initial,
  onClose,
  onSaved,
}: {
  taskId: string;
  entity: UploadEntityCardDto;
  initial: TbPreviewDto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const base = `/tasks/${taskId}/entities/${entity.code}/tb`;
  const [p, setP] = useState(initial);
  const [settings, setSettings] = useState<TbColumnSettingsDto>(initial.settings ?? EMPTY);
  const [acks, setAcks] = useState<string[]>([]);

  const reparse = useMutation({
    mutationFn: (s: TbColumnSettingsDto) =>
      api.post<TbPreviewDto>(`${base}/preview`, { fileId: p.fileId, settings: s }),
    onSuccess: (r) => {
      setP(r);
      setAcks((a) => a.filter((c) => r.check?.needsAcknowledgement.some((w) => w.code === c)));
    },
  });
  const save = useMutation({
    mutationFn: () =>
      api.post<TbVersionDto>(`${base}/confirm`, { fileId: p.fileId, settings, acknowledged: acks }),
    onSuccess: (v) => {
      toast(
        v.status === 'ERROR'
          ? `${entity.code}: trial balance saved as Error (version ${v.version}). Fix the file and upload it again.`
          : `${entity.code}: trial balance validated (version ${v.version}).`,
      );
      onSaved();
    },
  });

  const update = (patch: Partial<TbColumnSettingsDto>) => {
    const next = { ...settings, ...patch };
    if (patch.signConvention === 'SEPARATE_COLUMNS') {
      next.debitColumn ??= next.balanceColumn ?? 2;
      next.creditColumn ??= next.debitColumn + 1;
    } else if (patch.signConvention) {
      next.balanceColumn ??= next.debitColumn ?? 2;
    }
    setSettings(next);
    reparse.mutate(next);
  };

  const separate = settings.signConvention === 'SEPARATE_COLUMNS';
  const columns = p.columns.length > 0 ? p.columns : [{ index: 0, label: 'Column A' }];
  const colSelect = (label: string, value: number | null, onChange: (v: number) => void) => (
    <Field label={label}>
      <Select value={value ?? ''} onChange={(e) => onChange(Number(e.target.value))}>
        {value === null && <option value="">Choose…</option>}
        {columns.map((c) => (
          <option key={c.index} value={c.index}>
            {c.label}
          </option>
        ))}
      </Select>
    </Field>
  );
  const check = reparse.isPending ? null : p.check;
  const needAck = check?.needsAcknowledgement ?? [];
  const allAcked = needAck.every((w) => acks.includes(w.code));
  const period = p.detectedPeriod
    ? 'asOf' in p.detectedPeriod
      ? `as of ${p.detectedPeriod.asOf}`
      : `${p.detectedPeriod.from} to ${p.detectedPeriod.to}`
    : 'not stated';

  return (
    <Dialog
      open
      size="xl"
      onClose={onClose}
      title={`Confirm columns — ${entity.code} trial balance`}
      description={
        <>
          {p.fileName} · organisation in file: {p.detectedOrganisation ?? 'not stated'} · period in
          file: {period}
        </>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!check || !allAcked || save.isPending} onClick={() => save.mutate()}>
            {check?.status === 'ERROR' ? 'Save as Error' : 'Confirm and validate'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">{SOURCE_TEXT[p.settingsSource]}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Header row" hint="Spreadsheet row number of the column headings">
            <Input
              type="number"
              min={1}
              value={settings.headerRow + 1}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isInteger(n) && n >= 1) update({ headerRow: n - 1 });
              }}
            />
          </Field>
          {colSelect('Account code', settings.codeColumn, (v) => update({ codeColumn: v }))}
          {colSelect('Account name', settings.nameColumn, (v) => update({ nameColumn: v }))}
          <Field label="Sign convention">
            <Select
              value={settings.signConvention}
              onChange={(e) => update({ signConvention: e.target.value as SignConvention })}
            >
              {SIGN_CONVENTIONS.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          {separate ? (
            <>
              {colSelect('Debit column', settings.debitColumn, (v) => update({ debitColumn: v }))}
              {colSelect('Credit column', settings.creditColumn, (v) =>
                update({ creditColumn: v }),
              )}
            </>
          ) : (
            colSelect('Balance column', settings.balanceColumn, (v) => update({ balanceColumn: v }))
          )}
        </div>

        <div>
          <h3 className="mb-1.5 text-sm font-medium">
            First {Math.min(10, p.preview.length)} lines as they will be saved
          </h3>
          <Table>
            <thead>
              <tr>
                <Th>Row</Th>
                <Th>Account code</Th>
                <Th>Account name</Th>
                <Th className="text-right">Amount (Dr + / Cr −)</Th>
              </tr>
            </thead>
            <tbody>
              {p.preview.map((l) => (
                <tr key={`${l.row}-${l.code}`}>
                  <Td className="text-xs text-muted-foreground">{l.row}</Td>
                  <Td className="font-mono text-xs">{l.code}</Td>
                  <Td>{l.name}</Td>
                  <Td className="text-right font-mono tabular-nums">
                    {l.amount === null ? '—' : amountText(l.amount)}
                  </Td>
                </tr>
              ))}
              {p.preview.length === 0 && (
                <tr>
                  <Td colSpan={4} className="text-center text-muted-foreground">
                    No lines read with these settings.
                  </Td>
                </tr>
              )}
            </tbody>
          </Table>
        </div>

        {reparse.isPending && <p className="text-sm text-muted-foreground">Re-reading the file…</p>}
        {check && <TbResult version={check} />}

        {needAck.length > 0 && (
          <div className="space-y-2 rounded-md border border-warning/40 bg-amber-50 px-3 py-2">
            <p className="text-sm font-medium">Acknowledge before saving</p>
            {needAck.map((w) => (
              <label key={w.code} className="flex items-start gap-2 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={acks.includes(w.code)}
                  onChange={(e) =>
                    setAcks((a) =>
                      e.target.checked ? [...a, w.code] : a.filter((c) => c !== w.code),
                    )
                  }
                />
                <span>I have checked this and want to use the file: {w.message}</span>
              </label>
            ))}
          </div>
        )}
        {(reparse.error ?? save.error) && (
          <Alert>{errorMessage(reparse.error ?? save.error)}</Alert>
        )}
      </div>
    </Dialog>
  );
}
