import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { EntityDetailDto, EntityDto } from '@finance-close/shared';
import { Button } from '@/components/ui/button';
import { Alert, Field, Input, Select } from '@/components/ui/form';
import { Dialog } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import { toast } from '@/lib/toast';

/** Deactivate (or reactivate) an entity, with a reason. The API refuses if it is in use. */
export function ActiveDialog({ entity, onClose }: { entity: EntityDto; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const action = entity.isActive ? 'deactivate' : 'reactivate';
  const save = useMutation({
    mutationFn: () =>
      api.post<EntityDetailDto>(`/config/entities/${entity.code}/${action}`, { reason }),
    onSuccess: async () => {
      toast(`${entity.code} ${entity.isActive ? 'deactivated' : 'reactivated'}.`);
      await qc.invalidateQueries({ queryKey: ['config'] });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${entity.isActive ? 'Deactivate' : 'Reactivate'} ${entity.code} — ${entity.legalName}`}
      description={
        entity.isActive
          ? 'Deactivated entities stay visible under the status filter and are never deleted. Not possible while the entity is in an open task or has active subsidiaries.'
          : 'The entity becomes available for new tasks again.'
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={entity.isActive ? 'destructive' : 'default'}
            disabled={reason.trim().length < 3 || save.isPending}
            onClick={() => save.mutate()}
          >
            {entity.isActive ? 'Deactivate' : 'Reactivate'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        <Field label="Reason (required)" htmlFor="active-reason">
          <Input
            id="active-reason"
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
        </Field>
      </div>
    </Dialog>
  );
}

const thisMonth = () => `${new Date().toISOString().slice(0, 7)}-01`;

/** Records a new ownership row (parent and % held) effective from a month. */
export function OwnershipDialog({
  entity,
  entities,
  onClose,
  onSaved,
}: {
  entity: EntityDto;
  entities: EntityDto[];
  onClose: () => void;
  onSaved?: (d: EntityDetailDto) => void;
}) {
  const qc = useQueryClient();
  const [parentCode, setParentCode] = useState<string | null>(entity.parentCode);
  const [pct, setPct] = useState(entity.heldByParentPct ?? '100');
  const [month, setMonth] = useState(thisMonth().slice(0, 7));
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api.post<EntityDetailDto>(`/config/entities/${entity.code}/ownership`, {
        parentCode,
        heldByParentPct: parentCode ? pct.trim() : null,
        effectiveFrom: `${month}-01`,
        reason,
      }),
    onSuccess: async (d) => {
      toast(`${entity.code}: ownership change recorded from ${month}.`);
      await qc.invalidateQueries({ queryKey: ['config'] });
      onSaved?.(d);
      onClose();
    },
  });
  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title={`Change ownership — ${entity.code} ${entity.legalName}`}
      description="Adds a new ownership row from the month you choose; earlier months keep the old parent and %. Finalised consolidations keep their snapshot."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={reason.trim().length < 3 || !/^\d{4}-\d{2}$/.test(month) || save.isPending}
            onClick={() => save.mutate()}
          >
            Record change
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {save.error && <Alert className="sm:col-span-2">{errorMessage(save.error)}</Alert>}
        <Field label="Parent entity" htmlFor="own-parent">
          <Select
            id="own-parent"
            value={parentCode ?? ''}
            onChange={(e) => setParentCode(e.target.value || null)}
          >
            <option value="">None — ultimate parent</option>
            {entities
              .filter((o) => o.code !== entity.code && o.isActive)
              .map((o) => (
                <option key={o.code} value={o.code}>
                  {o.code} — {o.legalName}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="% held by parent" htmlFor="own-pct" hint="Between 0.01 and 100.">
          <Input
            id="own-pct"
            inputMode="decimal"
            value={parentCode ? pct : ''}
            disabled={!parentCode}
            onChange={(e) => setPct(e.target.value)}
          />
        </Field>
        <Field label="Effective from (month)" htmlFor="own-month">
          <Input
            id="own-month"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </Field>
        <Field label="Reason (required)" htmlFor="own-reason">
          <Input
            id="own-reason"
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}
