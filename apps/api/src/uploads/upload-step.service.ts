import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type TbVersion, type UploadKind } from '@prisma/client';
import {
  type Cell,
  checkTrialBalance,
  Decimal,
  inferMapping,
  YTD_PRIOR_PROFIT_CODE,
  YTD_PRIOR_PROFIT_NAME,
  ytdToPeriod,
  deriveTaskStatus,
  detectTbLayout,
  parseChartOfAccounts,
  type TbCheckResult,
  type TbColumnSettings,
  type TbLayout,
  ZOHO_TB_SETTINGS,
  zohoFetchRange,
  zohoCoaCsv,
  zohoTbCsv,
  buildVeracityTb,
  counterpartyInName,
  GROUPING_FSLI,
  groupingKey,
  type VeracityLine,
  veracityTbCsv,
} from '@finance-close/engine';
import {
  ApiErrorCode,
  AuditAction,
  type CoaMergeSummaryDto,
  DOCUMENT_FILE_EXTENSIONS,
  type EntityUploadStatus,
  type FileRefDto,
  MAX_UPLOAD_BYTES,
  Permission,
  TB_FILE_EXTENSIONS,
  type TbColumnSettingsDto,
  type TbPreviewDto,
  type TbVersionDto,
  type UploadEntityCardDto,
  type UploadIssueDto,
  type UploadStepDto,
} from '@finance-close/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/session-user';
import { ApiError } from '../common/api-error';
import { fromDbDate } from '../common/db-dates';
import { PrismaService } from '../prisma/prisma.service';
import { SubmissionGuard } from './submission-guard.service';
import { StorageNotFoundError, StorageService } from '../storage/storage.service';
import { inScope } from '../tasks/tasks.service';
import {
  assertEditable,
  isTaskLocked,
  loadStepTask,
  readOnlyReason,
  type StepTask,
} from './step-access';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { toFileRef } from './file-ref';
import { RatesService } from './rates.service';
import { columnLetter, readSheetRows, readWorkbookSheets } from './sheets';
import { ZohoService } from '../integrations/zoho.service';
import { storeUpload } from './stored-files';
import { saveTbVersion } from './tb-versions';

/** A comparative TB (comparatives step): for another period, stored for this task only. */
export interface TbTarget {
  purpose: 'COMPARATIVE';
  period: { id: string; label: string; startDate: string; endDate: string };
}

export interface UploadedBlob {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

const fileInclude = { uploadedBy: { select: { name: true } } } satisfies Prisma.UploadedFileInclude;
const versionInclude = {
  file: { include: fileInclude },
  createdBy: { select: { name: true } },
} satisfies Prisma.TbVersionInclude;
type VersionRow = Prisma.TbVersionGetPayload<{ include: typeof versionInclude }>;

interface Issues {
  errors: UploadIssueDto[];
  warnings: UploadIssueDto[];
  info: UploadIssueDto[];
}

const PREVIEW_LINES = 10;

function extensionOf(name: string): string {
  const m = /\.[^.]+$/.exec(name.toLowerCase());
  return m ? m[0] : '';
}

function uploadStatus(v: TbVersion | undefined): EntityUploadStatus {
  return v ? v.status : 'PENDING';
}

function toVersionDto(v: VersionRow): TbVersionDto {
  const issues = v.issues as unknown as Issues;
  return {
    id: v.id,
    version: v.version,
    status: v.status,
    file: toFileRef(v.file),
    totals: {
      debits: v.debits.toFixed(2),
      credits: v.credits.toFixed(2),
      difference: v.difference.toFixed(2),
    },
    lineCount: v.lineCount,
    newAccounts: v.newAccounts as TbVersionDto['newAccounts'],
    errors: issues.errors ?? [],
    warnings: issues.warnings ?? [],
    info: issues.info ?? [],
    acknowledged: v.acknowledgements as string[],
    createdBy: v.createdBy.name,
    createdAt: v.createdAt.toISOString(),
  };
}

/**
 * Task workspace step 1 "Upload data" (page 3): trial balances, charts of accounts and other
 * documents per entity, plus the task's exchange-rate panel.
 *
 * Rules: uploading needs SFS_PREPARE and the entity in the user's scope (else 403); a Done
 * task or a finalised entity is read-only (409). Every upload is audited.
 */
@Injectable()
export class UploadStepService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly rates: RatesService,
    private readonly coa: ChartOfAccountsService,
    private readonly guard: SubmissionGuard,
    private readonly zoho: ZohoService,
  ) {}

  // ---------------------------------------------------------------------------------------
  // Loading and access rules
  // ---------------------------------------------------------------------------------------

  private loadTask(user: AuthUser, taskId: string): Promise<StepTask> {
    return loadStepTask(this.prisma, user, taskId);
  }

  private isLocked(task: StepTask): boolean {
    return isTaskLocked(task);
  }

  private readOnlyReason(user: AuthUser, task: StepTask, entityCode: string): string | null {
    return readOnlyReason(user, task, entityCode);
  }

  /** Loads the task and checks the user may upload for the entity (403 / 404 / 409). */
  private async editable(user: AuthUser, taskId: string, entityCode: string) {
    const task = await this.loadTask(user, taskId);
    return { task, te: assertEditable(user, task, entityCode) };
  }

  private checkFile(file: UploadedBlob | undefined, allowed: readonly string[]): UploadedBlob {
    if (!file) throw ApiError.validation('Choose a file to upload.');
    if (file.size > MAX_UPLOAD_BYTES)
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        ApiErrorCode.FileRejected,
        'The file is larger than the 10 MB limit.',
      );
    if (file.size === 0)
      throw new ApiError(HttpStatus.BAD_REQUEST, ApiErrorCode.FileRejected, 'The file is empty.');
    if (!allowed.includes(extensionOf(file.originalname)))
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        ApiErrorCode.FileRejected,
        `This type of file is not accepted. Use ${allowed.join(', ')}.`,
      );
    return file;
  }

  private readRows(file: { buffer: Buffer; originalname: string }): Cell[][] {
    try {
      return readSheetRows(file.buffer, file.originalname);
    } catch {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        ApiErrorCode.FileRejected,
        'The file could not be read as a spreadsheet.',
      );
    }
  }

  // ---------------------------------------------------------------------------------------
  // The step page
  // ---------------------------------------------------------------------------------------

  async get(user: AuthUser, taskId: string): Promise<UploadStepDto> {
    const task = await this.loadTask(user, taskId);
    const locked = this.isLocked(task);
    const entities = [...task.entities]
      .filter((e) => inScope(user.entityScope, e.entityCode))
      .sort((a, b) => a.entity.sortOrder - b.entity.sortOrder);
    const codes = entities.map((e) => e.entityCode);

    const profiles = await this.prisma.uploadProfile.findMany({
      where: { entityCode: { in: codes } },
      select: { entityCode: true, plBasis: true },
    });
    const [versions, files, counts] = await Promise.all([
      this.prisma.tbVersion.findMany({
        where: { taskId, entityCode: { in: codes }, purpose: 'CURRENT' },
        include: versionInclude,
        orderBy: { version: 'desc' },
      }),
      this.prisma.uploadedFile.findMany({
        where: { taskId, entityCode: { in: codes }, kind: { in: ['COA', 'OTHER'] } },
        include: fileInclude,
        orderBy: { uploadedAt: 'desc' },
      }),
      this.prisma.tbVersion.groupBy({
        by: ['entityCode'],
        where: { taskId, entityCode: { in: codes }, purpose: 'CURRENT' },
        _count: true,
      }),
    ]);

    const erpFetch = await this.zoho.fetchState(
      entities.map((te) => ({ code: te.entityCode, erp: te.entity.erp })),
    );
    const cards: UploadEntityCardDto[] = entities.map((te) => {
      const latest = versions.find((v) => v.entityCode === te.entityCode);
      const coa = files.filter((f) => f.entityCode === te.entityCode && f.kind === 'COA');
      const reason = this.readOnlyReason(user, task, te.entityCode);
      return {
        plBasis:
          profiles.find((p) => p.entityCode === te.entityCode)?.plBasis === 'YTD'
            ? 'YTD'
            : 'PERIOD',
        code: te.entityCode,
        legalName: te.entity.legalName,
        shortName: te.entity.shortName,
        functionalCurrency: te.entity.functionalCurrency,
        erp: te.entity.erp,
        erpFetch: erpFetch.get(te.entityCode) ?? null,
        itemStatus: te.status,
        currentStep: te.currentStep,
        uploadStatus: uploadStatus(latest),
        canEdit: reason === null,
        readOnlyReason: reason,
        tb: {
          latest: latest ? toVersionDto(latest) : null,
          versionCount: counts.find((c) => c.entityCode === te.entityCode)?._count ?? 0,
        },
        coa: { latest: coa[0] ? toFileRef(coa[0]) : null, count: coa.length },
        documents: files
          .filter((f) => f.entityCode === te.entityCode && f.kind === 'OTHER')
          .map(toFileRef),
      };
    });

    // Currencies the task needs: functional and translated currencies of its entities, not USD.
    const currencies: string[] = [];
    for (const te of [...task.entities].sort((a, b) => a.entity.sortOrder - b.entity.sortOrder)) {
      for (const c of [
        te.entity.functionalCurrency,
        ...te.entity.translatedCurrencies.map((t) => t.currencyCode),
      ]) {
        if (c !== 'USD' && !currencies.includes(c)) currencies.push(c);
      }
    }
    const rates = await this.rates.panel(
      user,
      {
        label: task.period.label,
        type: task.period.type,
        startDate: fromDbDate(task.period.startDate),
        endDate: fromDbDate(task.period.endDate),
      },
      currencies,
      locked,
    );

    const validated = cards.filter(
      (c) => c.uploadStatus === 'VALIDATED' || c.uploadStatus === 'VALIDATED_WITH_WARNINGS',
    ).length;
    const ratesText = rates.complete
      ? `rates complete for ${task.period.label}`
      : `${rates.missing} rate${rates.missing === 1 ? '' : 's'} missing for ${task.period.label}`;
    const status = deriveTaskStatus(task.entities.map((e) => e.status));
    return {
      task: {
        id: task.id,
        number: task.number,
        type: task.type,
        periodLabel: task.period.label,
        description: task.description,
        dueDate: fromDbDate(task.dueDate),
        status,
        currentStep: task.currentStep,
        locked,
      },
      rates,
      entities: cards,
      summary: {
        validated,
        total: cards.length,
        ratesComplete: rates.complete,
        text: `${validated} of ${cards.length} ${cards.length === 1 ? 'entity' : 'entities'} validated · ${ratesText}`,
      },
      canContinue: !locked && user.permissions.has(Permission.SfsPrepare) && validated > 0,
    };
  }

  // ---------------------------------------------------------------------------------------
  // Trial balance: upload → (re-)preview → confirm
  // ---------------------------------------------------------------------------------------

  async uploadTb(
    user: AuthUser,
    taskId: string,
    entityCode: string,
    blob: UploadedBlob | undefined,
    target?: TbTarget,
  ): Promise<TbPreviewDto> {
    const file = this.checkFile(blob, TB_FILE_EXTENSIONS);
    const { task, te } = await this.editable(user, taskId, entityCode);
    const rows = this.readRows(file);
    const stored = await this.prisma.$transaction((tx) =>
      storeUpload(tx, this.storage, {
        kind: 'TB',
        body: file.buffer,
        originalName: file.originalname,
        contentType: file.mimetype,
        taskId,
        entityCode,
        uploadedById: user.id,
      }),
    );
    const profile = await this.prisma.uploadProfile.findUnique({ where: { entityCode } });
    const layout = detectTbLayout(rows);
    // The remembered profile wins if its columns still exist in this file.
    const fromProfile = profile ? (profile.settings as unknown as TbColumnSettings) : null;
    const usable = fromProfile && this.settingsFit(fromProfile, rows) ? fromProfile : null;
    // Profiles saved before the account-type column existed take it from the detection.
    const settings = usable
      ? {
          ...usable,
          typeColumn:
            usable.typeColumn !== undefined
              ? usable.typeColumn
              : (layout.settings?.typeColumn ?? null),
        }
      : layout.settings;
    return this.preview(
      task,
      te.entity,
      stored.id,
      file.originalname,
      rows,
      layout,
      settings,
      usable ? 'PROFILE' : settings ? 'DETECTED' : 'NONE',
      target,
    );
  }

  /**
   * Fetches the entity's TB from Zoho Books for the task period and stores it as a CSV in the
   * shape of a Zoho export, so it is previewed, checked and confirmed exactly like an uploaded
   * file. The raw response is kept beside it. A fetched TB is always on the period basis
   * (balance sheet at closing, P&L for the period, earlier profit as YTD-PRIOR), whatever the
   * entity's upload profile says: the profile's P&L basis describes uploaded files.
   */
  async fetchZohoTb(
    user: AuthUser,
    taskId: string,
    entityCode: string,
    ip: string | null,
  ): Promise<TbPreviewDto> {
    const { task, te } = await this.editable(user, taskId, entityCode);
    if (te.entity.erp !== 'ZOHO')
      throw ApiError.validation(`${entityCode} does not use Zoho; upload its trial balance file.`);
    const { from, to } = zohoFetchRange(
      { startDate: fromDbDate(task.period.startDate), endDate: fromDbDate(task.period.endDate) },
      'PERIOD',
    );
    const tb = await this.zoho.trialBalance(entityCode, from, to);
    if (tb.problems.length > 0 || !tb.amountFields)
      throw new ApiError(
        HttpStatus.BAD_GATEWAY,
        ApiErrorCode.ErpUnavailable,
        `The Zoho trial balance could not be read: ${tb.problems.slice(0, 5).join(' ')}${tb.problems.length > 5 ? ` (and ${tb.problems.length - 5} more)` : ''}`,
      );

    const name = `Zoho TB ${entityCode} ${from} to ${to}.csv`;
    const csv = Buffer.from(
      zohoTbCsv({
        organisation: tb.organizationName,
        from,
        to,
        ytd: false,
        amountFields: tb.amountFields,
        lines: tb.lines,
      }),
      'utf8',
    );
    const rawKey = `tasks/${taskId}/${entityCode}/zoho/${randomUUID()}-trialbalance.json`;
    await this.storage.put(rawKey, Buffer.from(JSON.stringify(tb.raw, null, 1), 'utf8'));
    const meta = {
      provider: 'ZOHO',
      organizationId: tb.organizationId,
      organizationName: tb.organizationName,
      from,
      to,
      plBasis: 'PERIOD',
      amountFields: tb.amountFields,
      priorProfit: tb.priorProfit,
      warnings: tb.warnings,
      rawStorageKey: rawKey,
    };
    const stored = await this.prisma.$transaction(async (tx) => {
      const f = await storeUpload(tx, this.storage, {
        kind: 'TB',
        body: csv,
        originalName: name,
        contentType: 'text/csv',
        taskId,
        entityCode,
        uploadedById: user.id,
        source: 'ZOHO',
        sourceMeta: meta,
      });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.ErpTbFetch,
          entityType: 'UPLOADED_FILE',
          entityId: f.id,
          newValue: {
            task: task.number,
            entity: entityCode,
            file: name,
            sha256: f.sha256,
            lines: tb.lines.length,
            ...meta,
          },
          ip,
        },
        tx,
      );
      return f;
    });
    const rows = this.readRows({ buffer: csv, originalname: name });
    return this.preview(
      task,
      te.entity,
      stored.id,
      name,
      rows,
      detectTbLayout(rows),
      ZOHO_TB_SETTINGS,
      'ERP',
    );
  }

  /**
   * Veracity (Xero, not connected): the month's TB built from the Veracity Category file (P&L)
   * and the VSCON file (balance sheet notes), as in "Veracity Group – Monthly Financial Statements
   * Process" (engine buildVeracityTb). Both originals are kept; the TB is stored as a CSV with a
   * Source column (file › tab › cell per line) and goes through the usual preview → confirm.
   * New accounts are added to the chart of accounts and mapped by their grouping; existing
   * mappings are never changed (the mapping freeze holds).
   */
  async uploadVeracity(
    user: AuthUser,
    taskId: string,
    entityCode: string,
    files: { category?: UploadedBlob; vscon?: UploadedBlob },
    ip: string | null,
  ): Promise<TbPreviewDto> {
    const { task, te } = await this.editable(user, taskId, entityCode);
    if (te.entity.erp !== 'XERO')
      throw ApiError.validation(`${entityCode} is not a Veracity (Xero) entity.`);
    if (task.period.type !== 'MONTHLY')
      throw ApiError.validation('The Veracity files are monthly: use them in a monthly task.');
    if (!files.category) throw ApiError.validation('Choose the Veracity Category file.');
    if (!files.vscon) throw ApiError.validation('Choose the VSCON file.');
    const cat = this.checkFile(files.category, ['.ods', '.xlsx', '.xls', '.csv']);
    const vs = this.checkFile(files.vscon, ['.xlsx', '.xls']);
    const read = (f: UploadedBlob, label: string) => {
      try {
        return readWorkbookSheets(f.buffer, f.originalname);
      } catch {
        throw ApiError.validation(
          `${label} "${f.originalname}" could not be read: the file looks damaged or incomplete. Download it again and retry.`,
        );
      }
    };
    const catSheets = read(cat, 'The Veracity Category file');
    const vsSheets = read(vs, 'The VSCON file');
    const tab = (name: string) =>
      vsSheets.find((s) => s.name.trim().toLowerCase() === name.toLowerCase()) ?? null;
    const notes = tab('Notes');
    if (!notes) throw ApiError.validation(`The VSCON file has no "Notes" tab.`);
    const catSheet = catSheets.find((s) => s.rows.length > 0) ?? catSheets[0]!;
    const from = fromDbDate(task.period.startDate);
    const to = fromDbDate(task.period.endDate);
    const built = buildVeracityTb({
      periodEnd: to,
      category: { rows: catSheet.rows, fileName: cat.originalname, sheet: catSheet.name },
      vscon: {
        notes: notes.rows,
        summary: tab('BS')?.rows ?? null,
        pl: tab('PL')?.rows ?? null,
        fileName: vs.originalname,
      },
    });
    if (built.problems.length > 0) throw ApiError.validation(built.problems.join(' '));

    await this.mapVeracityAccounts(user, entityCode, built.lines, task.number, ip);

    const name = `Veracity TB ${entityCode} ${from} to ${to}.csv`;
    const csv = Buffer.from(
      `\uFEFF${veracityTbCsv({
        entityName: te.entity.legalName,
        periodStart: from,
        periodEnd: to,
        files: `${cat.originalname} (P&L) + ${vs.originalname} (balance sheet notes)`,
        lines: built.lines,
      })}`,
      'utf8',
    );
    const stored = await this.prisma.$transaction(async (tx) => {
      const originals = [];
      for (const f of [cat, vs])
        originals.push(
          await storeUpload(tx, this.storage, {
            kind: 'OTHER',
            body: f.buffer,
            originalName: f.originalname,
            contentType: f.mimetype,
            taskId,
            entityCode,
            uploadedById: user.id,
          }),
        );
      const meta = {
        provider: 'VERACITY_FILES',
        files: { category: cat.originalname, vscon: vs.originalname },
        fileIds: originals.map((o) => o.id),
        monthColumn: built.monthColumn,
        monthProfit: built.monthProfit,
        priorProfit: built.priorProfit,
        difference: built.difference,
        checks: built.checks.map((c) => ({ ...c })),
      };
      const f = await storeUpload(tx, this.storage, {
        kind: 'TB',
        body: csv,
        originalName: name,
        contentType: 'text/csv',
        taskId,
        entityCode,
        uploadedById: user.id,
        source: 'VERACITY',
        sourceMeta: meta,
      });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.VeracityUpload,
          entityType: 'UPLOADED_FILE',
          entityId: f.id,
          newValue: {
            task: task.number,
            entity: entityCode,
            file: name,
            lines: built.lines.length,
            ...meta,
            checks: built.checks.map((c) => `${c.passed ? 'PASS' : 'FAIL'} ${c.label}`),
          },
          ip,
        },
        tx,
      );
      return f;
    });
    const rows = this.readRows({ buffer: csv, originalname: name });
    return this.preview(
      task,
      te.entity,
      stored.id,
      name,
      rows,
      detectTbLayout(rows),
      ZOHO_TB_SETTINGS,
      'ERP',
    );
  }

  /**
   * Veracity accounts in the chart of accounts: new ones added and mapped by their grouping
   * (engine GROUPING_FSLI, or an FSLI with that name); intercompany only with an active group
   * entity. Accounts already mapped keep their mapping.
   */
  private async mapVeracityAccounts(
    user: AuthUser,
    entityCode: string,
    lines: readonly VeracityLine[],
    taskNumber: string,
    ip: string | null,
  ): Promise<void> {
    const [accounts, fslis, active] = await Promise.all([
      this.prisma.entityAccount.findMany({ where: { entityCode } }),
      this.prisma.fsli.findMany({ where: { isActive: true } }),
      this.prisma.entity.findMany({ where: { isActive: true }, select: { code: true } }),
    ]);
    const byCode = new Map(accounts.map((a) => [a.accountCode, a]));
    const activeCodes = new Set(active.map((e) => e.code));
    const IC: Record<string, string> = {
      CUR_OTH: 'IC_REC',
      TRADE_REC: 'IC_REC',
      CUR_OTH_LIAB: 'IC_PAY',
      TRADE_PAY: 'IC_PAY',
      CUR_INV: 'INV_SUB',
    };
    const added: string[] = [];
    const mapped: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const l of lines) {
        if (l.code === YTD_PRIOR_PROFIT_CODE) continue;
        const before = byCode.get(l.code);
        if (before?.fsliCode) continue;
        let fsli =
          GROUPING_FSLI.get(groupingKey(l.grouping)) ??
          fslis.find(
            (f) =>
              !f.computed &&
              !f.consolidationOnly &&
              groupingKey(f.name) === groupingKey(l.grouping),
          )?.code ??
          null;
        let cp: string | null = null;
        const named = counterpartyInName(l.name, entityCode);
        if (fsli && named && activeCodes.has(named) && IC[fsli]) {
          fsli = IC[fsli]!;
          cp = named;
        }
        const data = {
          accountName: l.name.slice(0, 200),
          accountType: l.type,
          fsliCode: fsli,
          counterpartyCode: cp,
          grouping: fsli ? l.grouping.slice(0, 200) : null,
          suggested: false,
          updatedById: user.id,
        };
        if (before) await tx.entityAccount.update({ where: { id: before.id }, data });
        else
          await tx.entityAccount.create({
            data: { entityCode, accountCode: l.code.slice(0, 40), source: 'COA_UPLOAD', ...data },
          });
        if (!before) added.push(l.code);
        if (fsli) mapped.push(l.code);
      }
      if (added.length || mapped.length)
        await this.audit.record(
          {
            userId: user.id,
            action: AuditAction.AccountUpdate,
            entityType: 'ENTITY',
            entityId: entityCode,
            newValue: {
              task: taskNumber,
              source: 'Veracity files upload (accounts mapped by grouping)',
              added,
              mapped,
            },
            ip,
          },
          tx,
        );
    });
  }

  // ---------------------------------------------------------------------------------------
  // Removing uploads
  // ---------------------------------------------------------------------------------------

  /** Refuses changes while the entity is submitted for review (withdraw or return it first). */
  private async assertNotInReview(taskId: string, entityCode: string): Promise<void> {
    const active = await this.prisma.reviewSubmission.findFirst({
      where: { taskId, entityCode, status: 'ACTIVE' },
    });
    if (active)
      throw ApiError.conflict(
        `${entityCode} is submitted for review. Withdraw the submission (or have it returned) before removing uploads.`,
      );
  }

  /** Deletes a stored file and its record when nothing else refers to it. */
  private async dropFile(tx: Prisma.TransactionClient, fileId: string): Promise<boolean> {
    const used = await tx.tbVersion.count({ where: { fileId } });
    if (used > 0) return false;
    const f = await tx.uploadedFile.delete({ where: { id: fileId } });
    try {
      await this.storage.delete(f.storageKey);
    } catch {
      /* the record is gone; a stray object in storage does no harm */
    }
    return true;
  }

  /**
   * Removes the latest trial balance version of the task period (e.g. the wrong file was
   * uploaded). The entity falls back to the previous version, or to "nothing uploaded", and goes
   * back to the Upload step, since later steps were built on the removed version. Not while in
   * review; never once finalised. Audited with what was removed.
   */
  async removeLatestTb(
    user: AuthUser,
    taskId: string,
    entityCode: string,
    ip: string | null,
  ): Promise<{ removedVersion: number; remainingVersion: number | null }> {
    const { task, te } = await this.editable(user, taskId, entityCode);
    await this.assertNotInReview(taskId, entityCode);
    const latest = await this.prisma.tbVersion.findFirst({
      where: { taskId, entityCode, purpose: 'CURRENT' },
      orderBy: { createdAt: 'desc' },
      include: { file: true },
    });
    if (!latest) throw ApiError.notFound('There is no trial balance to remove.');
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.tbVersion.delete({ where: { id: latest.id } });
      const fileDeleted = await this.dropFile(tx, latest.fileId);
      const previous = await tx.tbVersion.findFirst({
        where: { taskId, entityCode, purpose: 'CURRENT' },
        orderBy: { createdAt: 'desc' },
      });
      await tx.taskEntity.update({
        where: { taskId_entityCode: { taskId, entityCode } },
        data: {
          currentStep: 'UPLOAD_DATA',
          rollForward: Prisma.DbNull,
          ...(previous ? {} : { status: 'NOT_STARTED' as const }),
          lastEditedById: user.id,
        },
      });
      await tx.task.update({ where: { id: taskId }, data: { updatedAt: new Date() } });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.TbVersionRemove,
          entityType: 'TB_VERSION',
          entityId: latest.id,
          oldValue: {
            task: task.number,
            entity: entityCode,
            version: latest.version,
            file: latest.file.originalName,
            source: latest.file.source,
            status: latest.status,
            entityStep: te.currentStep,
          },
          newValue: {
            remainingVersion: previous?.version ?? null,
            entityStep: 'UPLOAD_DATA',
            fileDeleted,
          },
          ip,
        },
        tx,
      );
      return { removedVersion: latest.version, remainingVersion: previous?.version ?? null };
    });
    return result;
  }

  /** Deletes a supporting document (or an unconfirmed upload) of the entity in this task. */
  async deleteDocument(
    user: AuthUser,
    taskId: string,
    entityCode: string,
    fileId: string,
    ip: string | null,
  ): Promise<void> {
    const { task } = await this.editable(user, taskId, entityCode);
    await this.assertNotInReview(taskId, entityCode);
    const file = await this.prisma.uploadedFile.findUnique({ where: { id: fileId } });
    if (!file || file.taskId !== taskId || file.entityCode !== entityCode)
      throw ApiError.notFound('File not found in this task.');
    if (file.kind === 'COA')
      throw ApiError.validation(
        'A chart-of-accounts file has already been merged into the chart of accounts; change accounts in Configuration → Chart of accounts instead.',
      );
    await this.prisma.$transaction(async (tx) => {
      const deleted = await this.dropFile(tx, fileId);
      if (!deleted)
        throw ApiError.conflict(
          'This file is a confirmed trial balance version; use "Remove latest version" instead.',
        );
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.DocumentDelete,
          entityType: 'UPLOADED_FILE',
          entityId: fileId,
          oldValue: {
            task: task.number,
            entity: entityCode,
            file: file.originalName,
            kind: file.kind,
            source: file.source,
            sha256: file.sha256,
          },
          newValue: null,
          ip,
        },
        tx,
      );
    });
  }

  async previewTb(
    user: AuthUser,
    taskId: string,
    entityCode: string,
    fileId: string,
    settings: TbColumnSettingsDto,
    target?: TbTarget,
  ): Promise<TbPreviewDto> {
    const { task, te } = await this.editable(user, taskId, entityCode);
    const { file, rows } = await this.loadTbFile(taskId, entityCode, fileId);
    this.assertSettingsFit(settings, rows);
    return this.preview(
      task,
      te.entity,
      file.id,
      file.originalName,
      rows,
      detectTbLayout(rows),
      settings,
      'EDITED',
      target,
    );
  }

  async confirmTb(
    user: AuthUser,
    taskId: string,
    entityCode: string,
    body: { fileId: string; settings: TbColumnSettingsDto; acknowledged: string[] },
    ip: string | null,
    target?: TbTarget,
  ): Promise<TbVersionDto> {
    const { task, te } = await this.editable(user, taskId, entityCode);
    const { file, rows } = await this.loadTbFile(taskId, entityCode, body.fileId);
    this.assertSettingsFit(body.settings, rows);
    const layout = detectTbLayout(rows);
    const check = await this.check(task, te.entity, file.id, rows, layout, body.settings, target);
    const missing = check.needsAcknowledgement.filter((w) => !body.acknowledged.includes(w.code));
    if (missing.length > 0) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        ApiErrorCode.AcknowledgementRequired,
        `Please acknowledge: ${missing.map((w) => w.message).join(' ')}`,
        { warnings: missing },
      );
    }
    const acknowledged = check.needsAcknowledgement.map((w) => w.code);

    const version = await this.prisma.$transaction(async (tx) => {
      const v = await saveTbVersion(tx, {
        taskId,
        entityCode,
        fileId: file.id,
        check,
        settings: body.settings,
        layout,
        acknowledged,
        createdById: user.id,
        purpose: target?.purpose ?? 'CURRENT',
        periodId: target?.period.id ?? null,
      });
      // The column profile remembers users' files only, not files built from the ERP.
      if (file.source === 'UPLOAD')
        await tx.uploadProfile.upsert({
          where: { entityCode },
          create: { entityCode, settings: { ...body.settings }, updatedById: user.id },
          update: { settings: { ...body.settings }, updatedById: user.id },
        });
      if (check.lines.some((l) => l.accountCode === YTD_PRIOR_PROFIT_CODE))
        await tx.entityAccount.upsert({
          where: { entityCode_accountCode: { entityCode, accountCode: YTD_PRIOR_PROFIT_CODE } },
          create: {
            entityCode,
            accountCode: YTD_PRIOR_PROFIT_CODE,
            accountName: YTD_PRIOR_PROFIT_NAME,
            accountType: 'Equity',
            fsliCode: 'RETAINED',
            source: 'TASK_MAPPING',
            suggested: false,
            mappedInTaskId: taskId,
            updatedById: user.id,
          },
          update: {},
        });
      if (te.status === 'NOT_STARTED' && !target) {
        await tx.taskEntity.update({
          where: { taskId_entityCode: { taskId, entityCode } },
          data: { status: 'IN_PROGRESS' },
        });
      }
      await tx.task.update({ where: { id: taskId }, data: { updatedAt: new Date() } });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.TbUpload,
          entityType: 'TB_VERSION',
          entityId: v.id,
          oldValue: te.status === 'NOT_STARTED' && !target ? { entityStatus: 'NOT_STARTED' } : null,
          newValue: {
            task: task.number,
            entity: entityCode,
            version: v.version,
            file: file.originalName,
            sha256: file.sha256,
            ...(file.source !== 'UPLOAD' ? { source: file.source } : {}),
            status: check.status,
            debits: check.totals.debits,
            credits: check.totals.credits,
            difference: check.totals.difference,
            lines: check.lines.length,
            newAccounts: check.newAccounts.map((a) => a.code),
            settings: body.settings,
            ...(te.status === 'NOT_STARTED' && !target ? { entityStatus: 'IN_PROGRESS' } : {}),
            ...(target ? { purpose: 'COMPARATIVE', period: target.period.label } : {}),
          },
          ip,
        },
        tx,
      );
      for (const w of check.needsAcknowledgement) {
        await this.audit.record(
          {
            userId: user.id,
            action: AuditAction.TbWarningAcknowledge,
            entityType: 'TB_VERSION',
            entityId: v.id,
            newValue: {
              task: task.number,
              entity: entityCode,
              version: v.version,
              warning: w.code,
              message: w.message,
            },
            ip,
          },
          tx,
        );
      }
      return v;
    });
    await this.guard.changed(
      user,
      taskId,
      entityCode,
      `Trial balance replaced (version ${version.version})`,
      ip,
    );
    return toVersionDto(
      await this.prisma.tbVersion.findUniqueOrThrow({
        where: { id: version.id },
        include: versionInclude,
      }),
    );
  }

  async tbVersions(user: AuthUser, taskId: string, entityCode: string): Promise<TbVersionDto[]> {
    await this.viewable(user, taskId, entityCode);
    const rows = await this.prisma.tbVersion.findMany({
      where: { taskId, entityCode, purpose: 'CURRENT' },
      include: versionInclude,
      orderBy: { version: 'desc' },
    });
    return rows.map(toVersionDto);
  }

  private async viewable(user: AuthUser, taskId: string, entityCode: string) {
    const task = await this.loadTask(user, taskId);
    if (
      !task.entities.some((e) => e.entityCode === entityCode) ||
      !inScope(user.entityScope, entityCode)
    )
      throw ApiError.notFound(`Entity ${entityCode} is not in this task.`);
    return task;
  }

  private async loadTbFile(taskId: string, entityCode: string, fileId: string) {
    const file = await this.prisma.uploadedFile.findUnique({ where: { id: fileId } });
    if (!file || file.taskId !== taskId || file.entityCode !== entityCode || file.kind !== 'TB')
      throw ApiError.notFound('Uploaded file not found. Upload it again.');
    let body: Buffer;
    try {
      body = await this.storage.get(file.storageKey);
    } catch (err) {
      if (err instanceof StorageNotFoundError)
        throw ApiError.notFound('The stored file is missing. Upload it again.');
      throw err;
    }
    return { file, rows: this.readRows({ buffer: body, originalname: file.originalName }) };
  }

  private settingsFit(s: TbColumnSettings, rows: Cell[][]): boolean {
    const width = Math.max(0, ...rows.slice(0, 200).map((r) => r.length));
    const col = (c: number | null) => c === null || (c >= 0 && c < width);
    const header = rows[s.headerRow] ?? [];
    // A remembered profile only fits if the header row still names an account code there.
    return (
      s.headerRow < rows.length &&
      col(s.codeColumn) &&
      col(s.nameColumn) &&
      col(s.balanceColumn) &&
      col(s.debitColumn) &&
      col(s.creditColumn) &&
      /account\s*(code|no|number)/i.test(String(header[s.codeColumn] ?? ''))
    );
  }

  private assertSettingsFit(s: TbColumnSettingsDto, rows: Cell[][]): void {
    const width = Math.max(0, ...rows.slice(0, 200).map((r) => r.length));
    if (s.headerRow >= rows.length)
      throw ApiError.validation('The header row is beyond the end of the file.');
    for (const [label, c] of [
      ['account code', s.codeColumn],
      ['account name', s.nameColumn],
      ['balance', s.balanceColumn],
      ['debit', s.debitColumn],
      ['credit', s.creditColumn],
    ] as const) {
      if (c !== null && c >= width)
        throw ApiError.validation(`The ${label} column is beyond the last column of the file.`);
    }
  }

  private async check(
    task: StepTask,
    entity: { code: string; legalName: string },
    fileId: string,
    rows: Cell[][],
    layout: TbLayout,
    settings: TbColumnSettings,
    target?: TbTarget,
  ): Promise<TbCheckResult> {
    const period = target?.period ?? {
      id: task.periodId,
      label: task.period.label,
      startDate: fromDbDate(task.period.startDate),
      endDate: fromDbDate(task.period.endDate),
    };
    const file = await this.prisma.uploadedFile.findUniqueOrThrow({ where: { id: fileId } });
    const [accounts, sameHash] = await Promise.all([
      this.prisma.entityAccount.findMany({
        where: { entityCode: entity.code },
        select: { accountCode: true },
      }),
      this.prisma.uploadedFile.findMany({
        where: { sha256: file.sha256, kind: 'TB', id: { not: fileId }, tbVersions: { some: {} } },
        include: { task: { include: { period: true } } },
      }),
    ]);
    // Identical file already used for another entity or another period.
    const elsewhere = [
      ...new Set(
        sameHash
          .filter((f) => f.entityCode !== entity.code || f.task?.periodId !== period.id)
          .map(
            (f) =>
              `${f.entityCode ?? '?'} · ${f.task?.period.label ?? '?'} (${f.task?.number ?? '?'})`,
          ),
      ),
    ];
    const result = checkTrialBalance({
      rows,
      settings,
      layout,
      period: { startDate: period.startDate, endDate: period.endDate, label: period.label },
      legalName: entity.legalName,
      knownAccounts: new Set(accounts.map((a) => a.accountCode)),
      sameFileElsewhere: elsewhere,
    });
    if (file.source === 'ZOHO') this.addErpNotes(result, file.sourceMeta);
    if (file.source === 'VERACITY') this.addVeracityNotes(result, file.sourceMeta);
    const profile = await this.prisma.uploadProfile.findUnique({
      where: { entityCode: entity.code },
    });
    // A TB fetched from Zoho is already on the period basis (fetchZohoTb).
    return profile?.plBasis === 'YTD' &&
      file.source !== 'ZOHO' &&
      file.source !== 'VERACITY' &&
      result.errors.length === 0
      ? this.toPeriodBasis(result, entity.code, period)
      : result;
  }

  /** The Veracity files a TB was built from, and the result of every process check. */
  private addVeracityNotes(result: TbCheckResult, meta: Prisma.JsonValue): void {
    const m = (meta ?? {}) as {
      files?: { category?: string; vscon?: string };
      monthColumn?: string;
      monthProfit?: string;
      priorProfit?: string;
      difference?: string;
      checks?: {
        label: string;
        value: string;
        expected: string;
        passed: boolean;
        source: string;
      }[];
    };
    const checks = m.checks ?? [];
    result.info.push({
      code: 'VERACITY_SOURCE',
      message: `Built from ${m.files?.category ?? '?'} (P&L, column ${m.monthColumn ?? '?'}) and ${m.files?.vscon ?? '?'} (balance sheet notes, column F). Month profit ${m.monthProfit ?? '?'}; profit of earlier months ${m.priorProfit ?? '?'}. ${checks.filter((c) => c.passed).length} of ${checks.length} process checks passed. Each line's source is in the Source column of the stored file.`,
    });
    for (const c of checks.filter((x) => !x.passed))
      result.warnings.push({
        code: 'VERACITY_CHECK',
        message: `${c.label}: ${c.value} vs ${c.expected} (${c.source}).${m.difference && m.difference !== '0.00' ? ` The difference (with rounding, ${m.difference}) is on line VG-DIFF.` : ''}`,
      });
    if (result.status === 'VALIDATED' && result.warnings.length > 0)
      result.status = 'VALIDATED_WITH_WARNINGS';
  }

  /** Where a TB built from Zoho came from, and what the reader noticed (no account codes). */
  private addErpNotes(result: TbCheckResult, meta: Prisma.JsonValue): void {
    const m = (meta ?? {}) as {
      organizationName?: string;
      from?: string;
      to?: string;
      amountFields?: string;
      priorProfit?: string | null;
      warnings?: string[];
    };
    const dmy = (d?: string) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '?');
    result.info.push({
      code: 'ERP_SOURCE',
      message: `Fetched from Zoho Books (organisation "${m.organizationName ?? '?'}", ${dmy(m.from)} to ${dmy(m.to)}); amount = ${m.amountFields ?? '?'}.`,
    });
    if (m.priorProfit && m.priorProfit !== '0.00')
      result.info.push({
        code: 'ERP_PRIOR_PROFIT',
        message: `Profit of earlier months of the year not yet in Zoho's retained earnings (${m.priorProfit}, debit +) is added as line YTD-PRIOR, mapped to retained earnings.`,
      });
    for (const w of m.warnings ?? [])
      result.warnings.push({ code: 'ERP_NO_ACCOUNT_CODE', message: w });
    if (result.status === 'VALIDATED' && result.warnings.length > 0)
      result.status = 'VALIDATED_WITH_WARNINGS';
  }

  /**
   * Decision round 1 (Q10a): a year-to-date TB. The period P&L = this TB's YTD P&L less the
   * previous month's YTD TB (required; April = YTD as is). Balance-sheet lines stay closing
   * balances; the earlier months' profit is one equity line (YTD-PRIOR → retained earnings).
   */
  private async toPeriodBasis(
    result: TbCheckResult,
    entityCode: string,
    period: { startDate: string; label: string },
  ): Promise<TbCheckResult> {
    const [accounts, fslis] = await Promise.all([
      this.prisma.entityAccount.findMany({ where: { entityCode }, include: { fsli: true } }),
      this.prisma.fsli.findMany({ select: { code: true, statement: true } }),
    ]);
    const statementOf = new Map(fslis.map((x) => [x.code, x.statement]));
    const isPL = (l: { accountCode: string; accountName: string; accountType: string | null }) => {
      const a = accounts.find((x) => x.accountCode === l.accountCode);
      if (a?.fsli) return a.fsli.statement === 'PL';
      const guess = inferMapping({ name: l.accountName, type: l.accountType }, []).fsliCode;
      return guess ? statementOf.get(guess) === 'PL' : false;
    };
    const firstPeriodOfYear = period.startDate.slice(5, 7) === '04';
    const prevEnd = new Date(`${period.startDate}T00:00:00Z`);
    prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);
    const prevPeriod = firstPeriodOfYear
      ? null
      : await this.prisma.period.findFirst({ where: { type: 'MONTHLY', endDate: prevEnd } });
    const prevLabel = prevPeriod?.label ?? `the month ending ${prevEnd.toISOString().slice(0, 10)}`;
    const prevVersion = prevPeriod
      ? await this.prisma.tbVersion.findFirst({
          where: {
            entityCode,
            purpose: 'CURRENT',
            status: { not: 'ERROR' },
            task: { periodId: prevPeriod.id },
            lines: { some: { ytdAmount: { not: null } } },
          },
          orderBy: { createdAt: 'desc' },
          include: { lines: { where: { ytdAmount: { not: null } } } },
        })
      : null;
    const conv = ytdToPeriod({
      current: result.lines.map((l) => ({
        code: l.accountCode,
        name: l.accountName,
        type: l.accountType,
        amount: l.amount,
        isPL: isPL(l),
      })),
      previous: prevVersion
        ? prevVersion.lines.map((l) => ({
            code: l.accountCode,
            name: l.accountName,
            ytdAmount: l.ytdAmount!.toString(),
          }))
        : null,
      firstPeriodOfYear,
      previousLabel: prevLabel,
    });
    if (conv.problems.length)
      return {
        ...result,
        errors: [
          ...result.errors,
          ...conv.problems.map((message) => ({ code: 'YTD_PREVIOUS_TB_MISSING', message })),
        ],
        status: 'ERROR',
      };
    const byCode = new Map(result.lines.map((l) => [l.accountCode, l]));
    const lines = conv.lines.map((c) => {
      const orig = byCode.get(c.code);
      return {
        accountCode: c.code,
        accountName: c.name,
        accountType: c.type,
        amount: c.amount,
        sourceRows: orig?.sourceRows ?? [],
        zero: new Decimal(c.amount).isZero(),
        ytdAmount: c.ytdAmount,
      };
    });
    return {
      ...result,
      lines,
      newAccounts: result.newAccounts.filter((a) => a.code !== YTD_PRIOR_PROFIT_CODE),
      info: [
        ...result.info,
        {
          code: 'YTD_CONVERTED',
          message: firstPeriodOfYear
            ? 'Year-to-date trial balance: April, so the YTD P&L is the period P&L.'
            : `Year-to-date trial balance: P&L converted to ${period.label}'s movement (this TB's YTD less ${prevLabel}'s). Profit of the earlier months (${new Decimal(conv.priorProfit).negated().toFixed(2)}) is carried as ${YTD_PRIOR_PROFIT_CODE}, mapped to retained earnings.`,
        },
      ],
    };
  }

  /** P&L basis of the entity's upload profile (decision round 1, Q10a). Audited. */
  async setPlBasis(
    user: AuthUser,
    taskId: string,
    entityCode: string,
    plBasis: 'PERIOD' | 'YTD',
    ip: string | null,
  ) {
    await this.editable(user, taskId, entityCode);
    const before = await this.prisma.uploadProfile.findUnique({ where: { entityCode } });
    if ((before?.plBasis ?? 'PERIOD') === plBasis) return this.get(user, taskId);
    await this.prisma.$transaction(async (tx) => {
      await tx.uploadProfile.upsert({
        where: { entityCode },
        create: { entityCode, settings: {}, plBasis, updatedById: user.id },
        update: { plBasis, updatedById: user.id },
      });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.UploadProfileUpdate,
          entityType: 'UPLOAD_PROFILE',
          entityId: entityCode,
          oldValue: { plBasis: before?.plBasis ?? 'PERIOD' },
          newValue: { plBasis },
          ip,
        },
        tx,
      );
    });
    return this.get(user, taskId);
  }

  private async preview(
    task: StepTask,
    entity: { code: string; legalName: string },
    fileId: string,
    fileName: string,
    rows: Cell[][],
    layout: TbLayout,
    settings: TbColumnSettings | null,
    source: TbPreviewDto['settingsSource'],
    target?: TbTarget,
  ): Promise<TbPreviewDto> {
    const headerRow = settings?.headerRow ?? layout.headerRow ?? 0;
    const width = Math.min(50, Math.max(0, ...rows.slice(0, 200).map((r) => r.length)));
    const header = rows[headerRow] ?? [];
    const columns = Array.from({ length: width }, (_, i) => {
      const h = String(header[i] ?? '').trim();
      return { index: i, label: `Column ${columnLetter(i)}${h ? ` · ${h}` : ''}` };
    });
    const check = settings
      ? await this.check(task, entity, fileId, rows, layout, settings, target)
      : null;
    return {
      fileId,
      fileName,
      columns,
      settings,
      settingsSource: source,
      detectedPeriod: layout.period,
      detectedOrganisation: layout.organisation,
      preview: (check?.lines ?? []).slice(0, PREVIEW_LINES).map((l) => ({
        row: l.sourceRows[0]!,
        code: l.accountCode,
        name: l.accountName,
        amount: l.amount,
      })),
      check: check && {
        status: check.status,
        balanced: check.balanced,
        totals: check.totals,
        lineCount: check.lines.length,
        newAccounts: check.newAccounts,
        errors: check.errors,
        warnings: check.warnings,
        info: check.info,
        needsAcknowledgement: check.needsAcknowledgement,
      },
    };
  }

  // ---------------------------------------------------------------------------------------
  // Chart of accounts and other documents
  // ---------------------------------------------------------------------------------------

  async uploadCoa(
    user: AuthUser,
    taskId: string,
    entityCode: string,
    blob: UploadedBlob | undefined,
    ip: string | null,
    erp?: { source: 'ZOHO'; sourceMeta: Prisma.InputJsonValue },
  ): Promise<CoaMergeSummaryDto> {
    const file = { ...this.checkFile(blob, TB_FILE_EXTENSIONS), ...erp };
    const { task, te } = await this.editable(user, taskId, entityCode);
    const parsed = parseChartOfAccounts(this.readRows(file));
    if (parsed.errors.length > 0) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        ApiErrorCode.ValidationFailed,
        parsed.errors.map((e) => e.message).join(' '),
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const { stored, plan } = await this.coa.merge(
        tx,
        user,
        { code: entityCode, erp: te.entity.erp },
        file,
        parsed,
        ip,
        { id: taskId, number: task.number },
      );
      const withUser = await tx.uploadedFile.findUniqueOrThrow({
        where: { id: stored.id },
        include: fileInclude,
      });
      return {
        file: toFileRef(withUser),
        added: plan.added.length,
        updated: plan.updated.length,
        unchanged: plan.unchanged.length,
        addedAccounts: plan.added.map((a) => ({
          code: a.code,
          name: a.name,
          fsliCode: a.fsliCode,
        })),
        warnings: parsed.warnings,
      };
    });
  }

  /**
   * Zoho entities: the chart of accounts from Zoho Books, merged exactly like an uploaded
   * chart-of-accounts file (new accounts added with a suggested FSLI, mappings never changed).
   */
  async fetchZohoCoa(
    user: AuthUser,
    taskId: string,
    entityCode: string,
    ip: string | null,
  ): Promise<CoaMergeSummaryDto> {
    const { task, te } = await this.editable(user, taskId, entityCode);
    if (te.entity.erp !== 'ZOHO')
      throw ApiError.validation(`${entityCode} does not use Zoho; upload its chart of accounts.`);
    // Every account the task period's trial balance uses is included.
    const coa = await this.zoho.entityChartOfAccounts(
      entityCode,
      zohoFetchRange(
        { startDate: fromDbDate(task.period.startDate), endDate: fromDbDate(task.period.endDate) },
        'PERIOD',
      ),
    );
    if (coa.accounts.length === 0)
      throw ApiError.validation(
        `Zoho returned no accounts for "${coa.organizationName}"; nothing was changed.`,
      );
    const buffer = Buffer.from(zohoCoaCsv(coa.accounts), 'utf8');
    return this.uploadCoa(
      user,
      taskId,
      entityCode,
      {
        buffer,
        originalname: `Zoho COA ${entityCode} ${coa.organizationName.replace(/[^\w .-]/g, '')}.csv`,
        mimetype: 'text/csv',
        size: buffer.length,
      },
      ip,
      {
        source: 'ZOHO',
        sourceMeta: {
          provider: 'ZOHO',
          organizationId: coa.organizationId,
          organizationName: coa.organizationName,
          accounts: coa.accounts.length,
        },
      },
    );
  }

  async uploadDocument(
    user: AuthUser,
    taskId: string,
    entityCode: string,
    blob: UploadedBlob | undefined,
    ip: string | null,
  ): Promise<FileRefDto> {
    const file = this.checkFile(blob, DOCUMENT_FILE_EXTENSIONS);
    const { task } = await this.editable(user, taskId, entityCode);
    return this.prisma.$transaction(async (tx) => {
      const stored = await storeUpload(tx, this.storage, {
        kind: 'OTHER',
        body: file.buffer,
        originalName: file.originalname,
        contentType: file.mimetype,
        taskId,
        entityCode,
        uploadedById: user.id,
      });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.DocumentUpload,
          entityType: 'UPLOADED_FILE',
          entityId: stored.id,
          newValue: {
            task: task.number,
            entity: entityCode,
            file: stored.originalName,
            size: stored.size,
            sha256: stored.sha256,
          },
          ip,
        },
        tx,
      );
      return toFileRef(
        await tx.uploadedFile.findUniqueOrThrow({ where: { id: stored.id }, include: fileInclude }),
      );
    });
  }

  async files(
    user: AuthUser,
    taskId: string,
    entityCode: string,
    kind: UploadKind,
  ): Promise<FileRefDto[]> {
    await this.viewable(user, taskId, entityCode);
    const rows = await this.prisma.uploadedFile.findMany({
      where: { taskId, entityCode, kind },
      include: fileInclude,
      orderBy: { uploadedAt: 'desc' },
    });
    return rows.map(toFileRef);
  }

  /** The original bytes of an uploaded file, for anyone who can see its task and entity. */
  async download(user: AuthUser, fileId: string) {
    const file = await this.prisma.uploadedFile.findUnique({ where: { id: fileId } });
    if (!file) throw ApiError.notFound('File not found.');
    if (file.taskId) {
      if (!file.entityCode) throw ApiError.notFound('File not found.');
      await this.viewable(user, file.taskId, file.entityCode).catch(() => {
        throw ApiError.notFound('File not found.');
      });
    }
    try {
      return { file, body: await this.storage.get(file.storageKey) };
    } catch (err) {
      if (err instanceof StorageNotFoundError)
        throw ApiError.notFound('The stored file is missing.');
      throw err;
    }
  }

  // ---------------------------------------------------------------------------------------
  // Continue to step 2
  // ---------------------------------------------------------------------------------------

  /** Moves validated entities (in scope, still on this step) to Mapping. Others stay here. */
  async continue(user: AuthUser, taskId: string, ip: string | null): Promise<{ moved: string[] }> {
    const task = await this.loadTask(user, taskId);
    if (this.isLocked(task))
      throw new ApiError(
        HttpStatus.CONFLICT,
        ApiErrorCode.TaskLocked,
        'This task is done and locked.',
      );
    const latest = await this.prisma.tbVersion.findMany({
      where: { taskId, purpose: 'CURRENT' },
      orderBy: { version: 'desc' },
      distinct: ['entityCode'],
    });
    const valid = new Set(latest.filter((v) => v.status !== 'ERROR').map((v) => v.entityCode));
    const inScopeValid = task.entities.filter(
      (e) => inScope(user.entityScope, e.entityCode) && valid.has(e.entityCode),
    );
    if (inScopeValid.length === 0)
      throw ApiError.validation('Validate at least one entity’s trial balance before continuing.');
    const moved = inScopeValid
      .filter((e) => e.currentStep === 'UPLOAD_DATA' && e.status !== 'FINALISED')
      .map((e) => e.entityCode);
    await this.prisma.$transaction(async (tx) => {
      if (moved.length > 0) {
        await tx.taskEntity.updateMany({
          where: { taskId, entityCode: { in: moved } },
          data: { currentStep: 'MAPPING' },
        });
      }
      if (task.currentStep === 'UPLOAD_DATA') {
        await tx.task.update({ where: { id: taskId }, data: { currentStep: 'MAPPING' } });
      }
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.TaskStepContinue,
          entityType: 'TASK',
          entityId: taskId,
          oldValue: { step: 'UPLOAD_DATA', taskStep: task.currentStep },
          newValue: { step: 'MAPPING', task: task.number, moved },
          ip,
        },
        tx,
      );
    });
    return { moved };
  }
}
