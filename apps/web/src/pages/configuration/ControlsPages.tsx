import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import {
  CHECK_SEVERITY_LABELS,
  type ApprovalRuleDto,
  type ApprovalsDto,
  type CheckSeverityCode,
  type ControlCheckDto,
} from '@finance-close/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, Checkbox, Field, Input, Select } from '@/components/ui/form';
import { Dialog, Table, Td, Th } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import { TbcBadge } from './common';
import { ConfigPage, EditButton } from './ConfigPage';
import { NO_CONFIG_ACCESS, useCanEditConfig, useEntities } from './hooks';

const SEVERITY_VARIANT: Record<CheckSeverityCode, 'destructive' | 'warning' | 'neutral'> = {
  BLOCKING: 'destructive',
  WARNING: 'warning',
  INFO: 'neutral',
};

/** Configuration → Control checks: the register run before a submission (page 8). */
export function ControlChecksPage() {
  const [st, setSt] = useState<'SFS' | 'CFS'>('SFS');
  const checks = useQuery({
    queryKey: ['config', 'control-checks', st],
    queryFn: () => api.get<ControlCheckDto[]>(`/config/control-checks?statementType=${st}`),
  });
  const [editing, setEditing] = useState<ControlCheckDto | null>(null);
  return (
    <ConfigPage
      title="Control checks"
      purpose={
        st === 'SFS'
          ? 'Checks run on every standalone entity before it can be submitted. Blocking checks stop the submission; warnings need an acknowledgement.'
          : 'Checks run on every consolidation level before it can be submitted. Blocking checks stop the submission; warnings need an acknowledgement.'
      }
      action={
        <div role="tablist" aria-label="Statement type" className="flex gap-1">
          {(['SFS', 'CFS'] as const).map((x) => (
            <Button
              key={x}
              role="tab"
              aria-selected={st === x}
              size="sm"
              variant={st === x ? 'default' : 'outline'}
              onClick={() => setSt(x)}
            >
              {x === 'SFS' ? 'Standalone (SFS)' : 'Consolidation (CFS)'}
            </Button>
          ))}
        </div>
      }
      count={
        checks.data
          ? `${checks.data.filter((c) => c.isActive).length} active of ${checks.data.length}`
          : null
      }
    >
      {checks.error && <Alert>{errorMessage(checks.error)}</Alert>}
      <Card>
        <CardContent className="pt-6">
          <Table>
            <thead>
              <tr>
                <Th>Check</Th>
                <Th>Severity</Th>
                <Th className="text-right">Threshold</Th>
                <Th>Active</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {checks.data?.map((c) => (
                <tr key={c.code} className={c.isActive ? undefined : 'text-muted-foreground'}>
                  <Td>
                    <div className="font-medium">
                      {c.name}{' '}
                      {c.toBeConfirmed && <TbcBadge note="Proposed default – to be confirmed" />}
                    </div>
                    <div className="text-xs text-muted-foreground">{c.description}</div>
                  </Td>
                  <Td>
                    <Badge variant={SEVERITY_VARIANT[c.severity]}>
                      {CHECK_SEVERITY_LABELS[c.severity]}
                    </Badge>
                  </Td>
                  <Td className="text-right tabular-nums">
                    {c.thresholdUnit ? (c.threshold ?? '0') : '–'}
                    {c.thresholdUnit === 'COUNT' && c.threshold !== null ? ' items' : ''}
                  </Td>
                  <Td>{c.isActive ? 'Yes' : 'No'}</Td>
                  <Td className="text-right">
                    <EditButton variant="ghost" size="sm" onClick={() => setEditing(c)}>
                      Edit
                    </EditButton>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardContent>
      </Card>
      {editing && <CheckDialog check={editing} onClose={() => setEditing(null)} />}
    </ConfigPage>
  );
}

function CheckDialog({ check, onClose }: { check: ControlCheckDto; onClose: () => void }) {
  const qc = useQueryClient();
  const [severity, setSeverity] = useState<CheckSeverityCode>(check.severity);
  const [threshold, setThreshold] = useState(check.threshold ?? '');
  const [isActive, setActive] = useState(check.isActive);
  const [tbc, setTbc] = useState(check.toBeConfirmed);
  const valid =
    !check.thresholdUnit || threshold === '' || /^\d{1,12}(\.\d{1,4})?$/.test(threshold);
  const save = useMutation({
    mutationFn: () =>
      api.put(`/config/control-checks/${check.code}`, {
        severity,
        threshold: check.thresholdUnit && threshold !== '' ? threshold : null,
        isActive,
        toBeConfirmed: tbc,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['config', 'control-checks'] });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={check.name}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{check.description}</p>
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        <Field label="Severity" htmlFor="c-sev">
          <Select
            id="c-sev"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as CheckSeverityCode)}
          >
            {(['BLOCKING', 'WARNING', 'INFO'] as const).map((s) => (
              <option key={s} value={s}>
                {CHECK_SEVERITY_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        {check.thresholdUnit && (
          <Field
            label={check.thresholdUnit === 'AMOUNT' ? 'Tolerance (amount)' : 'Allowed items'}
            htmlFor="c-thr"
          >
            <Input
              id="c-thr"
              inputMode="decimal"
              value={threshold}
              aria-invalid={!valid}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={isActive} onChange={(e) => setActive(e.target.checked)} /> Active
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={tbc} onChange={(e) => setTbc(e.target.checked)} /> To be confirmed
        </label>
      </div>
    </Dialog>
  );
}

/** Configuration → Approvals: review levels, named reviewers / approvers, segregation of duties. */
export function ApprovalsPage() {
  const canEdit = useCanEditConfig();
  const data = useQuery({
    queryKey: ['config', 'approvals'],
    queryFn: () => api.get<ApprovalsDto>('/config/approvals'),
  });
  const [editing, setEditing] = useState<Partial<ApprovalRuleDto> | null>(null);
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/config/approvals/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['config', 'approvals'] }),
  });
  const rules = data.data?.rules ?? [];
  return (
    <ConfigPage
      title="Approvals"
      purpose="How many people must sign off a statement before it is finalised, and who may. The most specific rule applies: entity and period type, then entity, then period type, then the default. For consolidated statements the entity is the level's parent."
      count={data.data ? `${rules.length} rule${rules.length === 1 ? '' : 's'}` : null}
      action={
        <EditButton
          size="sm"
          onClick={() =>
            setEditing({
              statementType: 'SFS',
              entityCode: null,
              periodType: null,
              reviewLevels: 1,
              reviewers: [],
              approvers: [],
            })
          }
        >
          <Plus /> Add override
        </EditButton>
      }
    >
      {(data.error || remove.error) && <Alert>{errorMessage(data.error ?? remove.error)}</Alert>}
      <Card>
        <CardContent className="pt-6">
          <Table>
            <thead>
              <tr>
                <Th>Statement</Th>
                <Th>Applies to</Th>
                <Th>Period type</Th>
                <Th>Review levels</Th>
                <Th>Reviewers</Th>
                <Th>Approvers</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <Td>{r.statementType === 'SFS' ? 'Standalone' : 'Consolidated'}</Td>
                  <Td>
                    {r.entityCode
                      ? `${r.entityCode} · ${r.entityName ?? ''}`
                      : r.periodType
                        ? 'All entities'
                        : 'All entities (default)'}
                  </Td>
                  <Td>{r.periodType ? PERIOD_LABEL[r.periodType] : 'Any'}</Td>
                  <Td>{r.reviewLevels === 2 ? '2 (reviewer, then approver)' : '1 (reviewer)'}</Td>
                  <Td>
                    {r.reviewers.length
                      ? r.reviewers.map((u) => u.name).join(', ')
                      : 'Anyone with the review permission'}
                  </Td>
                  <Td>
                    {r.reviewLevels === 1
                      ? '–'
                      : r.approvers.length
                        ? r.approvers.map((u) => u.name).join(', ')
                        : 'Anyone with the review permission'}
                  </Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      <EditButton variant="ghost" size="sm" onClick={() => setEditing(r)}>
                        Edit
                      </EditButton>
                      {(r.entityCode || r.periodType) && (
                        <EditButton
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(r.id)}
                        >
                          Remove
                        </EditButton>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Segregation of duties</CardTitle>
          <CardDescription>Always enforced by the system; not configurable.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {(data.data?.segregation ?? []).map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
      {editing && data.data && (
        <RuleDialog
          rule={editing}
          data={data.data}
          canEdit={canEdit}
          onClose={() => setEditing(null)}
        />
      )}
    </ConfigPage>
  );
}

const PERIOD_LABEL = { MONTHLY: 'Monthly', QUARTERLY: 'Quarterly', ANNUAL: 'Annual' } as const;

function RuleDialog({
  rule,
  data,
  canEdit,
  onClose,
}: {
  rule: Partial<ApprovalRuleDto>;
  data: ApprovalsDto;
  canEdit: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const entities = useEntities();
  const [statementType, setType] = useState<'SFS' | 'CFS'>(rule.statementType ?? 'SFS');
  const [entityCode, setEntity] = useState<string | null>(rule.entityCode ?? null);
  const [periodType, setPeriodType] = useState<ApprovalRuleDto['periodType']>(
    rule.periodType ?? null,
  );
  const [levels, setLevels] = useState<1 | 2>(rule.reviewLevels ?? 1);
  const [reviewerIds, setReviewers] = useState<string[]>(rule.reviewers?.map((u) => u.id) ?? []);
  const [approverIds, setApprovers] = useState<string[]>(rule.approvers?.map((u) => u.id) ?? []);
  const isNew = !rule.id;
  const perm = statementType === 'SFS' ? 'SFS_REVIEW' : 'CFS_REVIEW';
  const candidates = data.candidates.filter((c) => c.permissions.includes(perm));
  const overlap =
    levels === 2 &&
    reviewerIds.length === 1 &&
    approverIds.length === 1 &&
    reviewerIds[0] === approverIds[0];
  const save = useMutation({
    mutationFn: () =>
      api.put('/config/approvals', {
        statementType,
        entityCode,
        periodType,
        reviewLevels: levels,
        reviewerIds,
        approverIds: levels === 2 ? approverIds : [],
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['config', 'approvals'] });
      onClose();
    },
  });
  const picker = (label: string, value: string[], set: (v: string[]) => void) => (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium">{label}</legend>
      <p className="text-xs text-muted-foreground">
        None ticked: anyone with the review permission and the entity in scope.
      </p>
      <div className="max-h-40 space-y-1 overflow-auto rounded border p-2">
        {candidates.map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={value.includes(c.id)}
              onChange={(e) =>
                set(e.target.checked ? [...value, c.id] : value.filter((x) => x !== c.id))
              }
            />
            {c.name} <span className="text-xs text-muted-foreground">{c.email}</span>
          </label>
        ))}
        {candidates.length === 0 && (
          <p className="text-sm text-muted-foreground">No users have {perm}.</p>
        )}
      </div>
    </fieldset>
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title={
        isNew
          ? 'Add override'
          : rule.entityCode || rule.periodType
            ? `Approvals for ${rule.entityCode ?? 'all entities'}${rule.periodType ? `, ${PERIOD_LABEL[rule.periodType].toLowerCase()} periods` : ''}`
            : 'Default approvals'
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              !canEdit || save.isPending || overlap || (isNew && !entityCode && !periodType)
            }
            title={canEdit ? undefined : NO_CONFIG_ACCESS}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        {isNew && (
          <div className="grid grid-cols-3 gap-3">
            <Field label="Statement" htmlFor="r-type">
              <Select
                id="r-type"
                value={statementType}
                onChange={(e) => setType(e.target.value as 'SFS' | 'CFS')}
              >
                <option value="SFS">Standalone</option>
                <option value="CFS">Consolidated</option>
              </Select>
            </Field>
            <Field label="Entity" htmlFor="r-entity">
              <Select
                id="r-entity"
                value={entityCode ?? ''}
                onChange={(e) => setEntity(e.target.value || null)}
              >
                <option value="">All entities</option>
                {entities.data?.map((e) => (
                  <option key={e.code} value={e.code}>
                    {e.code} · {e.shortName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Period type" htmlFor="r-period">
              <Select
                id="r-period"
                value={periodType ?? ''}
                onChange={(e) =>
                  setPeriodType((e.target.value || null) as ApprovalRuleDto['periodType'])
                }
              >
                <option value="">Any</option>
                <option value="MONTHLY">Monthly</option>
                <option value="QUARTERLY">Quarterly</option>
                <option value="ANNUAL">Annual</option>
              </Select>
            </Field>
          </div>
        )}
        <Field label="Review levels" htmlFor="r-levels">
          <Select
            id="r-levels"
            value={levels}
            onChange={(e) => setLevels(Number(e.target.value) as 1 | 2)}
          >
            <option value={1}>1 – a reviewer approves and finalises</option>
            <option value={2}>2 – a reviewer, then a different approver</option>
          </Select>
        </Field>
        {picker('Reviewers', reviewerIds, setReviewers)}
        {levels === 2 && picker('Approvers', approverIds, setApprovers)}
        {overlap && <Alert>The reviewer and the approver must be different people.</Alert>}
      </div>
    </Dialog>
  );
}
