import { createHash } from 'node:crypto';
import { HttpStatus, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  buildStatement,
  checkKey,
  type CheckResult,
  checkSummary,
  Decimal,
  eliminationChecks,
  keyFigures,
  monthsBetween,
  profitAttribution,
  type RegisterEntry,
  runCfsChecks,
  segregationOfDuties,
  statementTitle,
  variance,
} from '@finance-close/engine';
import {
  ApiErrorCode,
  AuditAction,
  CFS_LEVEL_STEPS,
  ERP_LABELS,
  GAAP_LABELS,
  Permission,
  type CfsStatementsDto,
  type CheckResultDto,
  type EntityNotesDto,
  type FinalisedViewDto,
  type KeyFiguresDto,
  type NoteSaveInput,
  type PriorNoteDto,
  type QueryDto,
  type QueryMarkerDto,
  type QueryTargetType,
  type ReviewPackDto,
  type SignOffDto,
  type SnapshotVersionDto,
  type StatementUnitCode,
  type SubmitInput,
} from '@finance-close/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/session-user';
import { ApiError } from '../common/api-error';
import { canonicalJson } from '../common/canonical-json';
import { fromDbDate } from '../common/db-dates';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { inScope } from '../tasks/tasks.service';
import { EditAccessService, type ReopenHook } from '../uploads/edit-access.service';
import { fullSetDocx, fullSetPdf } from '../uploads/notes-export';
import { NotesService, type NotesScope, type NotesTask } from '../uploads/notes.service';
import { NotificationsService } from '../uploads/notifications.service';
import { reviewRecordPdf } from '../uploads/review-record';
import { storeUpload } from '../uploads/stored-files';
import { groupPackWorkbook } from './cfs-pack';
import { levelFigures, levelNotesScope } from './cfs-notes';
import { asEntityStatements, buildCfsStatements } from './cfs-statements';
import {
  type LevelData,
  type LevelSnapshotData,
  ConsolidationService,
} from './consolidation.service';

type Tx = Prisma.TransactionClient;
type Pack = Omit<ReviewPackDto, 'actions' | 'fromSnapshot'>;
const sha256 = (v: unknown) => createHash('sha256').update(canonicalJson(v)).digest('hex');
const key = (level: number) => `L${level}`;
const link = (taskId: string, level: number, step: string) =>
  `/tasks/${taskId}?level=${level}&step=${step}`;
const order = (c: string) => CFS_LEVEL_STEPS.findIndex((s) => s.code === c);

/**
 * CFS steps 4–7 of a level (page 10): consolidated statements, notes (the SFS notes framework),
 * review (the page 8 workflow on the level key "L<n>": submission, queries, sign-offs,
 * segregation of duties) and the atomic finalisation with a hashed, immutable level snapshot.
 */
@Injectable()
export class CfsLevelService implements ReopenHook, OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cfs: ConsolidationService,
    private readonly notes: NotesService,
    private readonly notifications: NotificationsService,
    private readonly editAccess: EditAccessService,
    private readonly storage: StorageService,
  ) {}

  onModuleInit() {
    this.editAccess.setLevelReopenHook(this);
  }

  // ---------------------------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------------------------

  private async parentOf(d: LevelData) {
    return this.prisma.entity.findUniqueOrThrow({ where: { code: d.level.parentEntityCode } });
  }

  private async formatOptions(d: LevelData) {
    const formats = await this.prisma.format.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    const taskCode = d.task.formatCode ?? 'STATUTORY';
    return formats.map((f) => ({
      code: f.code,
      name: f.name,
      version: f.code === taskCode ? (d.task.formatVersion ?? f.currentVersion) : f.currentVersion,
      isTaskFormat: f.code === taskCode,
    }));
  }

  /** The notes scope of a level (forEdit: the level must be editable). */
  async scope(user: AuthUser, d: LevelData, forEdit: boolean): Promise<NotesScope> {
    if (forEdit && d.header.readOnlyReason)
      throw new ApiError(HttpStatus.CONFLICT, ApiErrorCode.Conflict, d.header.readOnlyReason);
    const parent = await this.parentOf(d);
    const { lines } = await this.cfs.formatLines(d.task);
    const subs = d.members.map((m) => m.code);
    const entities = new Map(
      (await this.prisma.entity.findMany({ where: { code: { in: subs } } })).map((e) => [
        e.code,
        { legalName: e.legalName, country: e.country, incorporatedOn: e.incorporatedOn },
      ]),
    );
    const acquisitions = await this.prisma.acquisition.findMany({
      where: { subsidiaryCode: { in: subs } },
      select: { subsidiaryCode: true, acquiredOn: true },
    });
    return levelNotesScope({
      d,
      lines,
      parent: {
        legalName: parent.legalName,
        country: parent.country,
        functionalCurrency: parent.functionalCurrency,
        gaap: GAAP_LABELS[parent.gaap],
        erp: ERP_LABELS[parent.erp],
      },
      entities,
      acquisitions,
      prior: () => this.priorNotes(d),
      changed: async (u) => {
        await this.prisma.taskLevel.update({
          where: { taskId_level: { taskId: d.task.id, level: d.level.level } },
          data: { lastEditedById: u.id },
        });
      },
    });
  }

  /** The same level (same parent) finalised in the most recent earlier period: notes and figures. */
  private async priorNotes(d: LevelData) {
    const levels = await this.prisma.taskLevel.findMany({
      where: {
        parentEntityCode: d.level.parentEntityCode,
        status: 'FINALISED',
        task: { type: 'CFS', period: { endDate: { lt: d.task.period.startDate } } },
      },
      include: { task: { include: { period: true } } },
      orderBy: { task: { period: { endDate: 'desc' } } },
    });
    for (const l of levels) {
      const notes = await this.prisma.entityNote.findMany({
        where: { taskId: l.taskId, entityCode: key(l.level) },
        orderBy: { sortOrder: 'asc' },
      });
      if (notes.length === 0) continue;
      const snap = await this.prisma.finalSnapshot.findFirst({
        where: { taskId: l.taskId, entityCode: key(l.level), state: 'FINAL' },
        orderBy: { version: 'desc' },
      });
      const s = snap?.data as unknown as LevelSnapshotData | undefined;
      const task: NotesTask = {
        id: l.task.id,
        number: l.task.number,
        formatCode: l.task.formatCode,
        formatVersion: l.task.formatVersion,
        period: l.task.period,
      };
      return {
        task,
        notes,
        figures: s
          ? levelFigures({
              members: s.members,
              entries: s.entries,
              consolidated: s.consolidated,
              comparative: s.comparative,
              fslis: d.fslis,
              currency: s.currency,
              periodEnd: fromDbDate(l.task.period.endDate),
            })
          : null,
      };
    }
    return null;
  }

  // ---------------------------------------------------------------------------------------
  // Step 4: consolidated statements
  // ---------------------------------------------------------------------------------------

  async statements(
    user: AuthUser,
    taskId: string,
    level: number,
    opts: { format?: string; unit?: StatementUnitCode; showNil?: boolean; showEntities?: boolean },
  ): Promise<CfsStatementsDto> {
    const d = await this.cfs.levelData(user, taskId, level);
    return this.statementsOf(user, d, opts);
  }

  private async statementsOf(
    user: AuthUser,
    d: LevelData,
    opts: { format?: string; unit?: StatementUnitCode; showNil?: boolean; showEntities?: boolean },
  ): Promise<CfsStatementsDto> {
    const { format, lines, isTask } = await this.cfs.formatLines(d.task, opts.format);
    const parent = await this.parentOf(d);
    const numbers = isTask
      ? await this.notes.lineNumbersIn(user, await this.scope(user, d, false))
      : {};
    return buildCfsStatements(
      d,
      { code: format.code, name: format.name, lines, options: await this.formatOptions(d) },
      {
        unit: opts.unit ?? 'ACTUAL',
        showNil: opts.showNil ?? false,
        showEntities: opts.showEntities ?? true,
      },
      numbers,
      parent.legalName,
    );
  }

  /** Steps 4 and 5 completed: the next step (never moves a level backwards). */
  async continue(
    user: AuthUser,
    taskId: string,
    level: number,
    from: 'STATEMENTS' | 'NOTES',
    ip: string | null,
  ) {
    const d = await this.cfs.levelData(user, taskId, level);
    if (d.header.readOnlyReason)
      throw new ApiError(HttpStatus.CONFLICT, ApiErrorCode.Conflict, d.header.readOnlyReason);
    if (from === 'STATEMENTS') {
      const s = await this.statementsOf(user, d, {});
      const bad = [
        ...(!d.generated ? ['Generate the eliminations first.'] : []),
        ...(!s.ticks.bsBalances
          ? [`The balance sheet does not balance (difference ${s.ticks.bsDifference}).`]
          : []),
        ...(!s.ticks.profitTies ? ['The profit does not tie to the balance sheet.'] : []),
        ...(!s.ticks.crossFoots
          ? ['Entities + eliminations do not cross-foot to the consolidated column.']
          : []),
        ...(!s.ticks.attributionTies ? ['Owners + NCI do not add up to the profit.'] : []),
      ];
      if (bad.length) throw ApiError.validation(bad.join(' '));
    }
    const next = CFS_LEVEL_STEPS[order(from) + 1]!.code;
    const step = order(d.level.currentStep) > order(next) ? d.level.currentStep : next;
    await this.prisma.$transaction(async (tx) => {
      await tx.taskLevel.update({
        where: { taskId_level: { taskId, level } },
        data: { currentStep: step },
      });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.CfsLevelStep,
          entityType: 'TASK_LEVEL',
          entityId: `${taskId}:${level}`,
          oldValue: { step: d.level.currentStep },
          newValue: {
            step,
            task: d.task.number,
            level: `${level} ${d.level.name}`,
            completed: from,
          },
          ip,
        },
        tx,
      );
    });
    return { currentStep: step };
  }

  // ---------------------------------------------------------------------------------------
  // Step 5: notes (the SFS framework on the level scope)
  // ---------------------------------------------------------------------------------------

  async notesView(
    user: AuthUser,
    taskId: string,
    level: number,
    unit?: StatementUnitCode,
  ): Promise<EntityNotesDto> {
    const d = await this.cfs.levelData(user, taskId, level);
    return this.notes.view(user, await this.scope(user, d, false), { unit });
  }

  async notesPrior(
    user: AuthUser,
    taskId: string,
    level: number,
    noteId: string,
    unit?: StatementUnitCode,
  ): Promise<PriorNoteDto> {
    const d = await this.cfs.levelData(user, taskId, level);
    return this.notes.priorIn(await this.scope(user, d, false), noteId, { unit });
  }

  async notesEdit<T>(
    user: AuthUser,
    taskId: string,
    level: number,
    fn: (scope: NotesScope) => Promise<T>,
  ): Promise<T> {
    const d = await this.cfs.levelData(user, taskId, level);
    if (!user.permissions.has(Permission.CfsPrepare))
      throw ApiError.notAllowed(
        'You do not have permission to prepare consolidation (CFS_PREPARE).',
      );
    return fn(await this.scope(user, d, true));
  }

  /** The notes framework (for the level controller). */
  get notesApi(): NotesService {
    return this.notes;
  }

  saveNote(
    user: AuthUser,
    taskId: string,
    level: number,
    noteId: string,
    input: NoteSaveInput,
    ip: string | null,
  ) {
    return this.notesEdit(user, taskId, level, (s) =>
      this.notes.saveIn(user, s, noteId, input, ip),
    );
  }

  // ---------------------------------------------------------------------------------------
  // Step 6: review
  // ---------------------------------------------------------------------------------------

  private async register(): Promise<RegisterEntry[]> {
    const rows = await this.prisma.controlCheck.findMany({
      where: { statementType: 'CFS' },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      severity: r.severity,
      threshold: r.threshold?.toString() ?? null,
      thresholdUnit: (r.thresholdUnit ?? null) as RegisterEntry['thresholdUnit'],
      isActive: r.isActive,
    }));
  }

  private async rule(parentCode: string) {
    return (
      (await this.prisma.approvalRule.findFirst({
        where: { statementType: 'CFS', entityCode: parentCode },
      })) ??
      (await this.prisma.approvalRule.findFirst({
        where: { statementType: 'CFS', entityCode: null },
      })) ?? { reviewLevels: 1, reviewerIds: [] as string[], approverIds: [] as string[] }
    );
  }

  private activeSubmission(taskId: string, level: number) {
    return this.prisma.reviewSubmission.findFirst({
      where: { taskId, entityCode: key(level), status: 'ACTIVE' },
      include: { signOffs: true },
    });
  }

  private async preparerIds(taskId: string, level: number) {
    const subs = await this.prisma.reviewSubmission.findMany({
      where: { taskId, entityCode: key(level) },
      select: { submittedById: true },
    });
    return [...new Set(subs.map((s) => s.submittedById))];
  }

  private async decideBlocked(
    user: AuthUser,
    d: LevelData,
    sub: NonNullable<Awaited<ReturnType<CfsLevelService['activeSubmission']>>>,
  ) {
    if (!user.permissions.has(Permission.CfsReview))
      return 'You do not have the consolidation review permission (CFS_REVIEW).';
    if (d.level.members.some((m) => !inScope(user.entityScope, m)))
      return 'The level covers entities outside your scope.';
    const rule = await this.rule(d.level.parentEntityCode);
    const stage = sub.stage === 2 ? 2 : 1;
    const listed = stage === 1 ? rule.reviewerIds : rule.approverIds;
    if (listed.length > 0 && !listed.includes(user.id) && !user.isMaster)
      return `You are not listed as the ${stage === 1 ? 'reviewer' : 'approver'} for consolidation ${d.level.parentEntityCode} (Configuration → Approvals).`;
    const stageOne = sub.signOffs.find((s) => s.role === 'REVIEWER' && s.decision === 'APPROVED');
    return (
      segregationOfDuties({
        userId: user.id,
        stage,
        preparerIds: await this.preparerIds(d.task.id, d.level.level),
        lastEditedById: d.level.lastEditedById,
        stageOneReviewerId: stageOne?.userId ?? null,
      })?.replace('this entity', 'this level') ?? null
    );
  }

  /** The pack's data and the check results for the level as it is now. */
  private async gather(user: AuthUser, d: LevelData) {
    const register = await this.register();
    const { lines } = await this.cfs.formatLines(d.task);
    const scope = await this.scope(user, d, false);
    const nv = await this.notes.view(user, scope, {});
    const visible = nv.notes.filter((n) => !n.hidden);
    const bs = buildStatement(lines, 'BS', d.consolidated, d.fslis);
    const pl = buildStatement(lines, 'PL', d.consolidated, d.fslis);
    const attribution = profitAttribution(d.consolidated, d.entries);
    const acqs = await this.prisma.acquisition.findMany({
      where: { subsidiaryCode: { in: d.members.map((m) => m.code) }, toBeConfirmed: true },
    });
    const icDifferences = d.entries
      .filter((e) => (e.type === 'IC_BALANCE' || e.type === 'IC_PNL') && e.flagged)
      .map((e) => ({
        entryId: e.id,
        title: e.title,
        amount: e.lines
          .filter((l) => l.fsliCode === 'IC_DIFF')
          .reduce((s, l) => s.plus(l.amount), new Decimal(0))
          .toFixed(2),
        explanation: d.explanations.find((x) => x.entryId === e.id)?.text ?? null,
      }));
    const consol = d.members.filter((m) => m.member).map((m) => m.member!);
    const results: CheckResult[] = runCfsChecks(
      {
        membersNotFinalised: d.members
          .filter((m) => m.sfs.status !== 'FINALISED')
          .map((m) => m.code),
        generated: d.generated,
        stale: d.stale,
        membersChanged: d.membersChanged,
        issues: d.issues,
        eliminationChecks: d.generated ? eliminationChecks(consol, d.entries, d.fslis) : [],
        bs: { totalAssets: bs.totalAssets, totalEquityLiabilities: bs.totalEquityLiabilities },
        profit: { profit: pl.profit, carried: pl.profitCarried },
        attribution,
        icDifferences: icDifferences.map((x) => ({
          title: x.title,
          amount: x.amount,
          explained: Boolean(x.explanation),
        })),
        notes: {
          visible: visible.length,
          notReviewed: visible
            .filter((n) => n.status !== 'REVIEWED')
            .map((n) => `${n.number}. ${n.title}`),
          staleFlags: visible.reduce((s, n) => s + n.stale.length, 0),
        },
        acquisitionsToBeConfirmed: [...new Set(acqs.map((a) => a.subsidiaryCode))],
        comparativePresent: d.comparative.kind !== 'NONE',
      },
      register,
    );
    const kf = (a: Record<string, string> | null) => (a ? keyFigures(a, d.fslis) : null);
    const kc = kf(d.consolidated);
    const kp = kf(d.comparative.consolidated);
    const ac = attribution;
    const ap = d.comparative.consolidated
      ? profitAttribution(d.comparative.consolidated, d.comparative.entries)
      : null;
    const row = (label: string, c: string | null, p: string | null) => ({
      label,
      current: c,
      comparative: p,
      ...variance(c, p),
    });
    const keyFigs: KeyFiguresDto[] = [
      {
        currency: d.level.currency,
        rows: [
          row('Total assets', kc?.totalAssets ?? null, kp?.totalAssets ?? null),
          row('Total equity', kc?.totalEquity ?? null, kp?.totalEquity ?? null),
          row('Revenue', kc?.revenue ?? null, kp?.revenue ?? null),
          row('Profit for the period', ac.total, ap?.total ?? null),
          row('Profit attributable to owners of the parent', ac.owners, ap?.owners ?? null),
          row('Profit attributable to non-controlling interests', ac.nci, ap?.nci ?? null),
        ],
      },
    ];
    const end = statementTitle('BS', d.task.period.type, fromDbDate(d.task.period.endDate)).replace(
      'Balance sheet as at ',
      '',
    );
    const users = new Map(
      (await this.prisma.user.findMany({ select: { id: true, name: true } })).map((u) => [
        u.id,
        u.name,
      ]),
    );
    const pack: Omit<Pack, 'state' | 'signOffs' | 'acknowledgements' | 'changes' | 'queries'> = {
      entity: {
        code: key(d.level.level),
        legalName: scope.header.legalName,
        shortName: d.level.name,
        functionalCurrency: d.level.currency,
        erp: 'Consolidation',
        itemStatus: d.level.status,
      },
      periodLabel: d.task.period.label,
      periodEnd: end,
      comparativeLabel: d.comparative.kind === 'NONE' ? '' : d.comparative.periodLabel,
      declaration: `I confirm the consolidation of Level ${d.level.level} ${d.level.name} as at ${end} uses the finalised standalone statements of every member, and that every elimination and adjustment is reviewed.`,
      checks: results.map((r) => ({ ...r, key: checkKey(r) })) as CheckResultDto[],
      warningsToAcknowledge: checkSummary(results).warnings.map(checkKey),
      keyFigures: keyFigs,
      variances: [],
      notes: {
        visible: visible.length,
        reviewed: visible.filter((n) => n.status === 'REVIEWED').length,
        staleFlags: visible.reduce((s, n) => s + n.stale.length, 0),
        notReviewed: visible
          .filter((n) => n.status !== 'REVIEWED')
          .map((n) => `${n.number}. ${n.title}`),
      },
      translation: [],
      intercompany: [],
      files: d.members.map((m) => ({
        kind: 'SFS snapshot',
        name: `${m.code} ${m.shortName} · ${m.sfs.taskNumber ?? '—'}`,
        version: m.identity?.version ?? null,
        uploadedBy: m.snapshotVersion ?? '—',
        uploadedAt: d.generatedAt ?? new Date(0).toISOString(),
        sha256: m.identity?.hash ?? '—',
      })),
      queryTargets: {
        LINE: [...bs.rows, ...pl.rows]
          .filter((r) => r.type !== 'HEADING')
          .map((r) => ({
            key: `${bs.rows.includes(r) ? 'BS' : 'PL'}:${r.key}`,
            label: `${bs.rows.includes(r) ? 'Balance sheet' : 'P&L'} · ${r.label}`,
          })),
        ACCOUNT: d.entries.map((e) => ({ key: e.id, label: `Elimination · ${e.title}` })),
        NOTE: visible.map((n) => ({ key: n.id, label: `Note ${n.number} · ${n.title}` })),
        CHECK: results.map((r) => ({ key: checkKey(r), label: r.name })),
      },
      consolidation: {
        icDifferences,
        manualAdjustments: d.entries
          .filter((e) => e.type === 'MANUAL')
          .map((e) => {
            const m = d.manual.find((x) => x.id === e.manualId);
            return {
              narration: e.title,
              reason: m?.reason ?? '',
              originLevel: e.originLevel,
              by: m ? (users.get(m.createdById) ?? '—') : '—',
              total: e.lines
                .filter((l) => new Decimal(l.amount).isPositive())
                .reduce((s, l) => s.plus(l.amount), new Decimal(0))
                .toFixed(2),
            };
          }),
        goodwill: d.entries
          .filter((e) => e.type === 'INVESTMENT')
          .map((e) => ({
            title: e.title,
            goodwill: e.goodwill ?? '0.00',
            capitalReserve: new Decimal(e.goodwill ?? '0').isNegative(),
          })),
        nci: d.entries
          .filter((e) => e.type === 'NCI')
          .map((e) => ({
            title: e.title,
            nciProfit: e.nciProfit ?? '0.00',
            nciEquity: e.lines
              .filter((l) => l.fsliCode === 'NCI')
              .reduce((s, l) => s.minus(l.amount), new Decimal(0))
              .toFixed(2),
          })),
        members: d.members.map((m) => ({
          code: m.code,
          shortName: m.shortName,
          taskNumber: m.sfs.taskNumber,
          snapshotVersion: m.snapshotVersion,
          hash: m.identity?.hash ?? null,
        })),
        membersChanged: d.membersChanged,
      },
    };
    return { pack, results };
  }

  private async queries(user: AuthUser, d: LevelData): Promise<QueryDto[]> {
    const rows = await this.prisma.reviewQuery.findMany({
      where: { taskId: d.task.id, entityCode: key(d.level.level) },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });
    const names = new Map(
      (await this.prisma.user.findMany({ select: { id: true, name: true } })).map((u) => [
        u.id,
        u.name,
      ]),
    );
    const fileIds = rows.flatMap((q) =>
      q.messages.map((m) => m.fileId).filter((x): x is string => !!x),
    );
    const files = new Map(
      (await this.prisma.uploadedFile.findMany({ where: { id: { in: fileIds } } })).map((f) => [
        f.id,
        f.originalName,
      ]),
    );
    const editable = d.level.status !== 'FINALISED';
    const reviewer = user.permissions.has(Permission.CfsReview);
    const preparer = user.permissions.has(Permission.CfsPrepare);
    return rows.map((q) => ({
      id: q.id,
      targetType: q.targetType as QueryTargetType,
      targetKey: q.targetKey,
      targetLabel: q.targetLabel,
      link:
        q.targetType === 'LINE'
          ? { step: 'STATEMENTS', key: q.targetKey ?? undefined }
          : q.targetType === 'ACCOUNT'
            ? { step: 'ELIMINATIONS', key: q.targetKey ?? undefined }
            : q.targetType === 'NOTE'
              ? { step: 'NOTES', key: q.targetKey ?? undefined }
              : q.targetType === 'CHECK'
                ? { step: 'REVIEW', key: q.targetKey ?? undefined }
                : null,
      text: q.text,
      status: q.status,
      raisedBy: names.get(q.raisedById) ?? 'Unknown user',
      raisedAt: q.createdAt.toISOString(),
      messages: q.messages.map((m) => ({
        kind: m.kind as QueryDto['messages'][number]['kind'],
        text: m.text,
        author: names.get(m.authorId) ?? 'Unknown user',
        at: m.createdAt.toISOString(),
        file: m.fileId ? { id: m.fileId, name: files.get(m.fileId) ?? 'file' } : null,
      })),
      canAnswer: editable && preparer && q.status !== 'CLOSED',
      canClose: editable && reviewer && q.status !== 'CLOSED',
      canReopen: editable && reviewer && q.status === 'CLOSED',
    }));
  }

  private async signOffs(d: LevelData, levels: number): Promise<SignOffDto[]> {
    const s = await this.prisma.reviewSubmission.findFirst({
      where: { taskId: d.task.id, entityCode: key(d.level.level) },
      include: { signOffs: { orderBy: { createdAt: 'asc' } } },
      orderBy: { number: 'desc' },
    });
    const names = new Map(
      (await this.prisma.user.findMany({ select: { id: true, name: true } })).map((u) => [
        u.id,
        u.name,
      ]),
    );
    const so = (role: 'REVIEWER' | 'APPROVER', active: boolean): SignOffDto => {
      const x = s?.signOffs.filter((o) => o.role === role).at(-1);
      return x
        ? {
            role,
            name: names.get(x.userId) ?? null,
            status: x.decision === 'APPROVED' ? 'APPROVED' : 'RETURNED',
            at: x.createdAt.toISOString(),
            comment: x.comment,
          }
        : { role, name: null, status: active ? 'WAITING' : 'NOT_STARTED', at: null, comment: null };
    };
    return [
      s
        ? {
            role: 'PREPARER',
            name: names.get(s.submittedById) ?? null,
            status: 'SUBMITTED',
            at: s.submittedAt.toISOString(),
            comment: s.status === 'WITHDRAWN' ? s.closedReason : null,
          }
        : { role: 'PREPARER', name: null, status: 'NOT_STARTED', at: null, comment: null },
      so('REVIEWER', s?.status === 'ACTIVE' && s.stage === 1),
      levels === 2
        ? so('APPROVER', s?.status === 'ACTIVE' && s.stage === 2)
        : { role: 'APPROVER', name: null, status: 'NOT_REQUIRED', at: null, comment: null },
    ];
  }

  private async changes(d: LevelData) {
    const last = await this.prisma.reviewSubmission.findFirst({
      where: { taskId: d.task.id, entityCode: key(d.level.level) },
      orderBy: { number: 'desc' },
    });
    const noteIds = (
      await this.prisma.entityNote.findMany({
        where: { taskId: d.task.id, entityCode: key(d.level.level) },
        select: { id: true },
      })
    ).map((n) => n.id);
    const rows = await this.prisma.auditLog.findMany({
      where: {
        timestamp: { gte: last?.submittedAt ?? d.task.createdAt },
        OR: [
          { entityId: `${d.task.id}:${d.level.level}` },
          { entityId: `${d.task.id}:${key(d.level.level)}` },
          { entityId: { in: noteIds } },
        ],
      },
      include: { user: { select: { name: true } } },
      orderBy: { timestamp: 'desc' },
      take: 50,
    });
    return rows.map((r) => {
      const nv = (r.newValue ?? {}) as Record<string, unknown>;
      const detail = ['title', 'narration', 'reason', 'step', 'status', 'text', 'currency']
        .map((k) => (typeof nv[k] === 'string' ? `${k}: ${String(nv[k]).slice(0, 120)}` : null))
        .filter(Boolean)
        .join(' · ');
      return {
        at: r.timestamp.toISOString(),
        user: r.user?.name ?? null,
        action: r.action.replaceAll('_', ' ').toLowerCase(),
        summary: detail,
      };
    });
  }

  async pack(user: AuthUser, taskId: string, level: number): Promise<ReviewPackDto> {
    const d = await this.cfs.levelData(user, taskId, level);
    const noActions: ReviewPackDto['actions'] = {
      canSubmit: false,
      submitBlockedBy: [],
      canDecide: false,
      approveBlockedBy: [],
      canReturn: false,
      canRaiseQuery: false,
      decidingAs: null,
    };
    if (d.fromSnapshot && d.snapshot) {
      const snap = await this.prisma.finalSnapshot.findFirst({
        where: { taskId, entityCode: key(level), state: 'FINAL' },
        orderBy: { version: 'desc' },
      });
      const pack = (snap?.data as { pack?: Pack } | undefined)?.pack;
      if (pack)
        return {
          ...pack,
          fromSnapshot: true,
          actions: noActions,
          entity: { ...pack.entity, itemStatus: 'FINALISED' },
        };
    }
    const g = await this.gather(user, d);
    const rule = await this.rule(d.level.parentEntityCode);
    const active = await this.activeSubmission(taskId, level);
    const levels = active?.reviewLevels ?? rule.reviewLevels;
    const queries = await this.queries(user, d);
    const outstanding = queries.filter((q) => q.status !== 'CLOSED');
    const blocking = checkSummary(g.results).blocking;
    const actions = { ...noActions };
    if (d.level.status !== 'FINALISED' && d.header.available) {
      const preparer =
        user.permissions.has(Permission.CfsPrepare) &&
        d.level.members.every((m) => inScope(user.entityScope, m));
      actions.submitBlockedBy = [
        ...(!preparer ? ['You do not have permission to prepare consolidation.'] : []),
        ...(active ? ['Already submitted for review.'] : []),
        ...(d.membersChanged.length
          ? [`Member data changed – regenerate eliminations (${d.membersChanged.join(', ')}).`]
          : []),
        ...blocking.map((b) => `${b.name}: ${b.details}`),
      ];
      actions.canSubmit = actions.submitBlockedBy.length === 0;
      actions.canRaiseQuery = user.permissions.has(Permission.CfsReview);
      if (active && user.permissions.has(Permission.CfsReview)) {
        const why = await this.decideBlocked(user, d, active);
        actions.decidingAs = active.stage === 2 ? 'APPROVER' : 'REVIEWER';
        actions.canReturn = why === null;
        actions.approveBlockedBy = [
          ...(why ? [why] : []),
          ...(outstanding.length
            ? [
                `${outstanding.length} review quer${outstanding.length === 1 ? 'y is' : 'ies are'} not closed.`,
              ]
            : []),
          ...blocking.map((b) => `Blocking check fails: ${b.name}.`),
        ];
        actions.canDecide = why === null;
      }
    }
    const names = new Map(
      (await this.prisma.user.findMany({ select: { id: true, name: true } })).map((u) => [
        u.id,
        u.name,
      ]),
    );
    const acks = (active?.acknowledgements as { key: string; comment: string }[] | undefined) ?? [];
    return {
      ...g.pack,
      fromSnapshot: false,
      state: {
        stage: active?.stage === 2 ? 2 : 1,
        reviewLevels: levels === 2 ? 2 : 1,
        submissionNumber: active?.number ?? null,
        submittedAt: active?.submittedAt.toISOString() ?? null,
        finalised: null,
      },
      actions,
      signOffs: await this.signOffs(d, levels),
      acknowledgements: acks.map((a) => ({
        ...a,
        by: active ? (names.get(active.submittedById) ?? null) : null,
      })),
      changes: await this.changes(d),
      queries,
    };
  }

  async markers(user: AuthUser, taskId: string, level: number): Promise<QueryMarkerDto[]> {
    await this.cfs.levelContext(user, taskId, level);
    const rows = await this.prisma.reviewQuery.findMany({
      where: { taskId, entityCode: key(level), status: { not: 'CLOSED' } },
      select: { targetType: true, targetKey: true, status: true, text: true },
    });
    return rows.map((r) => ({
      targetType: r.targetType as QueryTargetType,
      targetKey: r.targetKey,
      status: r.status as 'OPEN' | 'ANSWERED',
      text: r.text,
    }));
  }

  private async reviewersFor(parentCode: string, stage: 1 | 2, exclude: string[]) {
    const rule = await this.rule(parentCode);
    const listed = stage === 1 ? rule.reviewerIds : rule.approverIds;
    const ids = listed.length
      ? listed
      : await this.notifications.usersWith(this.prisma, [Permission.CfsReview], null);
    return ids.filter((id) => !exclude.includes(id));
  }

  private async preparerOnly(user: AuthUser, d: LevelData) {
    if (!user.permissions.has(Permission.CfsPrepare))
      throw ApiError.notAllowed(
        'You do not have permission to prepare consolidation (CFS_PREPARE).',
      );
    if (d.level.status === 'FINALISED')
      throw new ApiError(
        HttpStatus.CONFLICT,
        ApiErrorCode.Conflict,
        'This level is finalised: read-only.',
      );
  }

  async submit(
    user: AuthUser,
    taskId: string,
    level: number,
    input: SubmitInput,
    ip: string | null,
  ) {
    const d = await this.cfs.levelData(user, taskId, level);
    await this.preparerOnly(user, d);
    if (!d.header.available)
      throw new ApiError(
        HttpStatus.CONFLICT,
        ApiErrorCode.Conflict,
        `Level ${level} is not available yet.`,
      );
    if (await this.activeSubmission(taskId, level))
      throw new ApiError(
        HttpStatus.CONFLICT,
        ApiErrorCode.Conflict,
        'This level is already submitted for review.',
      );
    if (d.membersChanged.length)
      throw new ApiError(
        HttpStatus.CONFLICT,
        ApiErrorCode.Conflict,
        `Member data changed – regenerate eliminations (${d.membersChanged.join(', ')}) before submitting.`,
      );
    const g = await this.gather(user, d);
    const { blocking, warnings } = checkSummary(g.results);
    if (blocking.length)
      throw ApiError.validation(
        `Cannot submit: ${blocking.length} blocking check(s) fail: ${blocking.map((b) => b.name).join('; ')}.`,
      );
    const acks = new Map(input.acknowledgements.map((a) => [a.key, a.comment.trim()]));
    const missing = warnings.filter((w) => (acks.get(checkKey(w)) ?? '').length < 10);
    if (missing.length)
      throw ApiError.validation(
        `Acknowledge each failing warning with a comment of at least 10 characters: ${missing.map((w) => w.name).join('; ')}.`,
      );
    if (!input.declaration) throw ApiError.validation('Tick the declaration to submit.');
    const rule = await this.rule(d.level.parentEntityCode);
    const number =
      (await this.prisma.reviewSubmission.count({ where: { taskId, entityCode: key(level) } })) + 1;
    const reviewers = await this.reviewersFor(d.level.parentEntityCode, 1, [user.id]);
    await this.prisma.$transaction(async (tx) => {
      await tx.reviewSubmission.create({
        data: {
          taskId,
          entityCode: key(level),
          number,
          reviewLevels: rule.reviewLevels === 2 ? 2 : 1,
          submittedById: user.id,
          declaration: g.pack.declaration,
          checks: g.results as unknown as Prisma.InputJsonValue,
          acknowledgements: warnings.map((w) => ({
            key: checkKey(w),
            comment: acks.get(checkKey(w))!,
          })) as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.taskLevel.update({
        where: { taskId_level: { taskId, level } },
        data: { status: 'IN_REVIEW', currentStep: 'REVIEW' },
      });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.ReviewSubmit,
          entityType: 'TASK_LEVEL',
          entityId: `${taskId}:${level}`,
          oldValue: { status: d.level.status },
          newValue: {
            status: 'IN_REVIEW',
            task: d.task.number,
            level: `${level} ${d.level.name}`,
            submission: number,
            acknowledgements: warnings.map((w) => ({
              check: checkKey(w),
              comment: acks.get(checkKey(w)),
            })),
          },
          ip,
        },
        tx,
      );
      await this.notifications.notify(tx, reviewers, {
        kind: 'SUBMITTED_FOR_REVIEW',
        title: `${d.task.number} Level ${level} ${d.level.name} submitted for your review`,
        body: `${user.name} submitted the consolidation (${d.task.period.label}).`,
        link: link(taskId, level, 'REVIEW'),
      });
    });
    return this.pack(user, taskId, level);
  }

  private async open(user: AuthUser, taskId: string, level: number) {
    const d = await this.cfs.levelData(user, taskId, level);
    if (d.level.status === 'FINALISED')
      throw new ApiError(
        HttpStatus.CONFLICT,
        ApiErrorCode.EntityFinalised,
        'This level is finalised: read-only.',
      );
    return d;
  }

  async raiseQuery(
    user: AuthUser,
    taskId: string,
    level: number,
    input: { targetType: QueryTargetType; targetKey: string | null; text: string },
    ip: string | null,
  ) {
    const d = await this.open(user, taskId, level);
    if (!user.permissions.has(Permission.CfsReview))
      throw ApiError.notAllowed('Only a consolidation reviewer can raise a query.');
    const g = await this.gather(user, d);
    let label = `Level ${level} ${d.level.name}`;
    if (input.targetType !== 'ENTITY') {
      const t = g.pack.queryTargets[input.targetType].find((x) => x.key === input.targetKey);
      if (!t) throw ApiError.validation('Choose the item the query is about.');
      label = t.label;
    }
    const preparers = await this.preparerIds(taskId, level);
    await this.prisma.$transaction(async (tx) => {
      const q = await tx.reviewQuery.create({
        data: {
          taskId,
          entityCode: key(level),
          targetType: input.targetType,
          targetKey: input.targetType === 'ENTITY' ? null : input.targetKey,
          targetLabel: label.slice(0, 300),
          text: input.text.trim(),
          raisedById: user.id,
        },
      });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.QueryRaise,
          entityType: 'TASK_LEVEL',
          entityId: `${taskId}:${level}`,
          oldValue: null,
          newValue: { query: q.id, on: label, text: input.text.trim() },
          ip,
        },
        tx,
      );
      await this.notifications.notify(
        tx,
        [...preparers, ...(d.level.lastEditedById ? [d.level.lastEditedById] : [])].filter(
          (x) => x !== user.id,
        ),
        {
          kind: 'QUERY_RAISED',
          title: `Review query on ${d.task.number} Level ${level}: ${label}`,
          body: input.text.trim(),
          link: link(taskId, level, 'REVIEW'),
        },
      );
    });
    return this.pack(user, taskId, level);
  }

  async answerQuery(
    user: AuthUser,
    taskId: string,
    level: number,
    queryId: string,
    text: string,
    file: { buffer: Buffer; originalname: string; mimetype: string } | null,
    ip: string | null,
  ) {
    const d = await this.open(user, taskId, level);
    if (!user.permissions.has(Permission.CfsPrepare))
      throw ApiError.notAllowed('Only a consolidation preparer can answer a query.');
    const q = await this.prisma.reviewQuery.findFirst({
      where: { id: queryId, taskId, entityCode: key(level) },
    });
    if (!q) throw ApiError.notFound('Query not found.');
    if (q.status === 'CLOSED')
      throw new ApiError(HttpStatus.CONFLICT, ApiErrorCode.Conflict, 'This query is closed.');
    await this.prisma.$transaction(async (tx) => {
      const stored = file
        ? await storeUpload(tx, this.storage, {
            kind: 'OTHER',
            body: file.buffer,
            originalName: file.originalname,
            contentType: file.mimetype,
            taskId,
            entityCode: null,
            uploadedById: user.id,
          })
        : null;
      await tx.queryMessage.create({
        data: {
          queryId,
          kind: 'ANSWER',
          text: text.trim(),
          fileId: stored?.id ?? null,
          authorId: user.id,
        },
      });
      await tx.reviewQuery.update({ where: { id: queryId }, data: { status: 'ANSWERED' } });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.QueryAnswer,
          entityType: 'TASK_LEVEL',
          entityId: `${taskId}:${level}`,
          oldValue: { status: q.status },
          newValue: {
            query: queryId,
            status: 'ANSWERED',
            text: text.trim(),
            file: stored?.originalName ?? null,
          },
          ip,
        },
        tx,
      );
      await this.notifications.notify(tx, [q.raisedById], {
        kind: 'QUERY_ANSWERED',
        title: `Query answered: ${d.task.number} Level ${level} – ${q.targetLabel}`,
        body: text.trim(),
        link: link(taskId, level, 'REVIEW'),
      });
    });
    return this.pack(user, taskId, level);
  }

  async setQueryStatus(
    user: AuthUser,
    taskId: string,
    level: number,
    queryId: string,
    close: boolean,
    comment: string | null,
    ip: string | null,
  ) {
    await this.open(user, taskId, level);
    if (!user.permissions.has(Permission.CfsReview))
      throw ApiError.notAllowed('Only a consolidation reviewer can close or reopen a query.');
    const q = await this.prisma.reviewQuery.findFirst({
      where: { id: queryId, taskId, entityCode: key(level) },
    });
    if (!q) throw ApiError.notFound('Query not found.');
    const status = close ? 'CLOSED' : 'OPEN';
    await this.prisma.$transaction(async (tx) => {
      await tx.queryMessage.create({
        data: {
          queryId,
          kind: close ? 'CLOSE' : 'REOPEN',
          text: comment?.trim() ?? '',
          authorId: user.id,
        },
      });
      await tx.reviewQuery.update({ where: { id: queryId }, data: { status } });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.QueryStatus,
          entityType: 'TASK_LEVEL',
          entityId: `${taskId}:${level}`,
          oldValue: { status: q.status },
          newValue: { query: queryId, status, comment },
          ip,
        },
        tx,
      );
    });
    return this.pack(user, taskId, level);
  }

  async returnToPreparer(
    user: AuthUser,
    taskId: string,
    level: number,
    comment: string,
    ip: string | null,
  ) {
    const d = await this.open(user, taskId, level);
    const sub = await this.activeSubmission(taskId, level);
    if (!sub) throw ApiError.validation('There is no submission to return.');
    const why = await this.decideBlocked(user, d, sub);
    if (why) throw ApiError.notAllowed(why);
    await this.prisma.$transaction(async (tx) => {
      await tx.signOff.create({
        data: {
          submissionId: sub.id,
          role: sub.stage === 2 ? 'APPROVER' : 'REVIEWER',
          decision: 'RETURNED',
          userId: user.id,
          comment: comment.trim(),
        },
      });
      await tx.reviewSubmission.update({
        where: { id: sub.id },
        data: { status: 'RETURNED', closedAt: new Date(), closedReason: comment.trim() },
      });
      await tx.taskLevel.update({
        where: { taskId_level: { taskId, level } },
        data: { status: 'IN_PROGRESS' },
      });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.ReviewReturn,
          entityType: 'TASK_LEVEL',
          entityId: `${taskId}:${level}`,
          oldValue: { status: 'IN_REVIEW' },
          newValue: {
            status: 'IN_PROGRESS',
            task: d.task.number,
            level: `${level} ${d.level.name}`,
            comment: comment.trim(),
          },
          ip,
        },
        tx,
      );
      await this.notifications.notify(tx, [sub.submittedById], {
        kind: 'RETURNED',
        title: `${d.task.number} Level ${level} returned to you`,
        body: `${user.name}: ${comment.trim()}`,
        link: link(taskId, level, 'REVIEW'),
      });
    });
    return this.pack(user, taskId, level);
  }

  async approve(
    user: AuthUser,
    taskId: string,
    level: number,
    comment: string | null,
    ip: string | null,
  ) {
    const d = await this.open(user, taskId, level);
    const sub = await this.activeSubmission(taskId, level);
    if (!sub) throw ApiError.validation('There is no submission to approve.');
    const why = await this.decideBlocked(user, d, sub);
    if (why) throw ApiError.notAllowed(why);
    const outstanding = await this.prisma.reviewQuery.count({
      where: { taskId, entityCode: key(level), status: { not: 'CLOSED' } },
    });
    if (outstanding > 0)
      throw new ApiError(
        HttpStatus.CONFLICT,
        ApiErrorCode.Conflict,
        `Cannot approve: ${outstanding} review quer${outstanding === 1 ? 'y is' : 'ies are'} still open or answered. Close ${outstanding === 1 ? 'it' : 'them'} first.`,
      );
    if (sub.stage < sub.reviewLevels) {
      const approvers = await this.reviewersFor(d.level.parentEntityCode, 2, [
        ...(await this.preparerIds(taskId, level)),
        user.id,
      ]);
      await this.prisma.$transaction(async (tx) => {
        await tx.signOff.create({
          data: {
            submissionId: sub.id,
            role: 'REVIEWER',
            decision: 'APPROVED',
            userId: user.id,
            comment: comment?.trim() || null,
          },
        });
        await tx.reviewSubmission.update({ where: { id: sub.id }, data: { stage: 2 } });
        await this.audit.record(
          {
            userId: user.id,
            action: AuditAction.ReviewApprove,
            entityType: 'TASK_LEVEL',
            entityId: `${taskId}:${level}`,
            oldValue: { stage: 1 },
            newValue: { stage: 2, task: d.task.number, role: 'REVIEWER' },
            ip,
          },
          tx,
        );
        await this.notifications.notify(tx, approvers, {
          kind: 'SUBMITTED_FOR_REVIEW',
          title: `${d.task.number} Level ${level} awaits your approval`,
          body: `Reviewed by ${user.name}.`,
          link: link(taskId, level, 'REVIEW'),
        });
      });
      return this.pack(user, taskId, level);
    }
    await this.finalise(user, d, sub, comment, ip);
    return this.pack(user, taskId, level);
  }

  // ---------------------------------------------------------------------------------------
  // Step 7: finalise (atomic, hashed snapshot), reopen, finalised view and downloads
  // ---------------------------------------------------------------------------------------

  private async finalise(
    user: AuthUser,
    d: LevelData,
    sub: NonNullable<Awaited<ReturnType<CfsLevelService['activeSubmission']>>>,
    comment: string | null,
    ip: string | null,
  ) {
    const taskId = d.task.id;
    const level = d.level.level;
    // 1. Re-run every check on the data as it is now; abort on a blocking failure.
    const g = await this.gather(user, d);
    const blocking = checkSummary(g.results).blocking;
    if (blocking.length || d.membersChanged.length)
      throw new ApiError(
        HttpStatus.CONFLICT,
        ApiErrorCode.Conflict,
        `Cannot finalise: ${[...blocking.map((b) => b.name), ...(d.membersChanged.length ? [`member data changed (${d.membersChanged.join(', ')})`] : [])].join('; ')}.`,
      );
    const statements = await this.statementsOf(user, d, {});
    const notes = await this.prisma.entityNote.findMany({
      where: { taskId, entityCode: key(level) },
      orderBy: { sortOrder: 'asc' },
    });
    const queries = await this.queries(user, d);
    const at = new Date();
    const finalSignOff: SignOffDto = {
      role: sub.reviewLevels === 2 ? 'APPROVER' : 'REVIEWER',
      name: user.name,
      status: 'APPROVED',
      at: at.toISOString(),
      comment: comment?.trim() || null,
    };
    const signOffs = (await this.signOffs(d, sub.reviewLevels)).map((s) =>
      s.role === finalSignOff.role ? finalSignOff : s,
    );
    const names = new Map(
      (await this.prisma.user.findMany({ select: { id: true, name: true } })).map((u) => [
        u.id,
        u.name,
      ]),
    );
    const acknowledgements = (
      (sub.acknowledgements as { key: string; comment: string }[]) ?? []
    ).map((a) => ({ ...a, by: names.get(sub.submittedById) ?? null }));
    const working = await this.prisma.finalSnapshot.findFirst({
      where: { taskId, entityCode: key(level), state: 'WORKING' },
      orderBy: { version: 'desc' },
    });
    const last = await this.prisma.finalSnapshot.aggregate({
      where: { taskId, entityCode: key(level) },
      _max: { version: true },
    });
    const version = working?.version ?? (last._max.version ?? 0) + 1;
    const pack: Pack = {
      ...g.pack,
      entity: { ...g.pack.entity, itemStatus: 'FINALISED' },
      state: {
        stage: sub.stage === 2 ? 2 : 1,
        reviewLevels: sub.reviewLevels === 2 ? 2 : 1,
        submissionNumber: sub.number,
        submittedAt: sub.submittedAt.toISOString(),
        finalised: null,
      },
      signOffs,
      acknowledgements,
      changes: await this.changes(d),
      queries,
    };
    const aggregate: Record<string, string> = {};
    for (const m of d.members)
      if (m.member)
        for (const a of m.member.accounts)
          aggregate[a.fsliCode] = new Decimal(aggregate[a.fsliCode] ?? '0')
            .plus(a.amount)
            .toFixed(2);
    const data: LevelSnapshotData = {
      schema: 1,
      level,
      name: d.level.name,
      currency: d.level.currency,
      parentCode: d.level.parentEntityCode,
      generatedAt: d.generatedAt,
      members: d.members,
      entries: d.entries,
      issues: d.issues,
      aggregate,
      consolidated: d.consolidated,
      comparative: d.comparative,
      explanations: d.explanations,
      manual: d.manual,
      nci: d.entries
        .filter((e) => e.type === 'NCI')
        .map((e) => ({ entityCode: e.entities[0]!, nciProfit: e.nciProfit ?? '0.00' })),
      statements,
      notes: notes.map((n) => ({
        id: n.id,
        sortOrder: n.sortOrder,
        kind: n.kind,
        title: n.title,
        lineKeys: n.lineKeys,
        status: n.status,
        version: n.version,
        blocks: n.blocks,
      })),
      checks: g.results,
      acknowledgements,
      signOffs,
      keyFigures: g.pack.keyFigures,
      pack,
    };
    const json = JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue;
    const hash = sha256(json);
    pack.state.finalised = { at: at.toISOString(), by: user.name, version, hash };
    const withState = JSON.parse(JSON.stringify({ ...data, pack })) as Prisma.InputJsonValue;
    const months = monthsBetween(
      fromDbDate(d.task.period.startDate),
      fromDbDate(d.task.period.endDate),
    );
    const currencies = [
      ...new Set([d.level.currency, ...d.members.map((m) => m.functionalCurrency)]),
    ].filter((c) => c !== 'USD');
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.reviewSubmission.findUniqueOrThrow({ where: { id: sub.id } });
      if (current.status !== 'ACTIVE')
        throw new ApiError(
          HttpStatus.CONFLICT,
          ApiErrorCode.Conflict,
          'The submission changed while finalising. Reload and try again.',
        );
      await tx.signOff.create({
        data: {
          submissionId: sub.id,
          role: finalSignOff.role,
          decision: 'APPROVED',
          userId: user.id,
          comment: finalSignOff.comment,
        },
      });
      await tx.reviewSubmission.update({
        where: { id: sub.id },
        data: { status: 'APPROVED', closedAt: at },
      });
      if (working)
        await tx.finalSnapshot.update({
          where: { id: working.id },
          data: { state: 'FINAL', data: withState, hash, finalisedAt: at },
        });
      else
        await tx.finalSnapshot.create({
          data: {
            taskId,
            entityCode: key(level),
            version,
            state: 'FINAL',
            data: withState,
            hash,
            createdById: user.id,
            finalisedAt: at,
          },
        });
      await tx.exchangeRate.updateMany({
        where: {
          month: { in: months.map((m) => new Date(`${m}T00:00:00.000Z`)) },
          currencyCode: { in: currencies },
        },
        data: { locked: true },
      });
      await tx.taskLevel.update({
        where: { taskId_level: { taskId, level } },
        data: {
          status: 'FINALISED',
          currentStep: 'FINALISED',
          finalisedById: user.id,
          finalisedAt: at,
        },
      });
      const all = await tx.taskLevel.findMany({ where: { taskId }, select: { status: true } });
      if (all.every((x) => x.status === 'FINALISED'))
        await tx.task.update({ where: { id: taskId }, data: { completedAt: at } });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.CfsLevelFinalise,
          entityType: 'TASK_LEVEL',
          entityId: `${taskId}:${level}`,
          oldValue: { status: 'IN_REVIEW' },
          newValue: {
            status: 'FINALISED',
            task: d.task.number,
            level: `${level} ${d.level.name}`,
            snapshot: version,
            hash,
          },
          ip,
        },
        tx,
      );
      await this.notifications.notify(tx, [sub.submittedById], {
        kind: 'FINALISED',
        title: `${d.task.number} Level ${level} ${d.level.name} finalised`,
        body: `Approved by ${user.name}. Snapshot v${version} · hash ${hash.slice(0, 8)}…`,
        link: link(taskId, level, 'FINALISED'),
      });
    });
  }

  /** Edit access granted for a level: a working copy of the next version; the level In progress. */
  async reopen(
    tx: Tx,
    user: AuthUser,
    taskId: string,
    entityCode: string,
    ip: string | null,
  ): Promise<void> {
    const level = Number(entityCode.slice(1));
    const last = await tx.finalSnapshot.findFirst({
      where: { taskId, entityCode, state: 'FINAL' },
      orderBy: { version: 'desc' },
    });
    const task = await tx.task.findUniqueOrThrow({
      where: { id: taskId },
      include: { period: true },
    });
    if (last)
      await tx.finalSnapshot.create({
        data: {
          taskId,
          entityCode,
          version: last.version + 1,
          state: 'WORKING',
          data: last.data as Prisma.InputJsonValue,
          hash: null,
          createdById: user.id,
        },
      });
    await tx.taskLevel.update({
      where: { taskId_level: { taskId, level } },
      data: {
        status: 'IN_PROGRESS',
        currentStep: 'REVIEW',
        finalisedAt: null,
        finalisedById: null,
      },
    });
    await tx.task.update({ where: { id: taskId }, data: { completedAt: null } });
    await this.audit.record(
      {
        userId: user.id,
        action: AuditAction.CfsLevelReopen,
        entityType: 'TASK_LEVEL',
        entityId: `${taskId}:${level}`,
        oldValue: { status: 'FINALISED', snapshot: last?.version ?? null },
        newValue: {
          status: 'IN_PROGRESS',
          task: task.number,
          level,
          workingCopy: last ? last.version + 1 : null,
        },
        ip,
      },
      tx,
    );
  }

  async finalised(user: AuthUser, taskId: string, level: number): Promise<FinalisedViewDto> {
    const { task, level: l } = await this.cfs.levelContext(user, taskId, level);
    const snaps = await this.prisma.finalSnapshot.findMany({
      where: { taskId, entityCode: key(level) },
      orderBy: { version: 'asc' },
    });
    const names = new Map(
      (await this.prisma.user.findMany({ select: { id: true, name: true } })).map((u) => [
        u.id,
        u.name,
      ]),
    );
    const versions: SnapshotVersionDto[] = snaps.map((s) => {
      const x = s.data as {
        keyFigures?: KeyFiguresDto[];
        signOffs?: SignOffDto[];
        checks?: CheckResult[];
      };
      return {
        version: s.version,
        state: s.state as 'FINAL' | 'WORKING',
        hash: s.hash,
        createdBy: names.get(s.createdById) ?? 'Unknown user',
        createdAt: s.createdAt.toISOString(),
        finalisedAt: s.finalisedAt?.toISOString() ?? null,
        keyFigures: x.keyFigures ?? [],
        signOffs: x.signOffs ?? [],
        checks: (x.checks ?? []).map((r) => ({ ...r, key: checkKey(r) })) as CheckResultDto[],
      };
    });
    const lastFinal = [...snaps].reverse().find((s) => s.state === 'FINAL');
    const finalised =
      l.status === 'FINALISED' && lastFinal
        ? {
            at: (lastFinal.finalisedAt ?? lastFinal.createdAt).toISOString(),
            by: l.finalisedById ? (names.get(l.finalisedById) ?? '') : '',
            version: lastFinal.version,
            hash: lastFinal.hash ?? '',
          }
        : null;
    const pending =
      (await this.editAccess.list(user)).find(
        (r) => r.taskId === taskId && r.entityCode === key(level) && r.status === 'PENDING',
      ) ?? null;
    const blocked =
      l.status === 'FINALISED'
        ? await this.editAccess.reopenBlocked(this.prisma, taskId, key(level))
        : null;
    const parent = await this.prisma.entity.findUniqueOrThrow({
      where: { code: l.parentEntityCode },
    });
    return {
      entity: {
        code: key(level),
        legalName: `${parent.legalName} — consolidated (Level ${level} ${l.name})`,
        shortName: l.name,
        functionalCurrency: l.currency,
        erp: 'Consolidation',
        itemStatus: l.status,
      },
      periodLabel: task.period.label,
      banner: finalised
        ? `Finalised on ${finalised.at.slice(0, 10)} by ${finalised.by}. Snapshot v${finalised.version} · hash ${finalised.hash.slice(0, 12)}…`
        : null,
      finalised,
      versions,
      canRequestEditAccess:
        l.status === 'FINALISED' &&
        !pending &&
        blocked === null &&
        user.permissions.has(Permission.CfsPrepare),
      pendingRequest: pending,
      reopenBlocked: blocked,
    };
  }

  async reviewRecord(user: AuthUser, taskId: string, level: number, version?: number) {
    const { task } = await this.cfs.levelContext(user, taskId, level);
    const s = await this.prisma.finalSnapshot.findFirst({
      where: { taskId, entityCode: key(level), state: 'FINAL', ...(version ? { version } : {}) },
      orderBy: { version: 'desc' },
    });
    if (!s) throw ApiError.notFound('No finalised snapshot for this level.');
    const pack = (s.data as unknown as { pack: Pack }).pack;
    return {
      name: `${task.number}-L${level}-review-record-v${s.version}.pdf`,
      body: await reviewRecordPdf({
        pack,
        taskNumber: task.number,
        version: s.version,
        hash: s.hash ?? '',
        finalisedAt: (s.finalisedAt ?? s.createdAt).toISOString(),
        exportedBy: `${user.name} (${user.email})`,
      }),
    };
  }

  /** Word / PDF consolidated financial statements (the SFS exporter on the level). */
  async fullSet(
    user: AuthUser,
    taskId: string,
    level: number,
    type: 'docx' | 'pdf',
    unit?: StatementUnitCode,
  ) {
    const d = await this.cfs.levelData(user, taskId, level);
    const parent = await this.parentOf(d);
    const s = await this.statementsOf(user, d, { unit, showEntities: false });
    const notes = await this.notes.view(user, await this.scope(user, d, false), { unit });
    const input = {
      statements: asEntityStatements(s, parent.legalName),
      notes,
      taskNumber: d.task.number,
      exportedBy: `${user.name} (${user.email})`,
      exportedAt: new Date(),
      subtitle: `Consolidated financial statements — Level ${level} ${d.level.name}`,
      signature: {
        entityName: parent.legalName,
        lines: ['Director', 'Director', 'Chief Financial Officer'],
      },
    };
    return {
      name: `${d.task.number}-L${level}-consolidated-financial-statements.${type}`,
      body: type === 'docx' ? await fullSetDocx(input) : await fullSetPdf(input),
    };
  }

  /** The group reporting pack (Excel) of a level. */
  async groupPack(user: AuthUser, taskId: string, level: number) {
    const d = await this.cfs.levelData(user, taskId, level);
    const { lines } = await this.cfs.formatLines(d.task);
    const g = await this.gather(user, d);
    const rates = await this.cfs.levelRatesFor(d);
    const notes = await this.notes.view(user, await this.scope(user, d, false), {});
    return {
      name: `${d.task.number}-L${level}-${d.level.name.replace(/\s+/g, '-')}-group-pack.xlsx`,
      body: await groupPackWorkbook({ d, lines, checks: g.results, rates, notes }),
    };
  }
}
