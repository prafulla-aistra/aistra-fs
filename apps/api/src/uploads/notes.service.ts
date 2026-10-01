import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import type { EntityNote, Prisma } from '@prisma/client';
import {
  buildStatement,
  deriveTaskStatus,
  cellNumber,
  checkTable,
  Decimal,
  displaySign,
  type FigureMeasure,
  type FigureRef,
  figureValue,
  type FormatFsli,
  type FormatLine,
  fsliAmounts,
  groupAccounts,
  lineNote,
  type NoteBlock,
  numberNotes,
  type PeriodFigureSet,
  plainText,
  type RichNode,
  rollForwardBlocks,
  scaleAmount,
  type StatementAccount,
  type StatementUnit,
  staleNumbers,
  statementTitle,
  wordDiff,
} from '@finance-close/engine';
import {
  ApiErrorCode,
  AuditAction,
  type CatalogItemDto,
  ERP_LABELS,
  type EntityNotesDto,
  GAAP_LABELS,
  type NoteDto,
  type NoteSaveInput,
  type NotesStepDto,
  type PriorNoteDto,
  ROUNDING_NOTE,
  STATEMENT_UNITS,
  type StatementUnitCode,
  TASK_STEPS,
} from '@finance-close/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/session-user';
import { ApiError } from '../common/api-error';
import { canonicalJson } from '../common/canonical-json';
import { fromDbDate } from '../common/db-dates';
import { PrismaService } from '../prisma/prisma.service';
import { SubmissionGuard } from './submission-guard.service';
import { inScope } from '../tasks/tasks.service';
import { loadFormatLines, loadFslis } from './format-lines';
import {
  type EntityFigures,
  type PeriodFigures,
  StatementFiguresService,
} from './statement-figures';
import {
  assertEditable,
  assertViewable,
  isTaskLocked,
  loadStepTask,
  readOnlyReason,
  stepInclude,
  type StepTask,
} from './step-access';

type TaskEntityRow = StepTask['entities'][number];
type NoteRow = Pick<
  EntityNote,
  | 'id'
  | 'sortOrder'
  | 'kind'
  | 'title'
  | 'lineKeys'
  | 'mandatory'
  | 'status'
  | 'carriedFromId'
  | 'version'
  | 'updatedAt'
> & {
  blocks: NoteBlock[];
  updatedBy: string | null;
  reviewedBy: string | null;
};
const stepIndex = (code: string) => TASK_STEPS.findIndex((s) => s.code === code);
const MEASURES: FigureMeasure[] = ['current', 'comparative', 'variance', 'variancePct'];

/** Figures of one period in one currency, as the notes need them. */
interface PeriodView {
  accounts: StatementAccount[];
  amounts: Record<string, string>;
  /** "BS:key" → displayed line value. */
  rows: Record<string, string | null>;
  set: PeriodFigureSet;
}

interface Ctx {
  lines: FormatLine[];
  formatName: string;
  fslis: FormatFsli[];
  entityName: Map<string, string>;
  currency: string;
  unit: StatementUnitCode;
  cur: PeriodView | null;
  comp: PeriodView | null;
}

const lineKey = (l: { statement: string; key: string }) => `${l.statement}:${l.key}`;
const zero = (v: string | null | undefined) =>
  v === null || v === undefined || new Decimal(v).isZero();

function periodView(
  p: PeriodFigures | null,
  lines: FormatLine[],
  fslis: FormatFsli[],
): PeriodView | null {
  if (!p || p.status !== 'OK') return null;
  const { amounts } = fsliAmounts(p.accounts, fslis, p.fctr);
  const rows: Record<string, string | null> = {};
  for (const st of ['BS', 'PL'] as const)
    for (const r of buildStatement(lines, st, amounts, fslis).rows)
      rows[`${st}:${r.key}`] = r.value;
  const cls = new Map(fslis.map((f) => [f.code, f.class]));
  const signed = (code: string | null, v: string) => {
    const c = code ? cls.get(code) : undefined;
    return c ? new Decimal(v).times(displaySign(c)).toFixed(2) : new Decimal(v).toFixed(2);
  };
  const accounts: Record<string, string> = {};
  for (const a of p.accounts)
    accounts[a.code] = new Decimal(accounts[a.code] ?? '0')
      .plus(signed(a.fsliCode, a.amount))
      .toFixed(2);
  return {
    accounts: p.accounts,
    amounts,
    rows,
    set: {
      lines: Object.fromEntries(Object.entries(rows).filter(([, v]) => v !== null)) as Record<
        string,
        string
      >,
      fslis: Object.fromEntries(Object.entries(amounts).map(([k, v]) => [k, signed(k, v)])),
      accounts,
      subCaptions: {},
    },
  };
}

/** Text of a rich document with placeholders filled ("{legalName}" → the entity's name). */
function fillPlaceholders(node: RichNode, values: Record<string, string>): RichNode {
  if (node.type === 'text' && node.text)
    return { ...node, text: node.text.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m) };
  return node.content
    ? { ...node, content: node.content.map((c) => fillPlaceholders(c, values)) }
    : node;
}

/** Sub-caption tokens point at "<noteId>:<subCaptionId>": renamed when notes get new ids. */
function remapTokens(node: RichNode, ids: Map<string, string>): RichNode {
  if (node.type === 'figure' && node.attrs?.source === 'SUBCAPTION') {
    const [noteId, sub] = String(node.attrs.key).split(':');
    const next = ids.get(noteId ?? '');
    return next ? { ...node, attrs: { ...node.attrs, key: `${next}:${sub}` } } : node;
  }
  return node.content ? { ...node, content: node.content.map((c) => remapTokens(c, ids)) } : node;
}

const hasContent = (blocks: NoteBlock[]) =>
  blocks.some(
    (b) =>
      (b.type === 'TEXT' && plainText(b.doc).trim() !== '') ||
      (b.type === 'TABLE' &&
        b.rows.some((r) => Object.values(r.cells).some((c) => c.trim() !== ''))),
  );

/**
 * Task step "Notes" (after Statements, before Review): structured notes per task entity, rolled
 * forward from the entity's last finalised SFS (else started from the format's note templates),
 * with live figures, the stale-number check and review status. Every change is versioned and
 * audited; finalised entities are read-only.
 */
@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly figuresService: StatementFiguresService,
    @Optional() private readonly guard?: SubmissionGuard,
  ) {}

  // ---------------------------------------------------------------------------------------
  // Context: figures of the selected currency for the task format
  // ---------------------------------------------------------------------------------------

  private async context(
    task: StepTask,
    figures: EntityFigures,
    currency?: string,
    unit?: StatementUnitCode,
  ): Promise<Ctx> {
    const { format, lines } = await loadFormatLines(
      this.prisma,
      task.formatCode ?? 'STATUTORY',
      task.formatVersion,
    );
    const fslis = await loadFslis(this.prisma);
    const c = figures.currencies.find((x) => x.currency === currency) ?? figures.currencies[0]!;
    const entities = await this.prisma.entity.findMany({ select: { code: true, legalName: true } });
    return {
      lines,
      formatName: format.name,
      fslis,
      entityName: new Map(entities.map((e) => [e.code, e.legalName])),
      currency: c.currency,
      unit: unit ?? 'ACTUAL',
      cur: periodView(c.current, lines, fslis),
      comp: periodView(c.comparative, lines, fslis),
    };
  }

  /** The entity's most recent finalised SFS before this task's period (its task and notes). */
  private async priorFinalised(task: StepTask, entityCode: string) {
    const te = await this.prisma.taskEntity.findFirst({
      where: {
        entityCode,
        status: 'FINALISED',
        taskId: { not: task.id },
        task: { type: 'SFS', period: { endDate: { lt: task.period.startDate } } },
      },
      orderBy: { task: { period: { endDate: 'desc' } } },
    });
    if (!te) return null;
    const prior = await this.prisma.task.findUniqueOrThrow({
      where: { id: te.taskId },
      include: stepInclude,
    });
    const notes = await this.prisma.entityNote.findMany({
      where: { taskId: prior.id, entityCode },
      orderBy: { sortOrder: 'asc' },
    });
    return { task: prior, te: prior.entities.find((e) => e.entityCode === entityCode)!, notes };
  }

  private toRow(
    n: EntityNote & { updatedBy?: string | null; reviewedBy?: string | null },
  ): NoteRow {
    return {
      id: n.id,
      sortOrder: n.sortOrder,
      kind: n.kind,
      title: n.title,
      lineKeys: n.lineKeys,
      mandatory: n.mandatory,
      status: n.status,
      carriedFromId: n.carriedFromId,
      version: n.version,
      updatedAt: n.updatedAt,
      blocks: n.blocks as unknown as NoteBlock[],
      updatedBy: n.updatedBy ?? null,
      reviewedBy: n.reviewedBy ?? null,
    };
  }

  private async storedNotes(taskId: string, entityCode: string): Promise<NoteRow[]> {
    const rows = await this.prisma.entityNote.findMany({
      where: { taskId, entityCode },
      orderBy: { sortOrder: 'asc' },
    });
    const ids = [
      ...new Set(
        rows.flatMap((r) => [r.updatedById, r.reviewedById]).filter((x): x is string => !!x),
      ),
    ];
    const users = new Map(
      (
        await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      ).map((u) => [u.id, u.name]),
    );
    return rows.map((r) =>
      this.toRow({
        ...r,
        updatedBy: r.updatedById ? (users.get(r.updatedById) ?? null) : null,
        reviewedBy: r.reviewedById ? (users.get(r.reviewedById) ?? null) : null,
      }),
    );
  }

  /** A new note set: rolled forward from the last finalised period, else from the templates. */
  private async initialNotes(
    task: StepTask,
    te: TaskEntityRow,
    ctx: Ctx,
  ): Promise<{ notes: NoteRow[]; rolledFrom: string | null }> {
    const prior = await this.priorFinalised(task, te.entityCode);
    const now = new Date();
    let notes: NoteRow[];
    if (prior && prior.notes.length > 0) {
      const ids = new Map(prior.notes.map((n) => [n.id, randomUUID()]));
      notes = prior.notes.map((n, i) => ({
        id: ids.get(n.id)!,
        sortOrder: i + 1,
        kind: n.kind,
        title: n.title,
        lineKeys: n.lineKeys,
        mandatory: n.mandatory,
        status: 'CARRIED_FORWARD',
        carriedFromId: n.id,
        version: 1,
        updatedAt: now,
        blocks: rollForwardBlocks(n.blocks as unknown as NoteBlock[]).map((b) =>
          b.type === 'TEXT' ? { ...b, doc: remapTokens(b.doc, ids) } : b,
        ),
        updatedBy: null,
        reviewedBy: null,
      }));
    } else {
      const templates = await this.prisma.noteTemplate.findMany({
        where: { formatCode: task.formatCode ?? 'STATUTORY' },
        orderBy: { sortOrder: 'asc' },
      });
      const e = te.entity;
      const end = fromDbDate(task.period.endDate);
      const values: Record<string, string> = {
        legalName: e.legalName,
        country: e.country,
        functionalCurrency: e.functionalCurrency,
        gaap: GAAP_LABELS[e.gaap],
        erp: ERP_LABELS[e.erp],
        periodLabel: task.period.label,
        periodEnd: statementTitle('BS', task.period.type, end).replace('Balance sheet as at ', ''),
        periodSpan:
          task.period.type === 'MONTHLY'
            ? 'month'
            : task.period.type === 'QUARTERLY'
              ? 'quarter'
              : 'year',
      };
      notes = templates.map((t, i) => {
        const blocks = (t.defaultBlocks as unknown as NoteBlock[]).map((b) => ({
          ...structuredClone(b),
          id: randomUUID(),
          ...(b.type === 'TEXT' ? { doc: fillPlaceholders(b.doc, values) } : {}),
        })) as NoteBlock[];
        return {
          id: randomUUID(),
          sortOrder: i + 1,
          kind: t.kind,
          title: t.title,
          lineKeys: t.lineKeys,
          mandatory: t.mandatory,
          status: 'DRAFT',
          carriedFromId: null,
          version: 1,
          updatedAt: now,
          blocks:
            t.kind === 'LINE'
              ? [{ id: randomUUID(), type: 'FIGURES', subCaptions: [] }, ...blocks]
              : blocks,
          updatedBy: null,
          reviewedBy: null,
        };
      });
    }
    // Every statement line with a value has a line note.
    const linked = new Set(notes.flatMap((n) => n.lineKeys));
    for (const l of ctx.lines.filter((x) => x.type === 'LINE')) {
      const k = lineKey(l);
      if (linked.has(k) || (zero(ctx.cur?.rows[k]) && zero(ctx.comp?.rows[k]))) continue;
      notes.push({
        id: randomUUID(),
        sortOrder: notes.length + 1,
        kind: 'LINE',
        title: l.label,
        lineKeys: [k],
        mandatory: false,
        status: 'DRAFT',
        carriedFromId: null,
        version: 1,
        updatedAt: now,
        blocks: [{ id: randomUUID(), type: 'FIGURES', subCaptions: [] }],
        updatedBy: null,
        reviewedBy: null,
      });
    }
    return { notes, rolledFrom: prior && prior.notes.length > 0 ? prior.task.id : null };
  }

  /**
   * Demo seed: stores the initial note set of a task entity (from its stored figures) and
   * returns it, or null when it already has notes or no figures.
   */
  async storeInitialSet(task: StepTask, te: TaskEntityRow): Promise<NoteRow[] | null> {
    if (
      (await this.prisma.entityNote.count({
        where: { taskId: task.id, entityCode: te.entityCode },
      })) > 0
    )
      return null;
    const figures =
      (await this.figuresService.snapshot(task.id, te.entityCode)) ??
      (await this.figuresService.build(task, te));
    if (!figures) return null;
    const ctx = await this.context(task, figures);
    const { notes } = await this.initialNotes(task, te, ctx);
    await this.prisma.entityNote.createMany({
      data: notes.map((n) => ({
        id: n.id,
        taskId: task.id,
        entityCode: te.entityCode,
        sortOrder: n.sortOrder,
        kind: n.kind,
        title: n.title,
        lineKeys: n.lineKeys,
        mandatory: n.mandatory,
        status: n.status,
        blocks: n.blocks as unknown as Prisma.InputJsonValue,
        carriedFromId: n.carriedFromId,
      })),
    });
    return notes;
  }

  /** Stored notes; the first time (and when editable) the initial set is created and stored. */
  private async notesFor(
    user: AuthUser,
    task: StepTask,
    te: TaskEntityRow,
    ctx: Ctx,
    persist: boolean,
  ) {
    const stored = await this.storedNotes(task.id, te.entityCode);
    if (stored.length > 0) return stored;
    const { notes, rolledFrom } = await this.initialNotes(task, te, ctx);
    if (!persist) return notes;
    await this.prisma.$transaction(async (tx) => {
      await tx.entityNote.createMany({
        data: notes.map((n) => ({
          id: n.id,
          taskId: task.id,
          entityCode: te.entityCode,
          sortOrder: n.sortOrder,
          kind: n.kind,
          title: n.title,
          lineKeys: n.lineKeys,
          mandatory: n.mandatory,
          status: n.status,
          blocks: n.blocks as unknown as Prisma.InputJsonValue,
          carriedFromId: n.carriedFromId,
        })),
      });
      await tx.entityNoteVersion.createMany({
        data: notes.map((n) => ({
          noteId: n.id,
          version: 1,
          title: n.title,
          blocks: n.blocks as unknown as Prisma.InputJsonValue,
          status: n.status,
          editedById: user.id,
        })),
      });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.NotesRollForward,
          entityType: 'TASK_ENTITY',
          entityId: `${task.id}:${te.entityCode}`,
          oldValue: null,
          newValue: {
            task: task.number,
            entity: te.entityCode,
            from: rolledFrom ? 'last finalised period' : 'format templates',
            notes: notes.length,
          },
        },
        tx,
      );
    });
    return this.storedNotes(task.id, te.entityCode);
  }

  // ---------------------------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------------------------

  /** Sub-caption subtotals (unscaled, displayed signs) for live tokens. */
  private subCaptionSets(notes: NoteRow[], ctx: Ctx) {
    const sets: { cur: Record<string, string>; comp: Record<string, string> } = {
      cur: {},
      comp: {},
    };
    for (const n of notes)
      for (const b of n.blocks)
        if (b.type === 'FIGURES')
          for (const s of b.subCaptions) {
            const sum = (p: PeriodView | null) =>
              s.accounts
                .reduce((t, code) => t.plus(p?.set.accounts[code] ?? '0'), new Decimal(0))
                .toFixed(2);
            sets.cur[`${n.id}:${s.id}`] = sum(ctx.cur);
            if (ctx.comp) sets.comp[`${n.id}:${s.id}`] = sum(ctx.comp);
          }
    if (ctx.cur) ctx.cur.set.subCaptions = sets.cur;
    if (ctx.comp) ctx.comp.set.subCaptions = sets.comp;
  }

  private scale(ctx: Ctx, v: string | null) {
    return v === null ? null : scaleAmount(v, ctx.unit as StatementUnit);
  }

  private noteView(n: NoteRow, ctx: Ctx, stale: NoteDto['stale']): Omit<NoteDto, 'number'> {
    const figures: NoteDto['figures'] = {};
    const tables: NoteDto['tables'] = {};
    const faceOf = (p: PeriodView | null) =>
      p ? n.lineKeys.reduce((s, k) => s.plus(p.rows[k] ?? '0'), new Decimal(0)).toFixed(2) : null;
    const lineFslis = n.lineKeys.flatMap((k) => {
      const [st, key] = k.split(':');
      return ctx.lines.find((l) => l.statement === st && l.key === key)?.fslis ?? [];
    });
    for (const b of n.blocks) {
      if (b.type === 'FIGURES' && ctx.cur) {
        const face = { current: faceOf(ctx.cur)!, comparative: faceOf(ctx.comp) };
        const ln = lineNote({
          fslis: lineFslis,
          classes: ctx.fslis,
          current: { accounts: ctx.cur.accounts, amounts: ctx.cur.amounts },
          comparative: ctx.comp ? { accounts: ctx.comp.accounts, amounts: ctx.comp.amounts } : null,
          face,
        });
        const grouped = groupAccounts(
          ln.accounts.map((a) => ({
            code: a.code,
            current: a.current,
            comparative: a.comparative,
          })),
          b.subCaptions,
          ctx.comp !== null,
        );
        const info = new Map(ln.accounts.map((a) => [a.code, a]));
        const computedTotal = (k: 'current' | 'comparative') =>
          ln.computed.reduce((s, c) => (c[k] === null ? s : s.plus(c[k]!)), new Decimal(0));
        figures[b.id] = {
          lines: n.lineKeys.map((k) => ({ key: k, label: this.lineLabel(ctx, k) })),
          groups: grouped.groups.map((g) => ({
            id: g.id,
            label: g.label,
            accounts: g.accounts.map((a) => {
              const x = info.get(a.code)!;
              return {
                code: a.code,
                name: x.name,
                counterpartyCode: x.counterpartyCode,
                current: this.scale(ctx, a.current),
                comparative: this.scale(ctx, a.comparative),
              };
            }),
            subtotal: {
              current: this.scale(ctx, g.subtotal.current)!,
              comparative: this.scale(ctx, g.subtotal.comparative),
            },
          })),
          computed: ln.computed.map((c) => ({
            ...c,
            current: this.scale(ctx, c.current),
            comparative: this.scale(ctx, c.comparative),
          })),
          total: {
            current: this.scale(
              ctx,
              new Decimal(grouped.total.current).plus(computedTotal('current')).toFixed(2),
            )!,
            comparative:
              grouped.total.comparative === null
                ? null
                : this.scale(
                    ctx,
                    new Decimal(grouped.total.comparative)
                      .plus(computedTotal('comparative'))
                      .toFixed(2),
                  ),
          },
          face: {
            current: this.scale(ctx, face.current),
            comparative: this.scale(ctx, face.comparative),
          },
          ties: ln.ties,
          errors: grouped.errors,
        };
      }
      if (b.type === 'TABLE') {
        const lineValue = b.agreeLine ? (ctx.cur?.rows[b.agreeLine] ?? null) : null;
        const t = checkTable(b, lineValue);
        tables[b.id] = {
          total: this.scale(ctx, t.total),
          ties: t.ties,
          agreeLabel: b.agreeLine ? this.lineLabel(ctx, b.agreeLine) : null,
          errors: t.errors,
        };
      }
    }
    const nil = n.lineKeys.every((k) => zero(ctx.cur?.rows[k]) && zero(ctx.comp?.rows[k]));
    const content = hasContent(n.blocks);
    const hidden = !n.mandatory && (n.kind === 'LINE' ? nil && !content : !content);
    const deleteBlocked =
      n.kind === 'LINE' && !nil
        ? 'A line note cannot be deleted while its line has a value.'
        : n.mandatory
          ? 'This note is mandatory for the format.'
          : null;
    return {
      id: n.id,
      title: n.title,
      kind: n.kind,
      status: n.status,
      mandatory: n.mandatory,
      hidden,
      lineKeys: n.lineKeys,
      deletable: deleteBlocked === null,
      deleteBlocked,
      blocks: n.blocks,
      figures,
      tables,
      stale,
      version: n.version,
      carriedFrom: n.carriedFromId !== null,
      updatedBy: n.updatedBy,
      updatedAt: n.updatedAt.toISOString(),
      reviewedBy: n.reviewedBy,
    };
  }

  private lineLabel(ctx: Ctx, k: string) {
    const [st, key] = k.split(':');
    const l = ctx.lines.find((x) => x.statement === st && x.key === key);
    return l ? `${st === 'BS' ? 'Balance sheet' : 'P&L'} · ${l.label}` : k;
  }

  private catalog(ctx: Ctx, notes: NoteRow[]): CatalogItemDto[] {
    if (!ctx.cur) return [];
    const item = (
      source: FigureRef['source'],
      key: string,
      label: string,
      group: string,
    ): CatalogItemDto => ({
      source,
      key,
      label,
      group,
      values: Object.fromEntries(
        MEASURES.map((m) => {
          const v = figureValue({ source, key, measure: m }, ctx.cur!.set, ctx.comp?.set ?? null);
          return [m, m === 'variancePct' ? v : this.scale(ctx, v)];
        }),
      ) as CatalogItemDto['values'],
    });
    const fsliName = new Map(ctx.fslis.map((f) => [f.code, f.name]));
    const accountName = new Map(
      [...(ctx.comp?.accounts ?? []), ...ctx.cur.accounts].map((a) => [a.code, a.name]),
    );
    return [
      ...ctx.lines
        .filter((l) => l.type !== 'HEADING')
        .map((l) =>
          item(
            'LINE',
            lineKey(l),
            `${l.statement === 'BS' ? 'Balance sheet' : 'P&L'} · ${l.label}`,
            'Statement lines',
          ),
        ),
      ...Object.keys(ctx.cur.set.fslis).map((k) => item('FSLI', k, fsliName.get(k) ?? k, 'FSLIs')),
      ...[...accountName.entries()]
        .sort()
        .map(([k, name]) => item('ACCOUNT', k, `${k} ${name}`, 'Accounts')),
      ...notes.flatMap((n) =>
        n.blocks.flatMap((b) =>
          b.type === 'FIGURES'
            ? b.subCaptions.map((s) =>
                item('SUBCAPTION', `${n.id}:${s.id}`, `${n.title} · ${s.label}`, 'Sub-captions'),
              )
            : [],
        ),
      ),
    ];
  }

  /** Figures of the last finalised period and of this one (functional currency) for the stale check. */
  private async staleSources(
    task: StepTask,
    te: TaskEntityRow,
    figures: EntityFigures,
    notes: NoteRow[],
  ) {
    const prior = await this.priorFinalised(task, te.entityCode);
    if (!prior) return null;
    const priorFigures = await this.figuresService.snapshot(prior.task.id, te.entityCode);
    const ctxNow = await this.context(task, figures);
    const lastCtx = priorFigures ? await this.context(prior.task, priorFigures) : null;
    const values = (p: PeriodView | null) =>
      p
        ? [
            ...Object.values(p.set.lines),
            ...Object.values(p.set.fslis),
            ...Object.values(p.set.accounts),
          ]
        : [];
    const tableValues = (rows: NoteRow[] | EntityNote[]) =>
      rows.flatMap((n) =>
        (n.blocks as unknown as NoteBlock[]).flatMap((b) =>
          b.type === 'TABLE'
            ? b.rows.flatMap((r) => {
                const cur = b.columns.find((c) => c.period === 'CURRENT');
                const v = cur ? cellNumber(r.cells[cur.id] ?? '') : null;
                return v ? [v.toFixed(2)] : [];
              })
            : [],
        ),
      );
    return {
      last: [...values(lastCtx?.cur ?? null), ...tableValues(prior.notes)],
      now: [...values(ctxNow.cur), ...tableValues(notes)],
    };
  }

  async entity(
    user: AuthUser,
    taskId: string,
    entityCode: string,
    opts: { currency?: string; unit?: StatementUnitCode },
  ): Promise<EntityNotesDto> {
    const task = await loadStepTask(this.prisma, user, taskId);
    const te = assertViewable(user, task, entityCode);
    const reason = readOnlyReason(user, task, entityCode);
    const { figures } = await this.figuresService.figures(task, te, reason !== null);
    const base = {
      entity: {
        code: te.entityCode,
        legalName: te.entity.legalName,
        shortName: te.entity.shortName,
        functionalCurrency: te.entity.functionalCurrency,
        itemStatus: te.status,
      },
      canEdit: reason === null && figures !== null,
      readOnlyReason: reason,
      periodLabel: task.period.label,
      options: {
        currencies: figures?.currencies.map((c) => c.currency) ?? [],
        units: STATEMENT_UNITS,
      },
    };
    if (!figures)
      return {
        ...base,
        hasTb: false,
        formatName: '',
        comparativeLabel: '',
        hasComparative: false,
        selection: { currency: te.entity.functionalCurrency, unit: opts.unit ?? 'ACTUAL' },
        progress: { reviewed: 0, total: 0, text: '' },
        rolledFrom: null,
        notes: [],
        catalog: [],
        lines: [],
        roundingNote: null,
      };
    const ctx = await this.context(task, figures, opts.currency, opts.unit);
    const notes = await this.notesFor(user, task, te, ctx, reason === null);
    this.subCaptionSets(notes, ctx);
    const sources = await this.staleSources(task, te, figures, notes);
    const views = notes.map((n) => {
      const texts = n.blocks
        .filter((b) => b.type === 'TEXT')
        .map((b) => ({ blockId: b.id, doc: (b as { doc: RichNode }).doc }));
      return this.noteView(n, ctx, sources ? staleNumbers(texts, sources.last, sources.now) : []);
    });
    const numbers = numberNotes(views);
    const visible = views.filter((v) => !v.hidden);
    const reviewed = visible.filter((v) => v.status === 'REVIEWED').length;
    const prior = await this.priorFinalised(task, te.entityCode);
    return {
      ...base,
      hasTb: true,
      formatName: ctx.formatName,
      comparativeLabel: figures.comparative.periodLabel,
      hasComparative: ctx.comp !== null,
      selection: { currency: ctx.currency, unit: ctx.unit },
      progress: {
        reviewed,
        total: visible.length,
        text: `${reviewed} of ${visible.length} notes reviewed`,
      },
      rolledFrom:
        prior && notes.some((n) => n.carriedFromId !== null)
          ? { taskNumber: prior.task.number, periodLabel: prior.task.period.label }
          : null,
      notes: views.map((v) => ({ ...v, number: numbers.get(v.id) ?? null })),
      catalog: this.catalog(ctx, notes),
      lines: ctx.lines
        .filter((l) => l.type === 'LINE')
        .map((l) => ({ key: lineKey(l), label: this.lineLabel(ctx, lineKey(l)) })),
      roundingNote: ctx.unit === 'ACTUAL' ? null : ROUNDING_NOTE,
    };
  }

  /** Note numbers of the statement lines ("BS:key" → number), for the statements' Note column. */
  async lineNumbers(
    user: AuthUser,
    task: StepTask,
    te: TaskEntityRow,
    figures: EntityFigures,
  ): Promise<Record<string, number>> {
    const ctx = await this.context(task, figures);
    const notes = await this.notesFor(user, task, te, ctx, false);
    const views = notes.map((n) => this.noteView(n, ctx, []));
    const numbers = numberNotes(views);
    const out: Record<string, number> = {};
    for (const v of views) {
      const num = numbers.get(v.id);
      if (num !== undefined) for (const k of v.lineKeys) out[k] ??= num;
    }
    return out;
  }

  /** "Last finalised (Jul-2026)": the note as finalised, and the words changed since. */
  async prior(
    user: AuthUser,
    taskId: string,
    entityCode: string,
    noteId: string,
    opts: { currency?: string; unit?: StatementUnitCode },
  ): Promise<PriorNoteDto> {
    const task = await loadStepTask(this.prisma, user, taskId);
    const te = assertViewable(user, task, entityCode);
    const note = await this.prisma.entityNote.findFirst({
      where: { id: noteId, taskId, entityCode },
    });
    if (!note) throw ApiError.notFound('Note not found.');
    const prior = await this.priorFinalised(task, entityCode);
    if (!prior) throw ApiError.notFound('There is no finalised earlier period for this entity.');
    const was = note.carriedFromId
      ? prior.notes.find((n) => n.id === note.carriedFromId)
      : undefined;
    const figures = await this.figuresService.snapshot(prior.task.id, entityCode);
    const base = { periodLabel: prior.task.period.label, taskNumber: prior.task.number };
    if (!was || !figures) return { ...base, note: null, catalog: [], diff: {} };
    const ctx = await this.context(prior.task, figures, opts.currency, opts.unit);
    const rows = prior.notes.map((n) => this.toRow({ ...n }));
    this.subCaptionSets(rows, ctx);
    const view = this.noteView(this.toRow({ ...was }), ctx, []);
    const oldText = new Map(
      (was.blocks as unknown as NoteBlock[])
        .filter((b) => b.type === 'TEXT')
        .map((b) => [b.id, plainText((b as { doc: RichNode }).doc)]),
    );
    const diff: PriorNoteDto['diff'] = {};
    for (const b of note.blocks as unknown as NoteBlock[])
      if (b.type === 'TEXT') diff[b.id] = wordDiff(oldText.get(b.id) ?? '', plainText(b.doc));
    void te;
    return {
      ...base,
      note: { title: view.title, blocks: view.blocks, figures: view.figures, tables: view.tables },
      catalog: this.catalog(ctx, rows),
      diff,
    };
  }

  // ---------------------------------------------------------------------------------------
  // Changes (auto-saved, versioned, audited)
  // ---------------------------------------------------------------------------------------

  private async editableNote(user: AuthUser, taskId: string, entityCode: string, noteId: string) {
    const task = await loadStepTask(this.prisma, user, taskId);
    const te = assertEditable(user, task, entityCode);
    const note = await this.prisma.entityNote.findFirst({
      where: { id: noteId, taskId, entityCode },
    });
    if (!note) throw ApiError.notFound('Note not found.');
    return { task, te, note };
  }

  private validate(blocks: NoteBlock[]) {
    const errors: string[] = [];
    for (const b of blocks) {
      if (b.type === 'FIGURES') errors.push(...groupAccounts([], b.subCaptions, false).errors);
      if (b.type === 'TABLE') errors.push(...checkTable(b, null).errors);
    }
    if (errors.length > 0)
      throw new ApiError(HttpStatus.BAD_REQUEST, ApiErrorCode.ValidationFailed, errors.join(' '), {
        errors,
      });
  }

  async save(
    user: AuthUser,
    taskId: string,
    entityCode: string,
    noteId: string,
    input: NoteSaveInput,
    ip: string | null,
  ) {
    const { task, note } = await this.editableNote(user, taskId, entityCode, noteId);
    if (input.baseVersion !== note.version)
      throw new ApiError(
        HttpStatus.CONFLICT,
        ApiErrorCode.Conflict,
        'This note was changed elsewhere since you opened it. Reload to see the latest version.',
      );
    const blocks = input.blocks as unknown as NoteBlock[];
    this.validate(blocks);
    const figures = (blocks as NoteBlock[]).filter((b) => b.type === 'FIGURES');
    if (note.kind === 'LINE' && figures.length === 0)
      throw ApiError.validation('A line note keeps its figures table.');
    const changed =
      note.title !== input.title.trim() || canonicalJson(note.blocks) !== canonicalJson(blocks);
    if (!changed) return { version: note.version, status: note.status };
    const version = note.version + 1;
    await this.prisma.$transaction(async (tx) => {
      await tx.entityNote.update({
        where: { id: note.id },
        data: {
          title: input.title.trim(),
          blocks: blocks as unknown as Prisma.InputJsonValue,
          status: 'EDITED',
          version,
          updatedById: user.id,
          reviewedById: null,
          reviewedAt: null,
        },
      });
      await tx.entityNoteVersion.create({
        data: {
          noteId: note.id,
          version,
          title: input.title.trim(),
          blocks: blocks as unknown as Prisma.InputJsonValue,
          status: 'EDITED',
          editedById: user.id,
        },
      });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.NoteUpdate,
          entityType: 'ENTITY_NOTE',
          entityId: note.id,
          oldValue: {
            title: note.title,
            status: note.status,
            version: note.version,
            blocks: note.blocks,
          },
          newValue: {
            task: task.number,
            entity: entityCode,
            title: input.title.trim(),
            status: 'EDITED',
            version,
            blocks,
          },
          ip,
        },
        tx,
      );
    });
    await this.guard?.changed(user, taskId, entityCode, `Note edited (${input.title.trim()})`, ip);
    return { version, status: 'EDITED' as const };
  }

  async review(
    user: AuthUser,
    taskId: string,
    entityCode: string,
    noteId: string,
    reviewed: boolean,
    ip: string | null,
  ) {
    const { task, note } = await this.editableNote(user, taskId, entityCode, noteId);
    const status = reviewed ? 'REVIEWED' : 'EDITED';
    if (note.status === status) return { status };
    await this.prisma.$transaction(async (tx) => {
      await tx.entityNote.update({
        where: { id: note.id },
        data: {
          status,
          reviewedById: reviewed ? user.id : null,
          reviewedAt: reviewed ? new Date() : null,
        },
      });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.NoteReview,
          entityType: 'ENTITY_NOTE',
          entityId: note.id,
          oldValue: { status: note.status },
          newValue: { task: task.number, entity: entityCode, title: note.title, status },
          ip,
        },
        tx,
      );
    });
    return { status };
  }

  async create(
    user: AuthUser,
    taskId: string,
    entityCode: string,
    input: { title: string; afterNoteId: string | null },
    ip: string | null,
  ) {
    const task = await loadStepTask(this.prisma, user, taskId);
    assertEditable(user, task, entityCode);
    const notes = await this.prisma.entityNote.findMany({
      where: { taskId, entityCode },
      orderBy: { sortOrder: 'asc' },
    });
    if (notes.length === 0) throw ApiError.validation('Open the notes first.');
    const at = input.afterNoteId
      ? notes.findIndex((n) => n.id === input.afterNoteId) + 1
      : notes.length;
    const blocks: NoteBlock[] = [
      {
        id: randomUUID(),
        type: 'TEXT',
        label: '',
        doc: { type: 'doc', content: [{ type: 'paragraph' }] },
      },
    ];
    const id = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      for (const [i, n] of notes.entries())
        if (i >= at)
          await tx.entityNote.update({ where: { id: n.id }, data: { sortOrder: i + 2 } });
      await tx.entityNote.create({
        data: {
          id,
          taskId,
          entityCode,
          sortOrder: at + 1,
          kind: 'CUSTOM',
          title: input.title.trim(),
          lineKeys: [],
          status: 'EDITED',
          blocks: blocks as unknown as Prisma.InputJsonValue,
          updatedById: user.id,
        },
      });
      await tx.entityNoteVersion.create({
        data: {
          noteId: id,
          version: 1,
          title: input.title.trim(),
          blocks: blocks as unknown as Prisma.InputJsonValue,
          status: 'EDITED',
          editedById: user.id,
        },
      });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.NoteCreate,
          entityType: 'ENTITY_NOTE',
          entityId: id,
          oldValue: null,
          newValue: {
            task: task.number,
            entity: entityCode,
            title: input.title.trim(),
            position: at + 1,
          },
          ip,
        },
        tx,
      );
    });
    await this.guard?.changed(user, taskId, entityCode, `Note added (${input.title.trim()})`, ip);
    return { id };
  }

  async remove(
    user: AuthUser,
    taskId: string,
    entityCode: string,
    noteId: string,
    ip: string | null,
  ) {
    const { task, te, note } = await this.editableNote(user, taskId, entityCode, noteId);
    const { figures } = await this.figuresService.figures(task, te, false);
    if (figures) {
      const ctx = await this.context(task, figures);
      const v = this.noteView(this.toRow({ ...note }), ctx, []);
      if (!v.deletable)
        throw new ApiError(HttpStatus.CONFLICT, ApiErrorCode.Conflict, v.deleteBlocked!);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.entityNote.delete({ where: { id: note.id } });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.NoteDelete,
          entityType: 'ENTITY_NOTE',
          entityId: note.id,
          oldValue: { title: note.title, kind: note.kind, blocks: note.blocks },
          newValue: { task: task.number, entity: entityCode },
          ip,
        },
        tx,
      );
    });
    await this.guard?.changed(user, taskId, entityCode, `Note deleted (${note.title})`, ip);
  }

  async reorder(
    user: AuthUser,
    taskId: string,
    entityCode: string,
    ids: string[],
    ip: string | null,
  ) {
    const task = await loadStepTask(this.prisma, user, taskId);
    assertEditable(user, task, entityCode);
    const notes = await this.prisma.entityNote.findMany({
      where: { taskId, entityCode },
      orderBy: { sortOrder: 'asc' },
    });
    if (ids.length !== notes.length || !notes.every((n) => ids.includes(n.id)))
      throw ApiError.validation('The new order must list every note once.');
    await this.prisma.$transaction(async (tx) => {
      for (const [i, id] of ids.entries())
        await tx.entityNote.update({ where: { id }, data: { sortOrder: i + 1 } });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.NoteReorder,
          entityType: 'TASK_ENTITY',
          entityId: `${taskId}:${entityCode}`,
          oldValue: notes.map((n) => n.title),
          newValue: ids.map((id) => notes.find((n) => n.id === id)!.title),
          ip,
        },
        tx,
      );
    });
  }

  async continue(user: AuthUser, taskId: string, entityCode: string, ip: string | null) {
    const task = await loadStepTask(this.prisma, user, taskId);
    const te = assertEditable(user, task, entityCode);
    const next = stepIndex(te.currentStep) < stepIndex('REVIEW') ? 'REVIEW' : te.currentStep;
    await this.prisma.$transaction(async (tx) => {
      if (next !== te.currentStep)
        await tx.taskEntity.update({
          where: { taskId_entityCode: { taskId, entityCode } },
          data: { currentStep: next },
        });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.TaskStepContinue,
          entityType: 'TASK_ENTITY',
          entityId: `${taskId}:${entityCode}`,
          oldValue: { step: te.currentStep },
          newValue: { step: next, task: task.number, entity: entityCode },
          ip,
        },
        tx,
      );
    });
    return { currentStep: next };
  }

  async step(user: AuthUser, taskId: string): Promise<NotesStepDto> {
    const task = await loadStepTask(this.prisma, user, taskId);
    const tabs = [];
    for (const te of [...task.entities]
      .filter((e) => inScope(user.entityScope, e.entityCode))
      .sort((a, b) => a.entity.sortOrder - b.entity.sortOrder)) {
      const stored = await this.prisma.entityNote.findMany({
        where: { taskId, entityCode: te.entityCode },
        select: { status: true },
      });
      const hasTb =
        (await this.prisma.tbVersion.count({
          where: {
            taskId,
            entityCode: te.entityCode,
            purpose: 'CURRENT',
            status: { not: 'ERROR' },
          },
        })) > 0;
      tabs.push({
        code: te.entityCode,
        shortName: te.entity.shortName,
        itemStatus: te.status,
        currentStep: te.currentStep,
        hasValidatedTb: hasTb,
        toMap: null,
        reviewed: stored.length ? stored.filter((s) => s.status === 'REVIEWED').length : null,
        total: stored.length || null,
      });
    }
    return {
      task: {
        id: task.id,
        number: task.number,
        type: task.type,
        periodLabel: task.period.label,
        description: task.description,
        dueDate: fromDbDate(task.dueDate),
        status: deriveTaskStatus(task.entities.map((e) => e.status)),
        currentStep: task.currentStep,
        locked: isTaskLocked(task),
      },
      entities: tabs,
    };
  }
}
