import { createHash } from 'node:crypto';
import { HttpStatus, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  checkKey,
  type CheckResult,
  checkSummary,
  type CurrencyData,
  Decimal,
  deriveTaskStatus,
  type EntityCheckData,
  fsliAmounts,
  intercompanyNote,
  keyFigures,
  monthsBetween,
  type RegisterEntry,
  runSfsChecks,
  segregationOfDuties,
  statementTitle,
  type TranslateTbResult,
  variance,
} from '@finance-close/engine';
import {
  ApiErrorCode,
  AuditAction,
  declarationText,
  ERP_LABELS,
  Permission,
  type CheckResultDto,
  type FinalisedViewDto,
  type KeyFiguresDto,
  type QueryDto,
  type QueryMarkerDto,
  type QueryTargetType,
  type ReviewPackDto,
  type ReviewStepDto,
  type SignOffDto,
  type SnapshotVersionDto,
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
import { ComparativesService } from './comparatives.service';
import { EditAccessService, type ReopenHook } from './edit-access.service';
import { loadFormatLines, loadFslis } from './format-lines';
import { NotesService } from './notes.service';
import { NotificationsService } from './notifications.service';
import { type EntityFigures, StatementFiguresService } from './statement-figures';
import { StatementsService } from './statements.service';
import {
  assertEditable,
  assertViewable,
  isTaskLocked,
  loadStepTask,
  readOnlyReason,
  type StepTask,
} from './step-access';
import { storeUpload } from './stored-files';
import { mappedLines, monthlyRates } from './translation-inputs';
import { TranslationService } from './translation.service';

type Tx = Prisma.TransactionClient;
type TaskEntityRow = StepTask['entities'][number];
type Pack = Omit<ReviewPackDto, 'actions' | 'fromSnapshot'>;

const sha256 = (v: unknown) => createHash('sha256').update(canonicalJson(v)).digest('hex');
const link = (taskId: string, step: string, entity: string) =>
  `/tasks/${taskId}?step=${step}&entity=${entity}`;
const ACTION_TEXT: Record<string, string> = {
  TB_UPLOAD: 'Trial balance uploaded',
  ACCOUNT_MAP: 'Account mapped',
  ACCOUNT_UPDATE: 'Account mapping changed in configuration',
  VARIANCE_EXPLAIN: 'Variance explained',
  NOTE_UPDATE: 'Note edited',
  NOTE_CREATE: 'Note added',
  NOTE_DELETE: 'Note deleted',
  NOTE_REVIEW: 'Note review status changed',
  NOTES_ROLL_FORWARD: 'Notes rolled forward',
  RATES_UPDATE: 'Exchange rates changed',
  RATES_UPLOAD: 'Exchange rates uploaded',
  TASK_STEP_CONTINUE: 'Step completed',
  REVIEW_SUBMIT: 'Submitted for review',
  REVIEW_WITHDRAW: 'Submission withdrawn',
  REVIEW_RETURN: 'Returned to preparer',
  REVIEW_APPROVE: 'Approved',
  QUERY_RAISE: 'Query raised',
  QUERY_ANSWER: 'Query answered',
  QUERY_STATUS: 'Query closed / reopened',
  COMPARATIVE_BASIS_CHANGE: 'Comparative basis changed',
};

/**
 * Task steps "Review" and "Finalised" (page 8). The pack, submission, review queries, the
 * reviewer / approver decisions with segregation of duties, the atomic finalisation with its
 * hashed snapshot, and reopening through edit access (a new working version; v1 is kept).
 */
@Injectable()
export class ReviewService implements ReopenHook, OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly figures: StatementFiguresService,
    private readonly statements: StatementsService,
    private readonly notes: NotesService,
    private readonly translation: TranslationService,
    private readonly comparatives: ComparativesService,
    private readonly notifications: NotificationsService,
    private readonly editAccess: EditAccessService,
    private readonly storage: StorageService,
  ) {}

  onModuleInit() {
    this.editAccess.setReopenHook(this);
    this.editAccess.notify = async (tx, kind, requestId) => {
      const r = await tx.editAccessRequest.findUniqueOrThrow({
        where: { id: requestId },
        include: { task: true, requestedBy: true },
      });
      if (kind === 'EDIT_ACCESS_REQUESTED') {
        const approvers = await this.notifications.usersWith(
          tx,
          [Permission.EditAccessApprove],
          r.entityCode,
        );
        await this.notifications.notify(
          tx,
          approvers.filter((id) => id !== r.requestedById),
          {
            kind,
            title: `Edit access requested: ${r.entityCode} ${r.task.number}`,
            body: `${r.requestedBy.name}: ${r.reason}`,
            link: '/edit-access',
          },
        );
      } else {
        await this.notifications.notify(tx, [r.requestedById], {
          kind,
          title: `Edit access ${r.status === 'APPROVED' ? 'approved' : 'rejected'}: ${r.entityCode} ${r.task.number}`,
          body: r.decisionComment,
          link: link(r.taskId, r.status === 'APPROVED' ? 'REVIEW' : 'FINALISED', r.entityCode),
        });
      }
    };
  }

  // ---------------------------------------------------------------------------------------
  // Register, rules, roles
  // ---------------------------------------------------------------------------------------

  async register(db: Tx | PrismaService = this.prisma): Promise<RegisterEntry[]> {
    const rows = await db.controlCheck.findMany({
      where: { statementType: 'SFS' },
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

  private async rule(entityCode: string) {
    return (
      (await this.prisma.approvalRule.findFirst({ where: { statementType: 'SFS', entityCode } })) ??
      (await this.prisma.approvalRule.findFirst({
        where: { statementType: 'SFS', entityCode: null },
      })) ?? {
        reviewLevels: 1,
        reviewerIds: [] as string[],
        approverIds: [] as string[],
      }
    );
  }

  private async preparerIds(taskId: string, entityCode: string): Promise<string[]> {
    const subs = await this.prisma.reviewSubmission.findMany({
      where: { taskId, entityCode },
      select: { submittedById: true },
    });
    return [...new Set(subs.map((s) => s.submittedById))];
  }

  private async activeSubmission(taskId: string, entityCode: string) {
    return this.prisma.reviewSubmission.findFirst({
      where: { taskId, entityCode, status: 'ACTIVE' },
      include: { signOffs: true },
    });
  }

  /** Why this user cannot decide the active submission at its stage, or null. */
  private async decideBlocked(
    user: AuthUser,
    task: StepTask,
    te: TaskEntityRow,
    sub: NonNullable<Awaited<ReturnType<ReviewService['activeSubmission']>>>,
  ) {
    if (!user.permissions.has(Permission.SfsReview))
      return 'You do not have the review permission (SFS_REVIEW).';
    if (!inScope(user.entityScope, te.entityCode))
      return `${te.entityCode} is outside your entity scope.`;
    const rule = await this.rule(te.entityCode);
    const stage = sub.stage === 2 ? 2 : 1;
    const listed = stage === 1 ? rule.reviewerIds : rule.approverIds;
    if (listed.length > 0 && !listed.includes(user.id) && !user.isMaster)
      return `You are not listed as the ${stage === 1 ? 'reviewer' : 'approver'} for ${te.entityCode} (Configuration → Approvals).`;
    const stageOne = sub.signOffs.find((s) => s.role === 'REVIEWER' && s.decision === 'APPROVED');
    return segregationOfDuties({
      userId: user.id,
      stage,
      preparerIds: await this.preparerIds(task.id, te.entityCode),
      lastEditedById: te.lastEditedById,
      stageOneReviewerId: stageOne?.userId ?? null,
    });
  }

  // ---------------------------------------------------------------------------------------
  // Gathering the pack (live) and the checks
  // ---------------------------------------------------------------------------------------

  private async gather(user: AuthUser, task: StepTask, te: TaskEntityRow) {
    const reason = readOnlyReason(user, task, te.entityCode);
    const { figures, fromSnapshot } = await this.figures.figures(
      task,
      te,
      te.status === 'FINALISED',
    );
    const fslis = await loadFslis(this.prisma);
    const fsliRows = await this.prisma.fsli.findMany();
    const needsCp = new Set(fsliRows.filter((f) => f.needsCounterparty).map((f) => f.code));
    const version = await this.prisma.tbVersion.findFirst({
      where: {
        taskId: task.id,
        entityCode: te.entityCode,
        purpose: 'CURRENT',
        status: { not: 'ERROR' },
      },
      orderBy: { version: 'desc' },
      include: { lines: true, file: { include: { uploadedBy: { select: { name: true } } } } },
    });
    const debits = (version?.lines ?? []).reduce(
      (s, l) => (l.amount.isPositive() ? s.plus(l.amount.toString()) : s),
      new Decimal(0),
    );
    const credits = (version?.lines ?? []).reduce(
      (s, l) => (l.amount.isNegative() ? s.minus(l.amount.toString()) : s),
      new Decimal(0),
    );
    const functional = figures?.currencies[0]?.current;
    const entities = await this.prisma.entity.findMany({ select: { code: true, legalName: true } });
    const entityName = new Map(entities.map((e) => [e.code, e.legalName]));

    const currencies: CurrencyData[] = [];
    const keyFigs: KeyFiguresDto[] = [];
    let notesSummary = { visible: 0, reviewed: 0, staleFlags: 0, notReviewed: [] as string[] };
    const lineTargets: { key: string; label: string }[] = [];
    const noteTargets: { key: string; label: string }[] = [];
    for (const c of figures?.currencies ?? []) {
      const sv = await this.statements.render(user, task, te, figures, fromSnapshot, reason, {
        currency: c.currency,
        unit: 'ACTUAL',
        showNil: false,
      });
      const ta = sv.balanceSheet.rows.find((r) => r.role === 'TOTAL_ASSETS');
      const tel = sv.balanceSheet.rows.find((r) => r.role === 'TOTAL_EQUITY_LIABILITIES');
      const profit = sv.profitAndLoss.rows.find((r) => r.role === 'PROFIT');
      const nv = await this.notes.entity(user, task.id, te.entityCode, {
        currency: c.currency,
        unit: 'ACTUAL',
      });
      const visible = nv.notes.filter((n) => !n.hidden);
      if (c.currency === figures!.functionalCurrency) {
        notesSummary = {
          visible: visible.length,
          reviewed: visible.filter((n) => n.status === 'REVIEWED').length,
          staleFlags: visible.reduce((s, n) => s + n.stale.length, 0),
          notReviewed: visible
            .filter((n) => n.status !== 'REVIEWED')
            .map((n) => `${n.number}. ${n.title}`),
        };
        for (const [st, view] of [
          ['BS', sv.balanceSheet],
          ['PL', sv.profitAndLoss],
        ] as const)
          for (const r of view.rows.filter((x) => x.type !== 'HEADING'))
            lineTargets.push({
              key: `${st}:${r.key}`,
              label: `${st === 'BS' ? 'Balance sheet' : 'P&L'} · ${r.label}`,
            });
        for (const n of visible)
          noteTargets.push({ key: n.id, label: `Note ${n.number} · ${n.title}` });
      }
      const translatedTotal =
        c.translatedFrom && c.current.status === 'OK'
          ? c.current.accounts
              .reduce((s, a) => s.plus(a.amount), new Decimal(c.current.fctr ?? '0'))
              .toFixed(2)
          : null;
      currencies.push({
        currency: c.currency,
        translated: c.translatedFrom !== null,
        translationStatus: c.current.status,
        translationFailures: c.current.failures,
        translatedTotal,
        totalAssets: ta?.current ?? null,
        totalEquityLiabilities: tel?.current ?? null,
        profit: profit?.current ?? null,
        profitCarried:
          profit?.current && profit.tie
            ? new Decimal(profit.current).minus(profit.tie.current.difference).toFixed(2)
            : null,
        noteDifferences: visible.flatMap((n) =>
          Object.values(n.figures)
            .filter((f) => f.face.current !== null && !f.ties.current)
            .map((f) => ({
              note: `${n.number}. ${n.title}`,
              difference: new Decimal(f.total.current).minus(f.face.current!).toFixed(2),
            })),
        ),
      });
      const amounts = (p: typeof c.current | null) =>
        p && p.status === 'OK' ? fsliAmounts(p.accounts, fslis, p.fctr).amounts : null;
      const cur = amounts(c.current);
      const comp = amounts(c.comparative);
      const kc = cur ? keyFigures(cur, fslis) : null;
      const kp = comp ? keyFigures(comp, fslis) : null;
      const row = (label: string, k: keyof ReturnType<typeof keyFigures>) => ({
        label,
        current: kc?.[k] ?? null,
        comparative: kp?.[k] ?? null,
        ...variance(kc?.[k] ?? null, kp?.[k] ?? null),
      });
      keyFigs.push({
        currency: c.currency,
        rows: [
          row('Total assets', 'totalAssets'),
          row('Total equity', 'totalEquity'),
          row('Revenue', 'revenue'),
          row('Profit for the period', 'profit'),
        ],
      });
    }

    const comp = figures ? await this.comparatives.entity(user, task.id, te.entityCode) : null;
    const flagged = (comp?.accountRows ?? []).filter((r) => r.flagged);
    const tr = figures ? await this.translation.entity(user, task.id, te.entityCode) : null;
    const historicalTbc = te.entity.historicalRates
      .filter(
        (h) =>
          h.toBeConfirmed &&
          (figures?.currencies ?? []).some(
            (c) => c.currency === h.targetCurrency && c.translatedFrom,
          ),
      )
      .map((h) => h.targetCurrency);

    const data: EntityCheckData = {
      tb: version ? { debits: debits.toFixed(2), credits: credits.toFixed(2) } : null,
      unmappedAccounts: (functional?.accounts ?? []).filter((a) => !a.fsliCode).map((a) => a.code),
      icWithoutCounterparty: (functional?.accounts ?? [])
        .filter((a) => a.fsliCode && needsCp.has(a.fsliCode) && !a.counterpartyCode)
        .map((a) => a.code),
      currencies,
      rollForwardDifference:
        comp && (comp.rollForward.status === 'PASS' || comp.rollForward.status === 'FAIL')
          ? (comp.rollForward.difference ?? '0.00')
          : null,
      unexplainedVariances: flagged.filter((r) => !r.explanation).map((r) => r.code),
      notes: {
        visible: notesSummary.visible,
        notReviewed: notesSummary.notReviewed,
        staleFlags: notesSummary.staleFlags,
      },
      comparativePresent: (figures?.comparative.kind ?? 'NONE') !== 'NONE',
      historicalRatesToBeConfirmed: historicalTbc,
    };
    const results = runSfsChecks(data, await this.register());

    const files = await this.prisma.uploadedFile.findMany({
      where: { taskId: task.id, entityCode: te.entityCode },
      include: { uploadedBy: { select: { name: true } } },
      orderBy: { uploadedAt: 'desc' },
    });
    const versions = await this.prisma.tbVersion.findMany({
      where: { taskId: task.id, entityCode: te.entityCode },
      select: { fileId: true, version: true },
    });
    const versionOf = new Map(versions.map((v) => [v.fileId, v.version]));

    const pack: Omit<Pack, 'state' | 'signOffs' | 'acknowledgements' | 'changes' | 'queries'> = {
      entity: {
        code: te.entityCode,
        legalName: te.entity.legalName,
        shortName: te.entity.shortName,
        functionalCurrency: te.entity.functionalCurrency,
        erp: ERP_LABELS[te.entity.erp],
        itemStatus: te.status,
      },
      periodLabel: task.period.label,
      periodEnd: statementTitle('BS', task.period.type, fromDbDate(task.period.endDate)).replace(
        'Balance sheet as at ',
        '',
      ),
      comparativeLabel: figures?.comparative.periodLabel ?? '',
      declaration: declarationText(
        ERP_LABELS[te.entity.erp],
        statementTitle('BS', task.period.type, fromDbDate(task.period.endDate)).replace(
          'Balance sheet as at ',
          '',
        ),
      ),
      checks: results.map((r) => ({ ...r, key: checkKey(r) })),
      warningsToAcknowledge: checkSummary(results).warnings.map(checkKey),
      keyFigures: keyFigs,
      variances: flagged.map((r) => ({
        code: r.code,
        name: r.name,
        current: r.current,
        comparative: r.comparative ?? '0.00',
        variance: r.variance ?? '0.00',
        variancePct: r.variancePct,
        explanation: r.explanation?.text ?? null,
      })),
      notes: notesSummary,
      translation: (tr?.currencies ?? []).map((c) => ({
        currency: c.target,
        rates: {
          opening: c.rates.opening.value,
          closing: c.rates.closing.value,
          average: c.rates.average.value,
          historical: c.rates.historical.value,
        },
        fctr: c.fctr,
        fctrMovement: c.fctrMovement?.movement ?? null,
        reMethod: c.reMethod.text,
      })),
      intercompany: intercompanyNote(functional?.accounts ?? [], null).map((r) => ({
        counterpartyCode: r.counterpartyCode,
        counterpartyName: entityName.get(r.counterpartyCode) ?? r.counterpartyCode,
        ...r.current,
      })),
      files: files.map((f) => ({
        kind: f.kind,
        name: f.originalName,
        version: versionOf.get(f.id) ?? null,
        uploadedBy: f.uploadedBy.name,
        uploadedAt: f.uploadedAt.toISOString(),
        sha256: f.sha256,
      })),
      queryTargets: {
        LINE: lineTargets,
        ACCOUNT: (functional?.accounts ?? []).map((a) => ({
          key: a.code,
          label: `${a.code} ${a.name}`,
        })),
        NOTE: noteTargets,
        CHECK: results.map((r) => ({
          key: checkKey(r),
          label: `${r.name}${r.currency ? ` (${r.currency})` : ''}`,
        })),
      },
    };
    return { pack, results, figures, version, reason };
  }

  private async queries(user: AuthUser, task: StepTask, te: TaskEntityRow): Promise<QueryDto[]> {
    const rows = await this.prisma.reviewQuery.findMany({
      where: { taskId: task.id, entityCode: te.entityCode },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });
    const ids = [
      ...new Set(rows.flatMap((q) => [q.raisedById, ...q.messages.map((m) => m.authorId)])),
    ];
    const names = new Map(
      (
        await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      ).map((u) => [u.id, u.name]),
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
    const editable = te.status !== 'FINALISED' && !isTaskLocked(task);
    const reviewer = user.permissions.has(Permission.SfsReview);
    const preparer =
      user.permissions.has(Permission.SfsPrepare) && inScope(user.entityScope, te.entityCode);
    return rows.map((q) => ({
      id: q.id,
      targetType: q.targetType as QueryTargetType,
      targetKey: q.targetKey,
      targetLabel: q.targetLabel,
      link:
        q.targetType === 'LINE'
          ? { step: 'STATEMENTS', key: q.targetKey ?? undefined }
          : q.targetType === 'ACCOUNT'
            ? { step: 'MAPPING', key: q.targetKey ?? undefined }
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

  private async signOffs(task: StepTask, te: TaskEntityRow, levels: number): Promise<SignOffDto[]> {
    const subs = await this.prisma.reviewSubmission.findMany({
      where: { taskId: task.id, entityCode: te.entityCode },
      include: { signOffs: { orderBy: { createdAt: 'asc' } } },
      orderBy: { number: 'desc' },
      take: 1,
    });
    const s = subs[0];
    const ids = [s?.submittedById, ...(s?.signOffs.map((x) => x.userId) ?? [])].filter(
      (x): x is string => !!x,
    );
    const names = new Map(
      (
        await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      ).map((u) => [u.id, u.name]),
    );
    const decision = (role: 'REVIEWER' | 'APPROVER') =>
      s?.signOffs.filter((x) => x.role === role).at(-1);
    const so = (role: 'REVIEWER' | 'APPROVER', active: boolean): SignOffDto => {
      const d = decision(role);
      if (d)
        return {
          role,
          name: names.get(d.userId) ?? null,
          status: d.decision === 'APPROVED' ? 'APPROVED' : 'RETURNED',
          at: d.createdAt.toISOString(),
          comment: d.comment,
        };
      return {
        role,
        name: null,
        status: active ? 'WAITING' : 'NOT_STARTED',
        at: null,
        comment: null,
      };
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

  private async changes(task: StepTask, te: TaskEntityRow) {
    const last = await this.prisma.reviewSubmission.findFirst({
      where: { taskId: task.id, entityCode: te.entityCode },
      orderBy: { number: 'desc' },
    });
    const noteIds = (
      await this.prisma.entityNote.findMany({
        where: { taskId: task.id, entityCode: te.entityCode },
        select: { id: true },
      })
    ).map((n) => n.id);
    const rows = await this.prisma.auditLog.findMany({
      where: {
        timestamp: { gte: last?.submittedAt ?? task.createdAt },
        OR: [
          { entityId: `${task.id}:${te.entityCode}` },
          { entityId: { in: noteIds } },
          { entityType: 'ENTITY_ACCOUNT', entityId: { startsWith: `${te.entityCode}:` } },
          { entityType: 'ENTITY_ACCOUNTS', entityId: te.entityCode },
        ],
      },
      include: { user: { select: { name: true } } },
      orderBy: { timestamp: 'desc' },
      take: 50,
    });
    return rows.map((r) => {
      const nv = (r.newValue ?? {}) as Record<string, unknown>;
      const detail = ['title', 'account', 'reason', 'step', 'status', 'text']
        .map((k) =>
          typeof nv[k] === 'string'
            ? `${k === 'text' ? '' : `${k}: `}${String(nv[k]).slice(0, 120)}`
            : null,
        )
        .filter(Boolean)
        .join(' · ');
      return {
        at: r.timestamp.toISOString(),
        user: r.user?.name ?? null,
        action: ACTION_TEXT[r.action] ?? r.action,
        summary: detail,
      };
    });
  }

  // ---------------------------------------------------------------------------------------
  // The pack
  // ---------------------------------------------------------------------------------------

  private async latestFinal(taskId: string, entityCode: string) {
    return this.prisma.finalSnapshot.findFirst({
      where: { taskId, entityCode, state: 'FINAL' },
      orderBy: { version: 'desc' },
    });
  }

  async pack(user: AuthUser, taskId: string, entityCode: string): Promise<ReviewPackDto> {
    const task = await loadStepTask(this.prisma, user, taskId);
    const te = assertViewable(user, task, entityCode);
    const noActions: ReviewPackDto['actions'] = {
      canSubmit: false,
      submitBlockedBy: [],
      canDecide: false,
      approveBlockedBy: [],
      canReturn: false,
      canRaiseQuery: false,
      decidingAs: null,
    };
    if (te.status === 'FINALISED') {
      const snap = await this.latestFinal(taskId, entityCode);
      const data = snap?.data as { pack?: Pack } | undefined;
      if (snap && data?.pack)
        return {
          ...data.pack,
          fromSnapshot: true,
          actions: noActions,
          entity: { ...data.pack.entity, itemStatus: 'FINALISED' },
        };
    }
    const g = await this.gather(user, task, te);
    const rule = await this.rule(entityCode);
    const active = await this.activeSubmission(taskId, entityCode);
    const levels = active?.reviewLevels ?? rule.reviewLevels;
    const queries = await this.queries(user, task, te);
    const outstanding = queries.filter((q) => q.status !== 'CLOSED');
    const blocking = checkSummary(g.results).blocking;
    const actions = { ...noActions };
    if (te.status !== 'FINALISED' && !isTaskLocked(task)) {
      const preparer =
        user.permissions.has(Permission.SfsPrepare) && inScope(user.entityScope, entityCode);
      actions.submitBlockedBy = [
        ...(!preparer ? ['You do not have permission to prepare this entity.'] : []),
        ...(active ? ['Already submitted for review.'] : []),
        ...(!g.version ? ['Upload and validate a trial balance first.'] : []),
        ...blocking.map((b) => `${b.name}${b.currency ? ` (${b.currency})` : ''}: ${b.details}`),
      ];
      actions.canSubmit = actions.submitBlockedBy.length === 0;
      actions.canRaiseQuery = user.permissions.has(Permission.SfsReview);
      if (active && user.permissions.has(Permission.SfsReview)) {
        const why = await this.decideBlocked(user, task, te, active);
        actions.decidingAs = active.stage === 2 ? 'APPROVER' : 'REVIEWER';
        actions.canReturn = why === null;
        actions.approveBlockedBy = [
          ...(why ? [why] : []),
          ...(outstanding.length
            ? [
                `${outstanding.length} review quer${outstanding.length === 1 ? 'y is' : 'ies are'} not closed.`,
              ]
            : []),
          ...blocking.map(
            (b) => `Blocking check fails: ${b.name}${b.currency ? ` (${b.currency})` : ''}.`,
          ),
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
      signOffs: await this.signOffs(task, te, levels),
      acknowledgements: acks.map((a) => ({
        ...a,
        by: active ? (names.get(active.submittedById) ?? null) : null,
      })),
      changes: await this.changes(task, te),
      queries,
    };
  }

  /** Not-closed queries of an entity, for the markers in the earlier steps. */
  async markers(user: AuthUser, taskId: string, entityCode: string): Promise<QueryMarkerDto[]> {
    const task = await loadStepTask(this.prisma, user, taskId);
    assertViewable(user, task, entityCode);
    const rows = await this.prisma.reviewQuery.findMany({
      where: { taskId, entityCode, status: { not: 'CLOSED' } },
      select: { targetType: true, targetKey: true, status: true, text: true },
    });
    return rows.map((r) => ({
      targetType: r.targetType as QueryTargetType,
      targetKey: r.targetKey,
      status: r.status as 'OPEN' | 'ANSWERED',
      text: r.text,
    }));
  }

  async step(user: AuthUser, taskId: string): Promise<ReviewStepDto> {
    const task = await loadStepTask(this.prisma, user, taskId);
    const open = await this.prisma.reviewQuery.groupBy({
      by: ['entityCode'],
      where: { taskId, status: { not: 'CLOSED' } },
      _count: true,
    });
    const count = new Map(open.map((o) => [o.entityCode, o._count]));
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
      entities: [...task.entities]
        .filter((e) => inScope(user.entityScope, e.entityCode))
        .sort((a, b) => a.entity.sortOrder - b.entity.sortOrder)
        .map((e) => ({
          code: e.entityCode,
          shortName: e.entity.shortName,
          itemStatus: e.status,
          currentStep: e.currentStep,
          hasValidatedTb: true,
          toMap: null,
          openQueries: count.get(e.entityCode) ?? 0,
        })),
    };
  }

  // ---------------------------------------------------------------------------------------
  // Submit, queries, return, approve
  // ---------------------------------------------------------------------------------------

  private async reviewersFor(entityCode: string, stage: 1 | 2, exclude: string[]) {
    const rule = await this.rule(entityCode);
    const listed = stage === 1 ? rule.reviewerIds : rule.approverIds;
    const ids = listed.length
      ? listed
      : await this.notifications.usersWith(this.prisma, [Permission.SfsReview], entityCode);
    return ids.filter((id) => !exclude.includes(id));
  }

  async submit(
    user: AuthUser,
    taskId: string,
    entityCode: string,
    input: SubmitInput,
    ip: string | null,
  ) {
    const task = await loadStepTask(this.prisma, user, taskId);
    const te = assertEditable(user, task, entityCode);
    if (await this.activeSubmission(taskId, entityCode))
      throw new ApiError(
        HttpStatus.CONFLICT,
        ApiErrorCode.Conflict,
        'This entity is already submitted for review.',
      );
    const g = await this.gather(user, task, te);
    if (!g.version) throw ApiError.validation('Upload and validate a trial balance first.');
    const { blocking, warnings } = checkSummary(g.results);
    if (blocking.length > 0)
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        ApiErrorCode.ValidationFailed,
        `Cannot submit: ${blocking.length} blocking check(s) fail: ${blocking.map((b) => `${b.name}${b.currency ? ` (${b.currency})` : ''}`).join('; ')}.`,
        { blocking: blocking.map(checkKey) },
      );
    const acks = new Map(input.acknowledgements.map((a) => [a.key, a.comment.trim()]));
    const missing = warnings.filter((w) => (acks.get(checkKey(w)) ?? '').length < 10);
    if (missing.length > 0)
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        ApiErrorCode.ValidationFailed,
        `Acknowledge each failing warning with a comment of at least 10 characters: ${missing.map((w) => `${w.name}${w.currency ? ` (${w.currency})` : ''}`).join('; ')}.`,
        { warnings: missing.map(checkKey) },
      );
    if (!input.declaration) throw ApiError.validation('Tick the declaration to submit.');
    const rule = await this.rule(entityCode);
    const number =
      (await this.prisma.reviewSubmission.count({ where: { taskId, entityCode } })) + 1;
    const reviewers = await this.reviewersFor(entityCode, 1, [user.id]);
    await this.prisma.$transaction(async (tx) => {
      await tx.reviewSubmission.create({
        data: {
          taskId,
          entityCode,
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
      await tx.taskEntity.update({
        where: { taskId_entityCode: { taskId, entityCode } },
        data: { status: 'IN_REVIEW', currentStep: 'REVIEW' },
      });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.ReviewSubmit,
          entityType: 'TASK_ENTITY',
          entityId: `${taskId}:${entityCode}`,
          oldValue: { status: te.status },
          newValue: {
            status: 'IN_REVIEW',
            task: task.number,
            entity: entityCode,
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
        title: `${entityCode} ${task.number} submitted for your review`,
        body: `${user.name} submitted ${te.entity.shortName} (${task.period.label}).`,
        link: link(taskId, 'REVIEW', entityCode),
      });
    });
    return this.pack(user, taskId, entityCode);
  }

  private async editable(user: AuthUser, taskId: string, entityCode: string) {
    const task = await loadStepTask(this.prisma, user, taskId);
    const te = assertViewable(user, task, entityCode);
    if (te.status === 'FINALISED' || isTaskLocked(task))
      throw new ApiError(
        HttpStatus.CONFLICT,
        ApiErrorCode.EntityFinalised,
        `${te.entity.shortName} is finalised: read-only.`,
      );
    return { task, te };
  }

  async raiseQuery(
    user: AuthUser,
    taskId: string,
    entityCode: string,
    input: { targetType: QueryTargetType; targetKey: string | null; text: string },
    ip: string | null,
  ) {
    const { task, te } = await this.editable(user, taskId, entityCode);
    const g = await this.gather(user, task, te);
    let label = te.entity.legalName;
    if (input.targetType !== 'ENTITY') {
      const t = g.pack.queryTargets[input.targetType].find((x) => x.key === input.targetKey);
      if (!t) throw ApiError.validation('Choose the item the query is about.');
      label = t.label;
    }
    const preparers = await this.preparerIds(taskId, entityCode);
    await this.prisma.$transaction(async (tx) => {
      const q = await tx.reviewQuery.create({
        data: {
          taskId,
          entityCode,
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
          entityType: 'TASK_ENTITY',
          entityId: `${taskId}:${entityCode}`,
          oldValue: null,
          newValue: { query: q.id, on: label, text: input.text.trim() },
          ip,
        },
        tx,
      );
      await this.notifications.notify(
        tx,
        [...preparers, ...(te.lastEditedById ? [te.lastEditedById] : [])].filter(
          (id) => id !== user.id,
        ),
        {
          kind: 'QUERY_RAISED',
          title: `Review query on ${entityCode} ${task.number}: ${label}`,
          body: input.text.trim(),
          link: link(taskId, 'REVIEW', entityCode),
        },
      );
    });
    return this.pack(user, taskId, entityCode);
  }

  async answerQuery(
    user: AuthUser,
    taskId: string,
    entityCode: string,
    queryId: string,
    text: string,
    file: { buffer: Buffer; originalname: string; mimetype: string } | null,
    ip: string | null,
  ) {
    const { task } = await this.editable(user, taskId, entityCode);
    if (!user.permissions.has(Permission.SfsPrepare) || !inScope(user.entityScope, entityCode))
      throw ApiError.notAllowed('Only a preparer of this entity can answer a query.');
    const q = await this.prisma.reviewQuery.findFirst({
      where: { id: queryId, taskId, entityCode },
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
            entityCode,
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
          entityType: 'TASK_ENTITY',
          entityId: `${taskId}:${entityCode}`,
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
        title: `Query answered: ${entityCode} ${task.number} – ${q.targetLabel}`,
        body: text.trim(),
        link: link(taskId, 'REVIEW', entityCode),
      });
    });
    return this.pack(user, taskId, entityCode);
  }

  async setQueryStatus(
    user: AuthUser,
    taskId: string,
    entityCode: string,
    queryId: string,
    close: boolean,
    comment: string | null,
    ip: string | null,
  ) {
    await this.editable(user, taskId, entityCode);
    if (!user.permissions.has(Permission.SfsReview))
      throw ApiError.notAllowed('Only a reviewer can close or reopen a query.');
    const q = await this.prisma.reviewQuery.findFirst({
      where: { id: queryId, taskId, entityCode },
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
          entityType: 'TASK_ENTITY',
          entityId: `${taskId}:${entityCode}`,
          oldValue: { status: q.status },
          newValue: { query: queryId, status, comment },
          ip,
        },
        tx,
      );
    });
    return this.pack(user, taskId, entityCode);
  }

  async returnToPreparer(
    user: AuthUser,
    taskId: string,
    entityCode: string,
    comment: string,
    ip: string | null,
  ) {
    const { task, te } = await this.editable(user, taskId, entityCode);
    const sub = await this.activeSubmission(taskId, entityCode);
    if (!sub) throw ApiError.validation('There is no submission to return.');
    const why = await this.decideBlocked(user, task, te, sub);
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
      await tx.taskEntity.update({
        where: { taskId_entityCode: { taskId, entityCode } },
        data: { status: 'IN_PROGRESS' },
      });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.ReviewReturn,
          entityType: 'TASK_ENTITY',
          entityId: `${taskId}:${entityCode}`,
          oldValue: { status: 'IN_REVIEW' },
          newValue: { status: 'IN_PROGRESS', task: task.number, comment: comment.trim() },
          ip,
        },
        tx,
      );
      await this.notifications.notify(tx, [sub.submittedById], {
        kind: 'RETURNED',
        title: `${entityCode} ${task.number} returned to you`,
        body: `${user.name}: ${comment.trim()}`,
        link: link(taskId, 'REVIEW', entityCode),
      });
    });
    return this.pack(user, taskId, entityCode);
  }

  async approve(
    user: AuthUser,
    taskId: string,
    entityCode: string,
    comment: string | null,
    ip: string | null,
  ) {
    const { task, te } = await this.editable(user, taskId, entityCode);
    const sub = await this.activeSubmission(taskId, entityCode);
    if (!sub) throw ApiError.validation('There is no submission to approve.');
    const why = await this.decideBlocked(user, task, te, sub);
    if (why) throw ApiError.notAllowed(why);
    const outstanding = await this.prisma.reviewQuery.count({
      where: { taskId, entityCode, status: { not: 'CLOSED' } },
    });
    if (outstanding > 0)
      throw new ApiError(
        HttpStatus.CONFLICT,
        ApiErrorCode.Conflict,
        `Cannot approve: ${outstanding} review quer${outstanding === 1 ? 'y is' : 'ies are'} still open or answered. Close ${outstanding === 1 ? 'it' : 'them'} first.`,
      );
    if (sub.stage < sub.reviewLevels) {
      const approvers = await this.reviewersFor(entityCode, 2, [
        ...(await this.preparerIds(taskId, entityCode)),
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
            entityType: 'TASK_ENTITY',
            entityId: `${taskId}:${entityCode}`,
            oldValue: { stage: 1 },
            newValue: { stage: 2, task: task.number, role: 'REVIEWER' },
            ip,
          },
          tx,
        );
        await this.notifications.notify(tx, approvers, {
          kind: 'SUBMITTED_FOR_REVIEW',
          title: `${entityCode} ${task.number} awaits your approval`,
          body: `Reviewed by ${user.name}.`,
          link: link(taskId, 'REVIEW', entityCode),
        });
      });
      return this.pack(user, taskId, entityCode);
    }
    await this.finalise(user, task, te, sub, comment, ip);
    return this.pack(user, taskId, entityCode);
  }

  // ---------------------------------------------------------------------------------------
  // Finalise (atomic) and reopen
  // ---------------------------------------------------------------------------------------

  private async finalise(
    user: AuthUser,
    task: StepTask,
    te: TaskEntityRow,
    sub: NonNullable<Awaited<ReturnType<ReviewService['activeSubmission']>>>,
    comment: string | null,
    ip: string | null,
  ) {
    // 1. Re-run every check on the data as it is now.
    const g = await this.gather(user, task, te);
    const blocking = checkSummary(g.results).blocking;
    if (blocking.length > 0 || !g.figures)
      throw new ApiError(
        HttpStatus.CONFLICT,
        ApiErrorCode.Conflict,
        `Cannot finalise: blocking check(s) fail now: ${blocking.map((b) => b.name).join('; ')}.`,
      );
    const figures: EntityFigures = g.figures;
    const lines = (await this.prisma.tbVersion.findFirst({
      where: {
        taskId: task.id,
        entityCode: te.entityCode,
        purpose: 'CURRENT',
        status: { not: 'ERROR' },
      },
      orderBy: { version: 'desc' },
      include: { lines: { orderBy: { accountCode: 'asc' } }, file: true },
    }))!;
    const coa = await this.prisma.entityAccount.findMany({
      where: { entityCode: te.entityCode },
      orderBy: { accountCode: 'asc' },
    });
    const translations: { target: string; result: TranslateTbResult }[] = [];
    const mapped = await mappedLines(this.prisma, task.id, te.entityCode);
    for (const t of mapped ? await this.translation.translate(task, te, mapped) : []) {
      const stored = await this.prisma.translationSnapshot.findUnique({
        where: {
          taskId_entityCode_targetCurrency: {
            taskId: task.id,
            entityCode: te.entityCode,
            targetCurrency: t.target,
          },
        },
      });
      translations.push({
        target: t.target,
        result: stored ? (stored.result as unknown as TranslateTbResult) : t.result,
      });
    }
    const currencies = figures.currencies.map((c) => c.currency);
    const period = {
      startDate: fromDbDate(task.period.startDate),
      endDate: fromDbDate(task.period.endDate),
    };
    const rates = await monthlyRates(this.prisma as unknown as Tx, currencies, period);
    const { lines: formatLines, version: formatVersion } = await loadFormatLines(
      this.prisma,
      task.formatCode ?? 'STATUTORY',
      task.formatVersion,
    );
    const notes = await this.prisma.entityNote.findMany({
      where: { taskId: task.id, entityCode: te.entityCode },
      orderBy: { sortOrder: 'asc' },
    });
    const queries = await this.queries(user, task, te);
    const signOffsBefore = await this.signOffs(task, te, sub.reviewLevels);
    const at = new Date();
    const finalSignOff: SignOffDto = {
      role: sub.reviewLevels === 2 ? 'APPROVER' : 'REVIEWER',
      name: user.name,
      status: 'APPROVED',
      at: at.toISOString(),
      comment: comment?.trim() || null,
    };
    const signOffs = signOffsBefore.map((s) => (s.role === finalSignOff.role ? finalSignOff : s));
    const names = new Map(
      (await this.prisma.user.findMany({ select: { id: true, name: true } })).map((u) => [
        u.id,
        u.name,
      ]),
    );
    const acknowledgements = (
      (sub.acknowledgements as { key: string; comment: string }[]) ?? []
    ).map((a) => ({ ...a, by: names.get(sub.submittedById) ?? null }));

    const existingWorking = await this.prisma.finalSnapshot.findFirst({
      where: { taskId: task.id, entityCode: te.entityCode, state: 'WORKING' },
      orderBy: { version: 'desc' },
    });
    const lastVersion = await this.prisma.finalSnapshot.aggregate({
      where: { taskId: task.id, entityCode: te.entityCode },
      _max: { version: true },
    });
    const version = existingWorking?.version ?? (lastVersion._max.version ?? 0) + 1;
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
      changes: await this.changes(task, te),
      queries,
    };
    const data = {
      schema: 1,
      version,
      task: {
        id: task.id,
        number: task.number,
        period: task.period.label,
        startDate: period.startDate,
        endDate: period.endDate,
      },
      entity: {
        code: te.entityCode,
        legalName: te.entity.legalName,
        functionalCurrency: te.entity.functionalCurrency,
      },
      format: { code: task.formatCode, version: formatVersion, lines: formatLines },
      tb: {
        version: lines.version,
        file: lines.file.originalName,
        sha256: lines.file.sha256,
        lines: lines.lines.map((l) => ({
          code: l.accountCode,
          name: l.accountName,
          type: l.accountType,
          amount: l.amount.toFixed(2),
        })),
      },
      mapping: coa.map((a) => ({
        code: a.accountCode,
        name: a.accountName,
        type: a.accountType,
        fsli: a.fsliCode,
        counterparty: a.counterpartyCode,
        rateBasisOverride: a.rateBasisOverride,
      })),
      translations,
      figures,
      keyFigures: g.pack.keyFigures,
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
      rates,
      checks: g.results,
      acknowledgements,
      queries,
      signOffs,
      files: g.pack.files,
      pack,
    };
    const json = JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue;
    const hash = sha256(json);
    pack.state.finalised = { at: at.toISOString(), by: user.name, version, hash };
    const withState = JSON.parse(JSON.stringify({ ...data, pack })) as Prisma.InputJsonValue;
    // The hash covers everything but the banner text that repeats it.
    const months = monthsBetween(period.startDate, period.endDate);

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
      // 2. The immutable snapshot (a reopened entity's working copy becomes this version).
      if (existingWorking)
        await tx.finalSnapshot.update({
          where: { id: existingWorking.id },
          data: { state: 'FINAL', data: withState, hash, finalisedAt: at },
        });
      else
        await tx.finalSnapshot.create({
          data: {
            taskId: task.id,
            entityCode: te.entityCode,
            version,
            state: 'FINAL',
            data: withState,
            hash,
            createdById: user.id,
            finalisedAt: at,
          },
        });
      await tx.statementSnapshot.deleteMany({
        where: { taskId: task.id, entityCode: te.entityCode },
      });
      await tx.statementSnapshot.create({
        data: {
          taskId: task.id,
          entityCode: te.entityCode,
          figures: JSON.parse(JSON.stringify(figures)),
          source: 'FINALISE',
        },
      });
      for (const t of translations) {
        const r = t.result;
        if (r.status !== 'OK') continue;
        const row = {
          periodId: task.periodId,
          retained: r.fsliTotals.find((f) => f.fsliCode === 'RETAINED')?.translated ?? '0.00',
          profit: r.profit ?? '0.00',
          fctr: r.fctr ?? '0.00',
          result: JSON.parse(JSON.stringify(r)),
          source: 'FINALISE',
        };
        await tx.translationSnapshot.upsert({
          where: {
            taskId_entityCode_targetCurrency: {
              taskId: task.id,
              entityCode: te.entityCode,
              targetCurrency: t.target,
            },
          },
          create: { taskId: task.id, entityCode: te.entityCode, targetCurrency: t.target, ...row },
          update: row,
        });
      }
      // 3. Lock the exchange-rate months used.
      await tx.exchangeRate.updateMany({
        where: {
          month: { in: months.map((m) => new Date(`${m}T00:00:00.000Z`)) },
          currencyCode: { in: currencies.filter((c) => c !== 'USD') },
        },
        data: { locked: true },
      });
      // 4. Finalised, read-only; the task is Done when every entity is.
      await tx.taskEntity.update({
        where: { taskId_entityCode: { taskId: task.id, entityCode: te.entityCode } },
        data: {
          status: 'FINALISED',
          currentStep: 'FINALISED',
          finalisedById: user.id,
          finalisedAt: at,
        },
      });
      const all = await tx.taskEntity.findMany({
        where: { taskId: task.id },
        select: { status: true },
      });
      if (all.every((x) => x.status === 'FINALISED'))
        await tx.task.update({ where: { id: task.id }, data: { completedAt: at } });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.EntityFinalise,
          entityType: 'TASK_ENTITY',
          entityId: `${task.id}:${te.entityCode}`,
          oldValue: { status: 'IN_REVIEW' },
          newValue: { status: 'FINALISED', task: task.number, snapshot: version, hash },
          ip,
        },
        tx,
      );
      await this.notifications.notify(tx, [sub.submittedById], {
        kind: 'FINALISED',
        title: `${te.entityCode} ${task.number} finalised`,
        body: `Approved by ${user.name}. Snapshot v${version} · hash ${hash.slice(0, 8)}…`,
        link: link(task.id, 'FINALISED', te.entityCode),
      });
    });
  }

  /** Edit access granted: a working copy of the next version, the entity In progress again. */
  async reopen(
    tx: Tx,
    user: AuthUser,
    taskId: string,
    entityCode: string,
    ip: string | null,
  ): Promise<void> {
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
    await tx.taskEntity.update({
      where: { taskId_entityCode: { taskId, entityCode } },
      data: {
        status: 'IN_PROGRESS',
        currentStep: 'REVIEW',
        finalisedAt: null,
        finalisedById: null,
      },
    });
    await tx.task.update({ where: { id: taskId }, data: { completedAt: null } });
    // Screens recalculate again; the FINAL snapshot keeps the finalised figures.
    await tx.statementSnapshot.deleteMany({ where: { taskId, entityCode } });
    await tx.translationSnapshot.deleteMany({ where: { taskId, entityCode } });
    // Rates unlock only for months no other finalised report uses.
    const months = monthsBetween(
      fromDbDate(task.period.startDate),
      fromDbDate(task.period.endDate),
    );
    const others = await tx.task.findMany({
      where: {
        OR: [
          { entities: { some: { status: 'FINALISED' } } },
          { levels: { some: { status: 'FINALISED' } } },
        ],
      },
      include: { period: true },
    });
    const stillUsed = new Set(
      others.flatMap((t) =>
        monthsBetween(fromDbDate(t.period.startDate), fromDbDate(t.period.endDate)),
      ),
    );
    const free = months.filter((m) => !stillUsed.has(m));
    if (free.length)
      await tx.exchangeRate.updateMany({
        where: { month: { in: free.map((m) => new Date(`${m}T00:00:00.000Z`)) } },
        data: { locked: false },
      });
    await this.audit.record(
      {
        userId: user.id,
        action: AuditAction.EntityReopen,
        entityType: 'TASK_ENTITY',
        entityId: `${taskId}:${entityCode}`,
        oldValue: { status: 'FINALISED', snapshot: last?.version ?? null },
        newValue: {
          status: 'IN_PROGRESS',
          task: task.number,
          workingCopy: last ? last.version + 1 : null,
          unlockedMonths: free,
        },
        ip,
      },
      tx,
    );
  }

  // ---------------------------------------------------------------------------------------
  // The Finalised step
  // ---------------------------------------------------------------------------------------

  async finalised(user: AuthUser, taskId: string, entityCode: string): Promise<FinalisedViewDto> {
    const task = await loadStepTask(this.prisma, user, taskId);
    const te = assertViewable(user, task, entityCode);
    const snaps = await this.prisma.finalSnapshot.findMany({
      where: { taskId, entityCode },
      orderBy: { version: 'asc' },
    });
    const names = new Map(
      (await this.prisma.user.findMany({ select: { id: true, name: true } })).map((u) => [
        u.id,
        u.name,
      ]),
    );
    const versions: SnapshotVersionDto[] = snaps.map((s) => {
      const d = s.data as {
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
        keyFigures: d.keyFigures ?? [],
        signOffs: d.signOffs ?? [],
        checks: (d.checks ?? []).map((r) => ({ ...r, key: checkKey(r) })) as CheckResultDto[],
      };
    });
    const last = [...snaps].reverse().find((s) => s.state === 'FINAL');
    const finalised =
      te.status === 'FINALISED' && last
        ? {
            at: (last.finalisedAt ?? last.createdAt).toISOString(),
            by: te.finalisedById ? (names.get(te.finalisedById) ?? '') : '',
            version: last.version,
            hash: last.hash ?? '',
          }
        : null;
    const pending =
      (await this.editAccess.list(user)).find(
        (r) => r.taskId === taskId && r.entityCode === entityCode && r.status === 'PENDING',
      ) ?? null;
    const blocked =
      te.status === 'FINALISED'
        ? await this.editAccess.reopenBlocked(this.prisma, taskId, entityCode)
        : null;
    return {
      entity: {
        code: te.entityCode,
        legalName: te.entity.legalName,
        shortName: te.entity.shortName,
        functionalCurrency: te.entity.functionalCurrency,
        erp: ERP_LABELS[te.entity.erp],
        itemStatus: te.status,
      },
      periodLabel: task.period.label,
      banner: finalised
        ? `Finalised on ${finalised.at.slice(0, 10)} by ${finalised.by}. Snapshot v${finalised.version} · hash ${finalised.hash.slice(0, 12)}…`
        : null,
      finalised,
      versions,
      canRequestEditAccess:
        te.status === 'FINALISED' &&
        !pending &&
        blocked === null &&
        user.permissions.has(Permission.SfsPrepare) &&
        inScope(user.entityScope, entityCode),
      pendingRequest: pending,
      reopenBlocked: blocked,
    };
  }

  /** The stored snapshot of a version (for downloads and the "review record"). */
  async snapshotData(user: AuthUser, taskId: string, entityCode: string, version?: number) {
    const task = await loadStepTask(this.prisma, user, taskId);
    assertViewable(user, task, entityCode);
    const s = await this.prisma.finalSnapshot.findFirst({
      where: { taskId, entityCode, state: 'FINAL', ...(version ? { version } : {}) },
      orderBy: { version: 'desc' },
    });
    if (!s) throw ApiError.notFound('No finalised snapshot for this entity.');
    return { task, snapshot: s, data: s.data as unknown as { pack: Pack; checks: CheckResult[] } };
  }

  /** Recomputes a stored snapshot's hash (for the "stable hash" check). */
  verifyHash(data: unknown, hash: string): boolean {
    const d = JSON.parse(JSON.stringify(data)) as { pack?: Pack };
    if (d.pack?.state) d.pack.state.finalised = null;
    return sha256(d) === hash;
  }
}
