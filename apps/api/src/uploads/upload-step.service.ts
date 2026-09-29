import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma, TbVersion, UploadKind } from '@prisma/client';
import {
  type Cell,
  checkTrialBalance,
  detectTbLayout,
  deriveTaskStatus,
  parseChartOfAccounts,
  planCoaMerge,
  type TbCheckResult,
  type TbColumnSettings,
  type TbLayout,
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
import { StorageNotFoundError, StorageService } from '../storage/storage.service';
import { inScope, taskInclude, taskVisibleTo } from '../tasks/tasks.service';
import { toFileRef } from './file-ref';
import { RatesService } from './rates.service';
import { columnLetter, readSheetRows } from './sheets';
import { storeUpload } from './stored-files';
import { saveTbVersion } from './tb-versions';

export interface UploadedBlob {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

const stepInclude = {
  ...taskInclude,
  entities: {
    include: {
      entity: { include: { translatedCurrencies: true } },
    },
  },
} satisfies Prisma.TaskInclude;
type StepTask = Prisma.TaskGetPayload<{ include: typeof stepInclude }>;

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
  ) {}

  // ---------------------------------------------------------------------------------------
  // Loading and access rules
  // ---------------------------------------------------------------------------------------

  private async loadTask(user: AuthUser, taskId: string): Promise<StepTask> {
    const task = await this.prisma.task.findUnique({ where: { id: taskId }, include: stepInclude });
    if (!task || !taskVisibleTo(task, user.entityScope)) throw ApiError.notFound('Task not found.');
    if (task.type !== 'SFS')
      throw ApiError.validation('Uploading data is part of standalone (SFS) tasks.');
    return task;
  }

  private isLocked(task: StepTask): boolean {
    return deriveTaskStatus(task.entities.map((e) => e.status)) === 'DONE';
  }

  /** Why this user cannot upload for the entity now, or null if they can. */
  private readOnlyReason(user: AuthUser, task: StepTask, entityCode: string): string | null {
    const te = task.entities.find((e) => e.entityCode === entityCode);
    if (this.isLocked(task)) return 'This task is done and locked.';
    if (te?.status === 'FINALISED') return 'Finalised — read-only.';
    if (!user.permissions.has(Permission.SfsPrepare))
      return 'You do not have permission to prepare statements.';
    if (!inScope(user.entityScope, entityCode)) return 'Outside your entity scope.';
    return null;
  }

  /** Loads the task and checks the user may upload for the entity (403 / 404 / 409). */
  private async editable(user: AuthUser, taskId: string, entityCode: string) {
    const task = await this.loadTask(user, taskId);
    const te = task.entities.find((e) => e.entityCode === entityCode);
    if (!te) throw ApiError.notFound(`Entity ${entityCode} is not in this task.`);
    if (!inScope(user.entityScope, entityCode))
      throw ApiError.notAllowed(`${entityCode} is outside your entity scope.`);
    if (this.isLocked(task))
      throw new ApiError(
        HttpStatus.CONFLICT,
        ApiErrorCode.TaskLocked,
        'This task is done and locked. Its data cannot change.',
      );
    if (te.status === 'FINALISED')
      throw new ApiError(
        HttpStatus.CONFLICT,
        ApiErrorCode.EntityFinalised,
        `${te.entity.shortName} is finalised in this task. Its data is read-only; changes need an approved edit-access request.`,
      );
    return { task, te };
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

    const [versions, files, counts] = await Promise.all([
      this.prisma.tbVersion.findMany({
        where: { taskId, entityCode: { in: codes } },
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
        where: { taskId, entityCode: { in: codes } },
        _count: true,
      }),
    ]);

    const cards: UploadEntityCardDto[] = entities.map((te) => {
      const latest = versions.find((v) => v.entityCode === te.entityCode);
      const coa = files.filter((f) => f.entityCode === te.entityCode && f.kind === 'COA');
      const reason = this.readOnlyReason(user, task, te.entityCode);
      return {
        code: te.entityCode,
        legalName: te.entity.legalName,
        shortName: te.entity.shortName,
        functionalCurrency: te.entity.functionalCurrency,
        erp: te.entity.erp,
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
    const settings = usable ?? layout.settings;
    return this.preview(
      task,
      te.entity,
      stored.id,
      file.originalname,
      rows,
      layout,
      settings,
      usable ? 'PROFILE' : settings ? 'DETECTED' : 'NONE',
    );
  }

  async previewTb(
    user: AuthUser,
    taskId: string,
    entityCode: string,
    fileId: string,
    settings: TbColumnSettingsDto,
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
    );
  }

  async confirmTb(
    user: AuthUser,
    taskId: string,
    entityCode: string,
    body: { fileId: string; settings: TbColumnSettingsDto; acknowledged: string[] },
    ip: string | null,
  ): Promise<TbVersionDto> {
    const { task, te } = await this.editable(user, taskId, entityCode);
    const { file, rows } = await this.loadTbFile(taskId, entityCode, body.fileId);
    this.assertSettingsFit(body.settings, rows);
    const layout = detectTbLayout(rows);
    const check = await this.check(task, te.entity, file.id, rows, layout, body.settings);
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
      });
      await tx.uploadProfile.upsert({
        where: { entityCode },
        create: { entityCode, settings: { ...body.settings }, updatedById: user.id },
        update: { settings: { ...body.settings }, updatedById: user.id },
      });
      if (te.status === 'NOT_STARTED') {
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
          oldValue: te.status === 'NOT_STARTED' ? { entityStatus: 'NOT_STARTED' } : null,
          newValue: {
            task: task.number,
            entity: entityCode,
            version: v.version,
            file: file.originalName,
            sha256: file.sha256,
            status: check.status,
            debits: check.totals.debits,
            credits: check.totals.credits,
            difference: check.totals.difference,
            lines: check.lines.length,
            newAccounts: check.newAccounts.map((a) => a.code),
            settings: body.settings,
            ...(te.status === 'NOT_STARTED' ? { entityStatus: 'IN_PROGRESS' } : {}),
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
      where: { taskId, entityCode },
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
  ): Promise<TbCheckResult> {
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
          .filter((f) => f.entityCode !== entity.code || f.task?.periodId !== task.periodId)
          .map(
            (f) =>
              `${f.entityCode ?? '?'} · ${f.task?.period.label ?? '?'} (${f.task?.number ?? '?'})`,
          ),
      ),
    ];
    return checkTrialBalance({
      rows,
      settings,
      layout,
      period: {
        startDate: fromDbDate(task.period.startDate),
        endDate: fromDbDate(task.period.endDate),
        label: task.period.label,
      },
      legalName: entity.legalName,
      knownAccounts: new Set(accounts.map((a) => a.accountCode)),
      sameFileElsewhere: elsewhere,
    });
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
  ): Promise<TbPreviewDto> {
    const headerRow = settings?.headerRow ?? layout.headerRow ?? 0;
    const width = Math.min(50, Math.max(0, ...rows.slice(0, 200).map((r) => r.length)));
    const header = rows[headerRow] ?? [];
    const columns = Array.from({ length: width }, (_, i) => {
      const h = String(header[i] ?? '').trim();
      return { index: i, label: `Column ${columnLetter(i)}${h ? ` · ${h}` : ''}` };
    });
    const check = settings ? await this.check(task, entity, fileId, rows, layout, settings) : null;
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
  ): Promise<CoaMergeSummaryDto> {
    const file = this.checkFile(blob, TB_FILE_EXTENSIONS);
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
      const existing = await tx.entityAccount.findMany({ where: { entityCode } });
      const plan = planCoaMerge(
        existing.map((a) => ({
          code: a.accountCode,
          name: a.accountName,
          type: a.accountType,
          parent: a.parentAccount,
        })),
        parsed.accounts,
      );
      const defaults = await tx.accountTypeDefault.findMany({
        where: { erp: { in: [te.entity.erp, 'ZOHO'] } },
      });
      // The entity's ERP defaults first, then the Zoho list (the only one defined so far).
      const fsliFor = (type: string | null) =>
        type === null
          ? null
          : ((
              defaults.find(
                (d) =>
                  d.erp === te.entity.erp && d.accountType.toLowerCase() === type.toLowerCase(),
              ) ?? defaults.find((d) => d.accountType.toLowerCase() === type.toLowerCase())
            )?.fsliCode ?? null);

      const stored = await storeUpload(tx, this.storage, {
        kind: 'COA',
        body: file.buffer,
        originalName: file.originalname,
        contentType: file.mimetype,
        taskId,
        entityCode,
        uploadedById: user.id,
      });
      const added = plan.added.map((a) => ({ ...a, fsliCode: fsliFor(a.type) }));
      await tx.entityAccount.createMany({
        data: added.map((a) => ({
          entityCode,
          accountCode: a.code.slice(0, 40),
          accountName: a.name.slice(0, 200),
          accountType: a.type?.slice(0, 60) ?? null,
          parentAccount: a.parent?.slice(0, 200) ?? null,
          fsliCode: a.fsliCode,
          source: 'COA_UPLOAD' as const,
          suggested: true,
          updatedById: user.id,
        })),
      });
      // Existing accounts: name, type and parent only — never the FSLI or counterparty.
      for (const u of plan.updated) {
        await tx.entityAccount.update({
          where: { entityCode_accountCode: { entityCode, accountCode: u.account.code } },
          data: {
            accountName: u.account.name.slice(0, 200),
            ...(u.account.type !== null ? { accountType: u.account.type.slice(0, 60) } : {}),
            ...(u.account.parent !== null ? { parentAccount: u.account.parent.slice(0, 200) } : {}),
            updatedById: user.id,
          },
        });
      }
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.CoaUpload,
          entityType: 'ENTITY_ACCOUNTS',
          entityId: entityCode,
          oldValue: plan.updated.map((u) => ({
            code: u.account.code,
            name: u.before.name,
            type: u.before.type,
            parent: u.before.parent,
          })),
          newValue: {
            task: task.number,
            file: stored.originalName,
            sha256: stored.sha256,
            added: added.map((a) => ({
              code: a.code,
              name: a.name,
              type: a.type,
              fsli: a.fsliCode,
            })),
            updated: plan.updated.map((u) => ({
              code: u.account.code,
              name: u.account.name,
              type: u.account.type,
              parent: u.account.parent,
            })),
            unchanged: plan.unchanged.length,
          },
          ip,
        },
        tx,
      );
      const withUser = await tx.uploadedFile.findUniqueOrThrow({
        where: { id: stored.id },
        include: fileInclude,
      });
      return {
        file: toFileRef(withUser),
        added: added.length,
        updated: plan.updated.length,
        unchanged: plan.unchanged.length,
        addedAccounts: added.map((a) => ({ code: a.code, name: a.name, fsliCode: a.fsliCode })),
        warnings: parsed.warnings,
      };
    });
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
      where: { taskId },
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
