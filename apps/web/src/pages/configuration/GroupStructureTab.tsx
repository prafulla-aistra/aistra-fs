import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type {
  ConsolidationLevelDto,
  FinancialYearDto,
  GroupStructureDto,
  GroupTreeNode,
} from '@finance-close/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, Field, Input, Select } from '@/components/ui/form';
import { Dialog, Table, Td, Th } from '@/components/ui/overlay';
import { Skeleton } from '@/components/ui/skeleton';
import { api, errorMessage } from '@/lib/api';
import { toast } from '@/lib/toast';
import { TbcBadge } from './common';
import { ConfigPage, EditButton } from './ConfigPage';
import { useCurrencies } from './hooks';

const pctText = (v: string | null) =>
  v === null ? '' : `${Number(v).toLocaleString('en-GB', { maximumFractionDigits: 4 })}%`;

/** Org chart (effective group %), consolidation levels with NCI, as at a chosen month. */
export function GroupStructureTab() {
  const years = useQuery({
    queryKey: ['config', 'financial-years'],
    queryFn: () => api.get<FinancialYearDto[]>('/config/financial-years'),
  });
  const months = useMemo(
    () =>
      (years.data ?? [])
        .flatMap((y) => y.periods.filter((p) => p.type === 'MONTHLY'))
        .sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [years.data],
  );
  const [asAt, setAsAt] = useState<string>('');
  const s = useQuery({
    queryKey: ['config', 'group-structure', asAt],
    queryFn: () =>
      api.get<GroupStructureDto>(`/config/group-structure${asAt ? `?asAt=${asAt}` : ''}`),
  });
  const [editing, setEditing] = useState<ConsolidationLevelDto | null>(null);
  const [prepares, setPrepares] = useState<{
    code: string;
    name: string;
    prepares: boolean;
  } | null>(null);
  const count = (n: GroupTreeNode | null): number =>
    n ? 1 + n.children.reduce((t, c) => t + count(c), 0) : 0;
  const selected = asAt || s.data?.asAt || '';

  return (
    <ConfigPage
      title="Group structure"
      purpose="Who owns whom, the effective group %, and the consolidation levels derived from it."
      count={
        s.data?.tree
          ? `${count(s.data.tree)} entities · ${s.data.levels.length} consolidation levels`
          : null
      }
      action={
        <div className="w-56">
          <Field label="Structure as at" htmlFor="as-at">
            <Select id="as-at" value={selected} onChange={(e) => setAsAt(e.target.value)}>
              {!months.some((m) => m.startDate === selected) && selected && (
                <option value={selected}>{selected.slice(0, 7)}</option>
              )}
              {months.map((m) => (
                <option key={m.id} value={m.startDate}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      }
    >
      {s.error && <Alert>{errorMessage(s.error)}</Alert>}
      {!s.data ? (
        <Skeleton className="h-96 w-full" />
      ) : s.data.issues.length > 0 ? (
        <Alert>
          The group structure is not valid:
          <ul className="mt-1 list-disc pl-5">
            {s.data.issues.map((i) => (
              <li key={i.message}>{i.message}</li>
            ))}
          </ul>
        </Alert>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Organisation chart</CardTitle>
              <CardDescription>
                % held by the parent, and the effective group % held by the ultimate parent. Click
                an entity to open it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {s.data.tree && (
                <>
                  <div className="hidden overflow-x-auto pb-2 md:block">
                    <OrgChart node={s.data.tree} />
                  </div>
                  <ul className="space-y-1 md:hidden">
                    <IndentedNode node={s.data.tree} depth={0} />
                  </ul>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Consolidation levels</CardTitle>
              <CardDescription>
                Run bottom-up; a level starts only when every level below it is finalised.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <thead>
                  <tr>
                    <Th>Level</Th>
                    <Th>Parent</Th>
                    <Th>Level currency</Th>
                    <Th>Members</Th>
                    <Th>NCI arises for</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {s.data.levels.map((l) => (
                    <tr key={l.level} className="align-top">
                      <Td className="font-medium whitespace-nowrap">
                        L{l.level} {l.name}
                      </Td>
                      <Td>{l.parentLegalName}</Td>
                      <Td className="whitespace-nowrap">
                        <span className="font-mono">{l.currency}</span>
                        {l.currencyOverridden && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            (default {l.defaultCurrency})
                          </span>
                        )}
                        <EditButton
                          variant="ghost"
                          size="icon"
                          className="ml-1 size-7"
                          aria-label={`Change L${l.level} currency`}
                          onClick={() => setEditing(l)}
                        >
                          <Pencil className="size-3.5" />
                        </EditButton>
                      </Td>
                      <Td className="text-sm">
                        {l.members.map((m) => (
                          <div key={m.code}>
                            {m.legalName}{' '}
                            <span className="font-mono text-xs text-muted-foreground">
                              {m.functionalCurrency}
                            </span>
                          </div>
                        ))}
                      </Td>
                      <Td className="text-sm">
                        {l.nci.length === 0 ? (
                          <span className="text-muted-foreground">None (wholly owned)</span>
                        ) : (
                          l.nci.map((n) => (
                            <div key={n.entityCode}>
                              {n.name} <strong>{pctText(n.nciPct)}</strong>
                            </div>
                          ))
                        )}
                      </Td>
                      <Td className="text-right">
                        {l.parentCode !== s.data!.tree?.code && (
                          <EditButton
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground"
                            title={`Consolidate ${l.name}'s members directly in the next level up instead`}
                            onClick={() =>
                              setPrepares({ code: l.parentCode, name: l.name, prepares: false })
                            }
                          >
                            Not a level
                          </EditButton>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {s.data.notLevels.length > 0 && (
                <div className="mt-3 space-y-1.5 rounded-md border bg-muted/50 px-3 py-2 text-sm">
                  <p className="font-medium text-ink">Not consolidation levels</p>
                  {s.data.notLevels.map((n) => (
                    <div key={n.code} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {n.legalName}{' '}
                        <span className="text-muted-foreground">
                          — its subsidiaries are consolidated directly in
                          {n.consolidatedIn
                            ? ` the ${n.consolidatedIn} level`
                            : ' the next level up'}
                          .
                        </span>
                      </span>
                      <EditButton
                        size="sm"
                        variant="outline"
                        onClick={() => setPrepares({ code: n.code, name: n.name, prepares: true })}
                      >
                        Make it a level
                      </EditButton>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
      {editing && <LevelCurrencyDialog level={editing} onClose={() => setEditing(null)} />}
      {prepares && <LevelPreparesDialog target={prepares} onClose={() => setPrepares(null)} />}
    </ConfigPage>
  );
}

function EntityBox({ node }: { node: GroupTreeNode }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(`/configuration/entities/${node.code}`)}
      className="w-48 rounded-lg border bg-card px-3 py-2 text-left shadow-sm transition-colors hover:border-primary hover:bg-mint/40"
    >
      <p className="text-sm leading-tight font-semibold">{node.legalName}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        <span className="font-mono">{node.code}</span> · {node.functionalCurrency}
      </p>
      <p className="mt-1 text-xs">
        {node.heldByParentPct !== null && <>Held {pctText(node.heldByParentPct)} · </>}
        Group <strong>{pctText(node.effectiveGroupPct)}</strong>
      </p>
      {node.toBeConfirmed && (
        <span className="mt-1 inline-block">
          <TbcBadge />
        </span>
      )}
    </button>
  );
}

/** Top-down tree: boxes joined by lines (CSS borders on each child's top edge). */
function OrgChart({ node }: { node: GroupTreeNode }) {
  return (
    <div className="flex flex-col items-center">
      <EntityBox node={node} />
      {node.children.length > 0 && (
        <>
          <div className="h-5 w-px bg-border" aria-hidden />
          <div className="flex">
            {node.children.map((c, i) => (
              <div key={c.code} className="relative flex flex-col items-center px-3">
                {/* horizontal connector across siblings */}
                {node.children.length > 1 && (
                  <div
                    aria-hidden
                    className="absolute top-0 h-px bg-border"
                    style={{
                      left: i === 0 ? '50%' : 0,
                      right: i === node.children.length - 1 ? '50%' : 0,
                    }}
                  />
                )}
                <div className="h-5 w-px bg-border" aria-hidden />
                <OrgChart node={c} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function IndentedNode({ node, depth }: { node: GroupTreeNode; depth: number }) {
  return (
    <>
      <li style={{ paddingLeft: `${depth * 1.25}rem` }} className="text-sm">
        {depth > 0 && '└ '}
        <Link to={`/configuration/entities/${node.code}`} className="font-medium">
          {node.legalName}
        </Link>{' '}
        <span className="text-xs text-muted-foreground">
          {node.code} · {node.functionalCurrency}
          {node.heldByParentPct !== null && ` · ${pctText(node.heldByParentPct)}`} · group{' '}
          {pctText(node.effectiveGroupPct)}
        </span>
      </li>
      {node.children.map((c) => (
        <IndentedNode key={c.code} node={c} depth={depth + 1} />
      ))}
    </>
  );
}

/** Make a parent a consolidation level of its own, or consolidate it in the next level up. */
function LevelPreparesDialog({
  target,
  onClose,
}: {
  target: { code: string; name: string; prepares: boolean };
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api.put<GroupStructureDto>(`/config/levels/${target.code}/prepares`, {
        prepares: target.prepares,
        reason,
      }),
    onSuccess: async () => {
      toast(
        target.prepares
          ? `${target.name} is a consolidation level again.`
          : `${target.name} is no longer a consolidation level.`,
      );
      await qc.invalidateQueries({ queryKey: ['config'] });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={target.prepares ? `Make ${target.name} a level` : `${target.name}: not a level`}
      description={
        target.prepares
          ? `${target.name} will prepare its own consolidation of its subsidiaries again. New consolidation tasks use the new levels; existing ones keep theirs.`
          : `${target.name} and its subsidiaries will be consolidated directly in the next level up, with the eliminations done there. New consolidation tasks use the new levels; existing ones keep theirs.`
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending || reason.trim().length < 3}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
        </>
      }
    >
      {save.error && <Alert className="mb-3">{errorMessage(save.error)}</Alert>}
      <Field label="Reason" htmlFor="level-prepares-reason">
        <Input
          id="level-prepares-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
    </Dialog>
  );
}

function LevelCurrencyDialog({
  level,
  onClose,
}: {
  level: ConsolidationLevelDto;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const currencies = useCurrencies();
  const [currency, setCurrency] = useState(level.currency);
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api.put<GroupStructureDto>(`/config/levels/${level.parentCode}/currency`, {
        currency: currency === level.defaultCurrency ? null : currency,
        reason,
      }),
    onSuccess: async () => {
      toast(`L${level.level} ${level.name}: level currency ${currency}.`);
      await qc.invalidateQueries({ queryKey: ['config'] });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={`L${level.level} ${level.name} — level currency`}
      description={`Default: ${level.defaultCurrency} (the parent's reporting currency). New CFS tasks use the currency set here.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={reason.trim().length < 3 || save.isPending}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        <Field label="Level currency" htmlFor="lvl-ccy">
          <Select id="lvl-ccy" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {(currencies.data ?? [])
              .filter((c) => c.isActive)
              .map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                  {c.code === level.defaultCurrency ? ' (default)' : ''}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Reason (required)" htmlFor="lvl-reason">
          <Input
            id="lvl-reason"
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}
