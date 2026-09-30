import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleX, Pencil } from 'lucide-react';
import { useState } from 'react';
import type { EntityStatementsDto, LineNoteDto, NoteAccountDto } from '@finance-close/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/form';
import { Dialog, Table, Td, Th } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import { drCr, statementAmount } from '@/lib/format';
import { toast } from '@/lib/toast';
import { TitleBlock } from './StatementView';
import { indianUnits } from './units';

function EditableNote({
  taskId,
  entityCode,
  kind,
  title,
  text,
  extra,
  badge,
  canEdit,
}: {
  taskId: string;
  entityCode: string;
  kind: 'NOTE1' | 'NOTE2';
  title: string;
  text: string;
  extra?: React.ReactNode;
  badge?: React.ReactNode;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const save = useMutation({
    mutationFn: () =>
      api.put<void>(`/tasks/${taskId}/entities/${entityCode}/statement-notes`, {
        kind,
        text: draft,
      }),
    onSuccess: async () => {
      toast(`${title} saved.`);
      setEditing(false);
      await qc.invalidateQueries({ queryKey: ['statements', taskId, entityCode] });
    },
  });
  return (
    <article className="note space-y-2" id={`note-${kind === 'NOTE1' ? 1 : 2}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-semibold text-ink">{title}</h4>
        {badge}
        {canEdit && !editing && (
          <Button
            variant="ghost"
            size="sm"
            className="no-print"
            onClick={() => {
              setDraft(text);
              setEditing(true);
            }}
          >
            <Pencil /> Edit
          </Button>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          {save.error && <Alert>{errorMessage(save.error)}</Alert>}
          <textarea
            aria-label={title}
            className="min-h-48 w-full rounded-md border bg-background p-3 text-sm"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={save.isPending || !draft.trim()}
              onClick={() => save.mutate()}
            >
              Save note
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2 text-sm whitespace-pre-line">{text}</div>
      )}
      {extra}
    </article>
  );
}

function TbDialog({
  a,
  d,
  onClose,
}: {
  a: NoteAccountDto;
  d: EntityStatementsDto;
  onClose: () => void;
}) {
  return (
    <Dialog open onClose={onClose} title={`TB account ${a.code}`} description={a.name}>
      {a.tb ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm tabular-nums">
          <dt className="text-muted-foreground">Trial balance ({a.tb.functionalCurrency})</dt>
          <dd>{drCr(a.tb.functional)}</dd>
          <dt className="text-muted-foreground">FSLI</dt>
          <dd className="font-mono text-xs">{a.fsliCode}</dd>
          {a.counterpartyCode && (
            <>
              <dt className="text-muted-foreground">Counterparty</dt>
              <dd>
                {a.counterpartyCode} – {a.counterpartyName}
              </dd>
            </>
          )}
          {a.tb.translated !== null && (
            <>
              <dt className="text-muted-foreground">Rate ({a.tb.basisLabel})</dt>
              <dd>{a.tb.rate ?? '—'}</dd>
              <dt className="text-muted-foreground">Translated ({d.selection.currency})</dt>
              <dd>{drCr(a.tb.translated)}</dd>
            </>
          )}
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">
          Not in this period's trial balance (comparative only).
        </p>
      )}
    </Dialog>
  );
}

function LineNote({ n, d }: { n: LineNoteDto; d: EntityStatementsDto }) {
  const [tb, setTb] = useState<NoteAccountDto | null>(null);
  const indian = indianUnits(d);
  const hasComparative = d.header.noComparative === null;
  const amt = (v: string | null) => statementAmount(v, indian);
  return (
    <article
      className="note space-y-2"
      id={`note-${n.number}`}
      aria-label={`Note ${n.number} ${n.label}`}
    >
      <h4 className="font-semibold text-ink">
        Note {n.number} · {n.label}
      </h4>
      <Table>
        <thead>
          <tr>
            <Th>Account</Th>
            <Th>Name</Th>
            <Th className="text-right">{d.header.periodLabel}</Th>
            {hasComparative && <Th className="text-right">{d.header.comparativeLabel}</Th>}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {n.accounts.map((a) => (
            <tr key={`${a.code}-${a.fsliCode}`}>
              <Td className="font-mono text-xs">{a.code}</Td>
              <Td>
                {a.name}
                {a.counterpartyCode && (
                  <span className="text-muted-foreground">
                    {' '}
                    ({a.counterpartyCode} – {a.counterpartyName})
                  </span>
                )}
              </Td>
              <Td className="text-right">
                <button
                  type="button"
                  className="hover:text-primary hover:underline"
                  onClick={() => setTb(a)}
                  title="Show the TB account"
                >
                  {amt(a.current)}
                </button>
              </Td>
              {hasComparative && <Td className="text-right">{amt(a.comparative)}</Td>}
            </tr>
          ))}
          {n.computed.map((c) => (
            <tr key={c.fsliCode} className="italic">
              <Td className="font-mono text-xs">{c.fsliCode}</Td>
              <Td>{c.label} (computed)</Td>
              <Td className="text-right">{amt(c.current)}</Td>
              {hasComparative && <Td className="text-right">{amt(c.comparative)}</Td>}
            </tr>
          ))}
          <tr className="font-semibold">
            <Td />
            <Td>Total</Td>
            <Td className="text-right whitespace-nowrap">
              {amt(n.total.current)}
              {n.ties.current ? (
                <CircleCheck
                  className="ml-1 inline size-4 text-success"
                  aria-label="Agrees to the face"
                />
              ) : (
                <CircleX
                  className="ml-1 inline size-4 text-destructive"
                  aria-label={`Does not agree to the face (${amt(n.face.current)})`}
                />
              )}
            </Td>
            {hasComparative && (
              <Td className="text-right whitespace-nowrap">
                {amt(n.total.comparative)}
                {n.ties.comparative !== null &&
                  (n.ties.comparative ? (
                    <CircleCheck
                      className="ml-1 inline size-4 text-success"
                      aria-label="Comparative agrees to the face"
                    />
                  ) : (
                    <CircleX
                      className="ml-1 inline size-4 text-destructive"
                      aria-label="Comparative does not agree to the face"
                    />
                  ))}
              </Td>
            )}
          </tr>
        </tbody>
      </Table>
      {tb && <TbDialog a={tb} d={d} onClose={() => setTb(null)} />}
    </article>
  );
}

export function NotesView({ d, taskId }: { d: EntityStatementsDto; taskId: string }) {
  const n = d.notes;
  const indian = indianUnits(d);
  const hasComparative = d.header.noComparative === null;
  const amt = (v: string) => statementAmount(v, indian);
  return (
    <section
      className="statement-page space-y-8 rounded-lg border bg-card p-6"
      aria-label="Notes to accounts"
    >
      <TitleBlock d={d} title={`Notes to the financial statements – ${d.header.periodLabel}`} />
      <EditableNote
        taskId={taskId}
        entityCode={d.entity.code}
        kind="NOTE1"
        title="Note 1 · Corporate information and basis of preparation"
        text={n.note1.text}
        canEdit={d.canEdit}
        badge={
          <Badge variant={n.note1.edited ? 'outline' : 'warning'}>
            {n.note1.edited
              ? `Edited${n.note1.updatedBy ? ` by ${n.note1.updatedBy}` : ''}`
              : 'Auto-drafted from the entity master'}
          </Badge>
        }
        extra={n.note1.translation && <p className="text-sm">{n.note1.translation}</p>}
      />
      <EditableNote
        taskId={taskId}
        entityCode={d.entity.code}
        kind="NOTE2"
        title="Note 2 · Significant accounting policies"
        text={n.note2.text}
        canEdit={d.canEdit}
        badge={
          <>
            <Badge variant="warning">Draft – to be reviewed</Badge>
            {n.note2.carriedFrom && (
              <Badge variant="outline">Carried forward from {n.note2.carriedFrom}</Badge>
            )}
          </>
        }
      />
      {n.lines.map((l) => (
        <LineNote key={l.number} n={l} d={d} />
      ))}
      {n.intercompany && (
        <article className="note space-y-2" id={`note-${n.intercompany.number}`}>
          <h4 className="font-semibold text-ink">
            Note {n.intercompany.number} · {n.intercompany.label}
          </h4>
          <Table aria-label="Intercompany balances">
            <thead>
              <tr>
                <Th>Counterparty</Th>
                {(['Receivable', 'Payable', 'Revenue', 'Charges'] as const).map((h) => (
                  <Th key={h} className="text-right">
                    {h}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {n.intercompany.rows.map((r) => (
                <tr key={r.counterpartyCode}>
                  <Td>
                    {r.counterpartyCode} – {r.counterpartyName}
                  </Td>
                  {(['receivable', 'payable', 'revenue', 'charges'] as const).map((k) => (
                    <Td key={k} className="text-right">
                      {amt(r.current[k])}
                      {hasComparative && r.comparative && (
                        <div className="text-xs text-muted-foreground">
                          {d.header.comparativeLabel}: {amt(r.comparative[k])}
                        </div>
                      )}
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        </article>
      )}
      {n.rates && (
        <article className="note space-y-2" id={`note-${n.rates.number}`}>
          <h4 className="font-semibold text-ink">
            Note {n.rates.number} · Exchange rates used ({n.rates.currencyPair})
          </h4>
          <Table>
            <thead>
              <tr>
                <Th>Rate</Th>
                <Th className="text-right">{d.header.periodLabel}</Th>
                {n.rates.comparative && <Th className="text-right">{d.header.comparativeLabel}</Th>}
              </tr>
            </thead>
            <tbody className="font-mono text-xs tabular-nums">
              {(['opening', 'closing', 'average', 'historical'] as const).map((k) => (
                <tr key={k}>
                  <Td className="font-sans text-sm capitalize">{k}</Td>
                  <Td className="text-right">{n.rates!.current[k] ?? '—'}</Td>
                  {n.rates!.comparative && (
                    <Td className="text-right">{n.rates!.comparative[k] ?? '—'}</Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        </article>
      )}
    </section>
  );
}
