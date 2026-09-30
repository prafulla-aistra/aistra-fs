import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, Save } from 'lucide-react';
import { useState } from 'react';
import type { EntityMappingDto, MappingInputDto, MappingRowIssuesDto } from '@finance-close/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, Checkbox } from '@/components/ui/form';
import { Table, Td, Th } from '@/components/ui/overlay';
import { api, ApiError, errorMessage } from '@/lib/api';
import { drCr } from '@/lib/format';
import { toast } from '@/lib/toast';
import { AccountTypeSelect, CounterpartySelect, FsliSelect } from './FsliSelect';

interface RowState {
  accountType: string;
  fsliCode: string;
  counterpartyCode: string;
  confirm: boolean;
}

/** Accounts not in the COA, without an FSLI, or missing a counterparty. */
export function AccountsToMap({
  taskId,
  mapping,
  onSaved,
}: {
  taskId: string;
  mapping: EntityMappingDto;
  onSaved: (m: EntityMappingDto) => Promise<void>;
}) {
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      mapping.toMap.map((a) => [
        a.code,
        {
          accountType: a.accountType ?? '',
          fsliCode: a.suggestion?.fsliCode ?? a.current.fsliCode ?? '',
          counterpartyCode: a.suggestion?.counterpartyCode ?? a.current.counterpartyCode ?? '',
          confirm: false,
        },
      ]),
    ),
  );
  const [issues, setIssues] = useState<Record<string, MappingRowIssuesDto>>({});
  const fsliBy = new Map(mapping.options.fslis.map((f) => [f.code, f]));
  const set = (code: string, patch: Partial<RowState>) =>
    setRows((r) => ({ ...r, [code]: { ...r[code]!, ...patch } }));

  const save = useMutation({
    mutationFn: (mappings: MappingInputDto[]) =>
      api.put<EntityMappingDto>(`/tasks/${taskId}/entities/${mapping.entity.code}/mappings`, {
        mappings,
      }),
    onSuccess: async (m, sent) => {
      setIssues({});
      toast(
        `${sent.length} mapping${sent.length === 1 ? '' : 's'} saved to the chart of accounts.`,
      );
      await onSaved(m);
    },
    onError: (err) => {
      const body =
        err instanceof ApiError ? (err.body as { rows?: MappingRowIssuesDto[] }) : undefined;
      setIssues(Object.fromEntries((body?.rows ?? []).map((r) => [r.accountCode, r])));
    },
  });
  const submit = () => {
    const chosen = mapping.toMap.filter((a) => rows[a.code]?.fsliCode);
    save.mutate(
      chosen.map((a) => {
        const r = rows[a.code]!;
        return {
          accountCode: a.code,
          accountType: r.accountType || null,
          fsliCode: r.fsliCode,
          counterpartyCode: fsliBy.get(r.fsliCode)?.needsCounterparty
            ? r.counterpartyCode || null
            : null,
          confirmWarnings: r.confirm,
        };
      }),
    );
  };
  const chosenCount = mapping.toMap.filter((a) => rows[a.code]?.fsliCode).length;

  return (
    <Card className="border-warning/50">
      <CardHeader>
        <CardTitle>Accounts to map ({mapping.toMap.length})</CardTitle>
        <CardDescription>
          Choose the FSLI for each account. Saving writes to {mapping.entity.shortName}’s chart of
          accounts; you can save some now and the rest later.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Table>
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Account name</Th>
              <Th className="text-right">Balance</Th>
              <Th>Reason</Th>
              <Th>Account type</Th>
              <Th>FSLI</Th>
              <Th>Counterparty</Th>
              <Th>Suggestion</Th>
            </tr>
          </thead>
          <tbody>
            {mapping.toMap.map((a) => {
              const r = rows[a.code]!;
              const fsli = fsliBy.get(r.fsliCode);
              const issue = issues[a.code];
              return (
                <tr key={a.code} className="align-top">
                  <Td className="font-mono text-xs">{a.code}</Td>
                  <Td>{a.name}</Td>
                  <Td className="text-right font-mono tabular-nums whitespace-nowrap">
                    {drCr(a.amount)}
                  </Td>
                  <Td className="text-xs">{a.reasonText}</Td>
                  <Td className="min-w-40">
                    <AccountTypeSelect
                      label={`${a.code} account type`}
                      options={mapping.options}
                      value={r.accountType}
                      onChange={(v) => set(a.code, { accountType: v, confirm: false })}
                    />
                  </Td>
                  <Td className="min-w-56">
                    <FsliSelect
                      label={`${a.code} FSLI`}
                      options={mapping.options}
                      value={r.fsliCode}
                      disabled={!mapping.canEdit}
                      onChange={(v) => set(a.code, { fsliCode: v, confirm: false })}
                    />
                    {issue && (
                      <div className="mt-1 space-y-1 text-xs">
                        {issue.errors.map((e) => (
                          <p key={e.code} className="text-destructive">
                            {e.message}
                          </p>
                        ))}
                        {issue.errors.length === 0 &&
                          issue.warnings.map((w) => (
                            <label
                              key={w.code}
                              className="flex items-start gap-1.5 text-warning-foreground"
                            >
                              <Checkbox
                                className="mt-0.5"
                                checked={r.confirm}
                                onChange={(e) => set(a.code, { confirm: e.target.checked })}
                              />
                              <span>
                                <AlertTriangle className="mr-1 inline size-3" />
                                {w.message} Tick to confirm.
                              </span>
                            </label>
                          ))}
                      </div>
                    )}
                  </Td>
                  <Td className="min-w-48">
                    {fsli?.needsCounterparty ? (
                      <CounterpartySelect
                        label={`${a.code} counterparty`}
                        options={mapping.options}
                        investment={fsli.code === 'INV_SUB'}
                        value={r.counterpartyCode}
                        onChange={(v) => set(a.code, { counterpartyCode: v })}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </Td>
                  <Td className="text-xs text-muted-foreground">
                    {a.suggestion ? (
                      <>
                        {a.suggestion.fsliCode}
                        <br />
                        {a.suggestion.source}
                      </>
                    ) : (
                      'None'
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        {save.error && Object.keys(issues).length === 0 && (
          <Alert>{errorMessage(save.error)}</Alert>
        )}
        {mapping.canEdit && (
          <div className="flex justify-end">
            <Button disabled={chosenCount === 0 || save.isPending} onClick={submit}>
              <Save /> Save mappings to chart of accounts
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
