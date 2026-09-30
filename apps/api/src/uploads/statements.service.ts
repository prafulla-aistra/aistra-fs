import { Injectable } from '@nestjs/common';
import {
  buildStatement,
  type BuiltStatement,
  Decimal,
  deriveTaskStatus,
  type FormatFsli,
  type FormatLine,
  fsliAmounts,
  intercompanyNote,
  lineNote,
  noteNumbers,
  scaleAmount,
  type StatementUnit,
  statementTitle,
} from '@finance-close/engine';
import {
  AuditAction,
  COMPARATIVE_SOURCE_LABELS,
  type EntityStatementsDto,
  ERP_LABELS,
  GAAP_LABELS,
  INTERCOMPANY_NOTE_LABEL,
  ROUNDING_NOTE,
  STATEMENT_UNITS,
  STATEMENTS_FOOTER,
  type StatementRowDto,
  type StatementsStepDto,
  type StatementUnitCode,
  TASK_STEPS,
} from '@finance-close/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/session-user';
import { ApiError } from '../common/api-error';
import { fromDbDate } from '../common/db-dates';
import { PrismaService } from '../prisma/prisma.service';
import { inScope } from '../tasks/tasks.service';
import { statementsWorkbook } from './statements-export';
import {
  type CurrencyFigures,
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
  type StepTask,
} from './step-access';

type TaskEntityRow = StepTask['entities'][number];
const stepIndex = (code: string) => TASK_STEPS.findIndex((s) => s.code === code);

export interface ViewOptions {
  format?: string;
  currency?: string;
  unit?: StatementUnitCode;
  showNil?: boolean;
}

const UNIT_TEXT: Record<StatementUnitCode, string> = Object.fromEntries(
  STATEMENT_UNITS.map((u) => [u.code, u.label]),
) as Record<StatementUnitCode, string>;

const zero = (v: string | null) => v === null || new Decimal(v).isZero();

export const NOTE2_DEFAULT = `Draft – to be reviewed.

(a) Revenue recognition: revenue from services is recognised as the services are rendered, at the amount of consideration the Company expects to be entitled to.
(b) Property, plant and equipment: stated at cost less accumulated depreciation; depreciation is charged on a straight-line basis over the useful lives of the assets.
(c) Foreign currency: transactions in foreign currencies are recorded at the rate on the date of the transaction; monetary items are restated at the closing rate and differences are taken to profit or loss.
(d) Employee benefits: short-term benefits are expensed as the related service is provided; post-employment benefits follow the applicable plans.
(e) Income taxes: current tax is provided at the amount expected to be paid; deferred tax is recognised on temporary differences.`;

/**
 * Task workspace step 5 "Statements and notes" (page 7): the balance sheet, P&L and notes
 * from a report format, in the functional or a translated currency. No journals or manual
 * adjustments: the figures always come from the trial balance (or, once finalised, from the
 * stored snapshot).
 */
@Injectable()
export class StatementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly figuresService: StatementFiguresService,
  ) {}

  async fslis(): Promise<FormatFsli[]> {
    const rows = await this.prisma.fsli.findMany({ orderBy: { sortOrder: 'asc' } });
    return rows.map((f) => ({
      code: f.code,
      name: f.name,
      statement: f.statement,
      class: f.class,
    }));
  }

  /** The format's lines: a given version, else the current one. */
  async formatLines(code: string, version?: number | null) {
    const f = await this.prisma.format.findUnique({ where: { code } });
    if (!f) throw ApiError.notFound(`Format ${code} not found.`);
    const v = await this.prisma.formatVersion.findUnique({
      where: { formatCode_version: { formatCode: code, version: version ?? f.currentVersion } },
      include: { lines: { orderBy: [{ statement: 'desc' }, { sortOrder: 'asc' }] } },
    });
    if (!v) throw ApiError.notFound(`Format ${code} has no version ${version}.`);
    const lines: FormatLine[] = v.lines.map((l) => ({
      key: l.key,
      statement: l.statement,
      type: l.type,
      label: l.label,
      indent: l.indent,
      fslis: l.fslis,
      formula: l.formula as FormatLine['formula'],
      role: (l.role ?? null) as FormatLine['role'],
    }));
    return { format: f, version: v.version, lines };
  }

  async step(user: AuthUser, taskId: string): Promise<StatementsStepDto> {
    const task = await loadStepTask(this.prisma, user, taskId);
    const format = task.formatCode
      ? await this.prisma.format.findUnique({ where: { code: task.formatCode } })
      : null;
    const fslis = await this.fslis();
    const lines = task.formatCode
      ? (await this.formatLines(task.formatCode, task.formatVersion)).lines
      : null;
    const tabs = [];
    for (const te of [...task.entities]
      .filter((e) => inScope(user.entityScope, e.entityCode))
      .sort((a, b) => a.entity.sortOrder - b.entity.sortOrder)) {
      const { figures } = await this.figuresService.figures(
        task,
        te,
        readOnlyReason(user, task, te.entityCode) !== null,
      );
      let ties: boolean | null = null;
      if (figures && lines) {
        const f = figures.currencies[0]!;
        const { amounts } = fsliAmounts(f.current.accounts, fslis, f.current.fctr);
        const bs = buildStatement(lines, 'BS', amounts, fslis);
        const pl = buildStatement(lines, 'PL', amounts, fslis);
        ties = bs.balanceDifference === '0.00' && pl.profitDifference === '0.00';
      }
      tabs.push({
        code: te.entityCode,
        shortName: te.entity.shortName,
        itemStatus: te.status,
        currentStep: te.currentStep,
        hasValidatedTb: figures !== null,
        toMap: null,
        ties,
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
        formatName: format?.name ?? null,
      },
      entities: tabs,
    };
  }

  async entity(
    user: AuthUser,
    taskId: string,
    entityCode: string,
    opts: ViewOptions,
  ): Promise<EntityStatementsDto> {
    const task = await loadStepTask(this.prisma, user, taskId);
    const te = assertViewable(user, task, entityCode);
    const reason = readOnlyReason(user, task, entityCode);
    const { figures, fromSnapshot } = await this.figuresService.figures(task, te, reason !== null);
    return this.render(user, task, te, figures, fromSnapshot, reason, opts);
  }

  /** Figures and view for the export (and the view itself). */
  async load(user: AuthUser, taskId: string, entityCode: string) {
    const task = await loadStepTask(this.prisma, user, taskId);
    const te = assertViewable(user, task, entityCode);
    const reason = readOnlyReason(user, task, entityCode);
    const { figures, fromSnapshot } = await this.figuresService.figures(task, te, reason !== null);
    return { task, te, reason, figures, fromSnapshot };
  }

  private async texts(task: StepTask, te: TaskEntityRow) {
    const rows = await this.prisma.statementText.findMany({
      where: { taskId: task.id, entityCode: te.entityCode },
      include: { updatedBy: { select: { name: true } } },
    });
    const note1 = rows.find((r) => r.kind === 'NOTE1') ?? null;
    const note2 = rows.find((r) => r.kind === 'NOTE2') ?? null;
    // Policies are written once: an earlier task's Note 2 is the starting point.
    let carried: { text: string; from: string } | null = null;
    if (!note2) {
      const prev = await this.prisma.statementText.findFirst({
        where: {
          entityCode: te.entityCode,
          kind: 'NOTE2',
          taskId: { not: task.id },
          task: { period: { endDate: { lt: task.period.startDate } } },
        },
        include: { task: { include: { period: true } } },
        orderBy: { task: { period: { endDate: 'desc' } } },
      });
      if (prev)
        carried = { text: prev.text, from: `${prev.task.number} (${prev.task.period.label})` };
    }
    return { note1, note2, carried };
  }

  note1Draft(task: StepTask, te: TaskEntityRow): string {
    const e = te.entity;
    const span =
      task.period.type === 'MONTHLY'
        ? 'month'
        : task.period.type === 'QUARTERLY'
          ? 'quarter'
          : 'year';
    const end = statementTitle('BS', task.period.type, fromDbDate(task.period.endDate)).replace(
      'Balance sheet as at ',
      '',
    );
    return [
      `${e.legalName} ("the Company") is incorporated in ${e.country}. Its functional currency is ${e.functionalCurrency}.`,
      `Basis of preparation: these standalone financial statements for the ${span} ended ${end} (${task.period.label}) have been prepared in accordance with ${GAAP_LABELS[e.gaap]} on the historical cost basis, from the trial balance extracted from ${ERP_LABELS[e.erp]}. They are presented in ${e.functionalCurrency}.`,
    ].join('\n\n');
  }

  private translationText(c: CurrencyFigures): string | null {
    if (!c.translatedFrom || !c.current.rates) return null;
    const r = c.current.rates;
    const one = (v: string | null) =>
      v ? `1 ${c.translatedFrom} = ${v} ${c.currency}` : 'not available';
    return `Presented in ${c.currency}, translated from the functional currency ${c.translatedFrom} (Ind AS 21 / IAS 21): assets and liabilities at the closing rate (${one(r.closing)}), income and expenses at the average rate (${one(r.average)}), share capital and securities premium at the historical rate (${one(r.historical)}), other reserves at the opening rate (${one(r.opening)}) and retained earnings rolled forward where a finalised prior period exists. The resulting difference is the foreign currency translation reserve (FCTR) in equity.`;
  }

  async render(
    user: AuthUser,
    task: StepTask,
    te: TaskEntityRow,
    figures: EntityFigures | null,
    fromSnapshot: boolean,
    reason: string | null,
    opts: ViewOptions,
  ): Promise<EntityStatementsDto> {
    const e = te.entity;
    const unit: StatementUnitCode = opts.unit ?? 'ACTUAL';
    const showNil = opts.showNil ?? false;
    const formatCode = opts.format ?? task.formatCode ?? 'STATUTORY';
    const isTaskFormat = formatCode === task.formatCode;
    const { format, version, lines } = await this.formatLines(
      formatCode,
      isTaskFormat ? task.formatVersion : null,
    );
    const formats = await this.prisma.format.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    const fslis = await this.fslis();
    const currencies = figures?.currencies ?? [
      { currency: e.functionalCurrency, translatedFrom: null, current: null, comparative: null },
    ];
    const selected =
      (figures?.currencies.find((c) => c.currency === opts.currency) ?? figures?.currencies[0]) ||
      null;
    const currency = selected?.currency ?? e.functionalCurrency;
    const entities = await this.prisma.entity.findMany({ select: { code: true, legalName: true } });
    const entityName = new Map(entities.map((x) => [x.code, x.legalName]));
    const texts = await this.texts(task, te);
    const scale = (v: string | null) => (v === null ? null : scaleAmount(v, unit as StatementUnit));
    const endDate = fromDbDate(task.period.endDate);

    const cur = selected?.current.status === 'OK' ? selected.current : null;
    const comp = selected?.comparative?.status === 'OK' ? selected.comparative : null;
    const amounts = (p: PeriodFigures | null) =>
      p ? fsliAmounts(p.accounts, fslis, p.fctr).amounts : null;
    const curAmounts = amounts(cur);
    const compAmounts = amounts(comp);
    const built = (st: 'BS' | 'PL', a: Record<string, string> | null) =>
      a ? buildStatement(lines, st, a, fslis) : null;
    const face = {
      BS: { cur: built('BS', curAmounts), comp: built('BS', compAmounts) },
      PL: { cur: built('PL', curAmounts), comp: built('PL', compAmounts) },
    };
    const numbers = noteNumbers(
      (['BS', 'PL'] as const).flatMap((st) =>
        (face[st].cur?.rows ?? []).map((r, i) => ({
          key: r.key,
          statement: st,
          type: r.type,
          current: r.value,
          comparative: face[st].comp?.rows[i]?.value ?? null,
        })),
      ),
    );

    const tie = (b: BuiltStatement | null, st: 'BS' | 'PL') => {
      if (!b) return null;
      const d = st === 'BS' ? b.balanceDifference : b.profitDifference;
      return d === null ? null : { ok: new Decimal(d).isZero(), difference: scale(d)! };
    };
    const view = (st: 'BS' | 'PL') => {
      const c = face[st].cur;
      const p = face[st].comp;
      const all = lines.filter((l) => l.statement === st);
      const rows: StatementRowDto[] = all.map((l, i) => {
        const currentValue = c?.rows[i]?.value ?? null;
        const comparativeValue = p?.rows[i]?.value ?? null;
        const tieRole = st === 'BS' ? 'TOTAL_EQUITY_LIABILITIES' : 'PROFIT';
        const curTie = l.role === tieRole ? tie(c, st) : null;
        return {
          key: l.key,
          type: l.type,
          label: l.label,
          indent: l.indent,
          role: l.role,
          note: numbers[`${st}:${l.key}`] ?? null,
          current: l.type === 'HEADING' ? null : scale(currentValue),
          comparative: l.type === 'HEADING' || !p ? null : scale(comparativeValue),
          tie: curTie
            ? {
                current: curTie,
                comparative: tie(p, st),
                text:
                  st === 'BS'
                    ? 'Agrees to total assets'
                    : 'Agrees to the profit carried to the balance sheet',
              }
            : null,
        };
      });
      // Nil lines (and headings whose lines are all nil) hide unless "Show nil lines" is on.
      const nil = (i: number) => {
        const r = rows[i]!;
        const raw = [c?.rows[i]?.value ?? null, p?.rows[i]?.value ?? null];
        return r.role === null && r.type !== 'HEADING' && raw.every(zero);
      };
      const visible = rows.filter((r, i) => {
        if (showNil) return true;
        if (r.type !== 'HEADING') return !nil(i);
        for (let j = i + 1; j < rows.length && rows[j]!.indent > r.indent; j++)
          if (rows[j]!.type !== 'HEADING' && !nil(j)) return true;
        return false;
      });
      const compEnd = figures?.comparative.periodEndDate ?? null;
      return {
        title: statementTitle(st, task.period.type, endDate),
        comparativeTitle: comp && compEnd ? statementTitle(st, task.period.type, compEnd) : null,
        rows: visible,
      };
    };

    // Notes: one per numbered line (BS first, then P&L), then intercompany and rates.
    const translationBy = new Map((cur?.translation ?? []).map((t) => [t.code, t]));
    const noteLines = cur
      ? (['BS', 'PL'] as const).flatMap((st) =>
          (face[st].cur?.rows ?? [])
            .map((r, i) => ({ r, i }))
            .filter(({ r }) => numbers[`${st}:${r.key}`] !== undefined)
            .map(({ r, i }) => {
              const compValue = face[st].comp?.rows[i]?.value ?? null;
              const n = lineNote({
                fslis: r.fslis,
                classes: fslis,
                current: { accounts: cur.accounts, amounts: curAmounts! },
                comparative: comp ? { accounts: comp.accounts, amounts: compAmounts! } : null,
                face: { current: r.value!, comparative: comp ? compValue : null },
              });
              const functionalAmount = new Map(
                (figures!.currencies[0]!.current.accounts ?? []).map((a) => [a.code, a.amount]),
              );
              return {
                number: numbers[`${st}:${r.key}`]!,
                key: r.key,
                statement: st,
                label: r.label,
                accounts: n.accounts.map((a) => {
                  const t = translationBy.get(a.code);
                  return {
                    ...a,
                    counterpartyName: a.counterpartyCode
                      ? (entityName.get(a.counterpartyCode) ?? null)
                      : null,
                    current: scale(a.current),
                    comparative: scale(a.comparative),
                    tb:
                      a.current === null
                        ? null
                        : {
                            functional: t?.functional ?? functionalAmount.get(a.code) ?? '0.00',
                            functionalCurrency: e.functionalCurrency,
                            basisLabel: t?.basisLabel ?? null,
                            rate: t?.rate ?? null,
                            translated: t?.translated ?? null,
                          },
                  };
                }),
                computed: n.computed.map((x) => ({
                  ...x,
                  current: scale(x.current),
                  comparative: scale(x.comparative),
                })),
                total: {
                  current: scale(n.total.current)!,
                  comparative: scale(n.total.comparative),
                },
                face: { current: scale(r.value)!, comparative: comp ? scale(compValue) : null },
                ties: n.ties,
              };
            }),
        )
      : [];
    let next = 3 + Object.keys(numbers).length;
    const ic = cur ? intercompanyNote(cur.accounts, comp?.accounts ?? null) : [];
    const scaleIc = (r: Record<string, string>) =>
      Object.fromEntries(Object.entries(r).map(([k, v]) => [k, scale(v)!])) as {
        receivable: string;
        payable: string;
        revenue: string;
        charges: string;
      };
    const intercompany =
      ic.length > 0
        ? {
            number: next++,
            label: INTERCOMPANY_NOTE_LABEL,
            rows: ic.map((r) => ({
              counterpartyCode: r.counterpartyCode,
              counterpartyName: entityName.get(r.counterpartyCode) ?? r.counterpartyCode,
              current: scaleIc(r.current),
              comparative: r.comparative && comp ? scaleIc(r.comparative) : null,
            })),
          }
        : null;
    const rates =
      selected?.translatedFrom && selected.current.rates
        ? {
            number: next++,
            currencyPair: `${selected.translatedFrom} → ${selected.currency}`,
            current: selected.current.rates,
            comparative: selected.comparative?.rates ?? null,
          }
        : null;

    const compRef = figures?.comparative;
    const unmappedAccounts = (cur?.accounts ?? []).filter((x) => !x.fsliCode);
    const warnings = [
      ...(unmappedAccounts.length > 0
        ? [
            `${unmappedAccounts.length} account${unmappedAccounts.length === 1 ? ' is' : 's are'} not mapped (${unmappedAccounts.map((x) => x.code).join(', ')}), so the statements cannot agree to the trial balance. Map them on step 2 · Review and map.`,
          ]
        : []),
      ...(cur?.warnings ?? []),
      ...(selected?.comparative?.warnings ?? []),
    ];
    const failures = selected?.current.status === 'FAIL' ? selected.current.failures : [];
    return {
      entity: {
        code: te.entityCode,
        legalName: e.legalName,
        shortName: e.shortName,
        functionalCurrency: e.functionalCurrency,
        gaap: GAAP_LABELS[e.gaap],
        itemStatus: te.status,
        currentStep: te.currentStep,
      },
      canEdit: reason === null && figures !== null,
      readOnlyReason: reason,
      fromSnapshot,
      hasTb: figures !== null,
      options: {
        formats: formats.map((f) => ({
          code: f.code,
          name: f.name,
          version:
            f.code === task.formatCode
              ? (task.formatVersion ?? f.currentVersion)
              : f.currentVersion,
          isTaskFormat: f.code === task.formatCode,
        })),
        currencies: currencies.map((c) => ({
          code: c.currency,
          translatedFrom: c.translatedFrom,
          status: c.current?.status ?? 'OK',
        })),
        units: STATEMENT_UNITS,
      },
      selection: {
        format: format.code,
        formatName: format.name,
        formatVersion: version,
        isTaskFormat,
        currency,
        unit,
        showNil,
      },
      header: {
        legalName: e.legalName,
        formatName: format.name,
        currencyUnits: `${currency} · ${UNIT_TEXT[unit]}`,
        translatedFrom: selected?.translatedFrom
          ? `Translated from ${selected.translatedFrom}`
          : null,
        periodLabel: task.period.label,
        comparativeLabel: compRef?.periodLabel ?? '',
        comparativeSource: {
          kind: compRef?.kind ?? 'NONE',
          label: COMPARATIVE_SOURCE_LABELS[compRef?.kind ?? 'NONE'],
          taskNumber: compRef?.taskNumber ?? null,
        },
        noComparative: comp ? null : 'No comparative',
      },
      failures,
      balanceSheet: view('BS'),
      profitAndLoss: view('PL'),
      notes: {
        note1: {
          text: texts.note1?.text ?? this.note1Draft(task, te),
          edited: texts.note1 !== null,
          translation: selected ? this.translationText(selected) : null,
          updatedBy: texts.note1?.updatedBy?.name ?? null,
        },
        note2: {
          text: texts.note2?.text ?? texts.carried?.text ?? NOTE2_DEFAULT,
          edited: texts.note2 !== null,
          carriedFrom: texts.note2 ? null : (texts.carried?.from ?? null),
          updatedBy: texts.note2?.updatedBy?.name ?? null,
        },
        lines: noteLines,
        intercompany,
        rates,
      },
      roundingNote: unit === 'ACTUAL' ? null : ROUNDING_NOTE,
      warnings,
      footer: STATEMENTS_FOOTER,
      canContinue: reason === null && figures !== null,
    };
  }

  /** Excel workbook: the selected currency, or every currency ("ALL"), actual amounts. */
  async exportWorkbook(
    user: AuthUser,
    taskId: string,
    entityCode: string,
    opts: { format?: string; currency?: string; showNil?: boolean },
  ): Promise<{ name: string; body: Buffer }> {
    const { task, te, reason, figures, fromSnapshot } = await this.load(user, taskId, entityCode);
    if (!figures) throw ApiError.validation('Upload and validate a trial balance first.');
    const list =
      opts.currency === 'ALL' || !opts.currency
        ? opts.currency === 'ALL'
          ? figures.currencies.map((c) => c.currency)
          : [figures.currencies[0]!.currency]
        : [opts.currency];
    const views = [];
    for (const currency of list)
      views.push(
        await this.render(user, task, te, figures, fromSnapshot, reason, {
          format: opts.format,
          currency,
          unit: 'ACTUAL',
          showNil: opts.showNil,
        }),
      );
    const { lines } = await this.formatLines(
      views[0]!.selection.format,
      views[0]!.selection.isTaskFormat ? task.formatVersion : null,
    );
    const body = await statementsWorkbook({
      views,
      lines,
      figures,
      task: { number: task.number, periodLabel: task.period.label },
      itemStatus: te.status,
      exportedBy: `${user.name} (${user.email})`,
      exportedAt: new Date(),
      fsliNames: new Map((await this.fslis()).map((x) => [x.code, x.name])),
    });
    const suffix = list.length > 1 ? 'all-currencies' : list[0];
    return { name: `${task.number}-${entityCode}-statements-${suffix}.xlsx`, body };
  }

  async saveText(
    user: AuthUser,
    taskId: string,
    entityCode: string,
    input: { kind: 'NOTE1' | 'NOTE2'; text: string },
    ip: string | null,
  ): Promise<void> {
    const task = await loadStepTask(this.prisma, user, taskId);
    assertEditable(user, task, entityCode);
    const key = { taskId_entityCode_kind: { taskId, entityCode, kind: input.kind } };
    const before = await this.prisma.statementText.findUnique({ where: key });
    const text = input.text.trim();
    if (before?.text === text) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.statementText.upsert({
        where: key,
        create: { taskId, entityCode, kind: input.kind, text, updatedById: user.id },
        update: { text, updatedById: user.id },
      });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.StatementNoteUpdate,
          entityType: 'TASK_ENTITY',
          entityId: `${taskId}:${entityCode}`,
          oldValue: { kind: input.kind, text: before?.text ?? null },
          newValue: { kind: input.kind, text, task: task.number, entity: entityCode },
          ip,
        },
        tx,
      );
    });
  }

  async continue(
    user: AuthUser,
    taskId: string,
    entityCode: string,
    ip: string | null,
  ): Promise<{ currentStep: string }> {
    const task = await loadStepTask(this.prisma, user, taskId);
    const te = assertEditable(user, task, entityCode);
    const figures = await this.figuresService.build(task, te);
    if (!figures) throw ApiError.validation('Upload and validate a trial balance first.');
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
          newValue: { step: next, task: task.number, entity: entityCode, format: task.formatCode },
          ip,
        },
        tx,
      );
    });
    return { currentStep: next };
  }
}
