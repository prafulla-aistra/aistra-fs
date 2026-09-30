import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  type CoaParseResult,
  type Cell,
  Decimal,
  parseChartOfAccounts,
  planCoaMerge,
  validateMapping,
} from '@finance-close/engine';
import {
  ApiErrorCode,
  AuditAction,
  Permission,
  type ChartOfAccountDto,
  type CoaAccountInput,
  type CoaPreviewDto,
  type EntityCoaDto,
} from '@finance-close/shared';
import * as XLSX from 'xlsx';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/session-user';
import { ApiError } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { toMappingFsli } from './mapping-step.service';
import { readSheetRows } from './sheets';
import { storeUpload } from './stored-files';

type Tx = Prisma.TransactionClient;

const SOURCE_LABELS = {
  SEED: 'Seed',
  COA_UPLOAD: 'Chart of accounts upload',
  TASK_MAPPING: 'Mapped in task',
  CONFIGURATION: 'Edited in configuration',
} as const;

const include = {
  fsli: true,
  mappedInTask: { select: { number: true } },
  updatedBy: { select: { name: true } },
} satisfies Prisma.EntityAccountInclude;
type Row = Prisma.EntityAccountGetPayload<{ include: typeof include }>;

const sourceLabel = (a: Row) =>
  a.source === 'TASK_MAPPING' && a.mappedInTask
    ? `Mapped in task ${a.mappedInTask.number}`
    : SOURCE_LABELS[a.source];

export interface CoaFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

/**
 * An entity's chart of accounts with its FSLI mapping and where each mapping came from; the
 * Configuration page edits it, and both the task upload step and Configuration merge Zoho
 * chart-of-accounts files into it (same rule: new codes get the default FSLI for their type;
 * existing codes keep their FSLI and counterparty).
 */
@Injectable()
export class ChartOfAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  private async entity(code: string) {
    const e = await this.prisma.entity.findUnique({ where: { code } });
    if (!e) throw ApiError.notFound(`Entity ${code} not found.`);
    return e;
  }

  async list(entityCode: string): Promise<ChartOfAccountDto[]> {
    await this.entity(entityCode);
    const rows = await this.prisma.entityAccount.findMany({
      where: { entityCode },
      include,
      orderBy: { accountCode: 'asc' },
    });
    return rows.map((a) => ({
      accountCode: a.accountCode,
      accountName: a.accountName,
      accountType: a.accountType,
      fsliCode: a.fsliCode,
      fsliName: a.fsli?.name ?? null,
      counterpartyCode: a.counterpartyCode,
      source: a.source,
      sourceLabel: sourceLabel(a),
      suggested: a.suggested,
      updatedBy: a.updatedBy?.name ?? null,
      updatedAt: a.updatedAt.toISOString(),
    }));
  }

  /** Configuration → Chart of accounts: accounts with stats. */
  async coa(user: AuthUser, entityCode: string): Promise<EntityCoaDto> {
    const e = await this.entity(entityCode);
    const rows = await this.prisma.entityAccount.findMany({
      where: { entityCode },
      include,
      orderBy: { accountCode: 'asc' },
    });
    const mapped = rows.filter((a) => a.fsliCode !== null).length;
    return {
      entity: { code: e.code, name: e.shortName, erp: e.erp, currency: e.functionalCurrency },
      stats: {
        accounts: rows.length,
        mapped,
        mappedPct:
          rows.length === 0
            ? '0.0'
            : new Decimal(mapped)
                .times(100)
                .dividedBy(rows.length)
                .toFixed(1, Decimal.ROUND_HALF_UP),
        unmapped: rows.length - mapped,
        icWithoutCounterparty: rows.filter((a) => a.fsli?.needsCounterparty && !a.counterpartyCode)
          .length,
      },
      accounts: rows.map((a) => ({
        accountCode: a.accountCode,
        accountName: a.accountName,
        accountType: a.accountType,
        parentAccount: a.parentAccount,
        fsliCode: a.fsliCode,
        fsliName: a.fsli?.name ?? null,
        intercompany: a.fsli?.intercompany ?? false,
        needsCounterparty: a.fsli?.needsCounterparty ?? false,
        counterpartyCode: a.counterpartyCode,
        rateBasisOverride: a.rateBasisOverride,
        fsliRateBasis: a.fsli?.rateBasis ?? null,
        source: a.source,
        sourceLabel: sourceLabel(a),
        suggested: a.suggested,
        updatedBy: a.updatedBy?.name ?? null,
        updatedAt: a.updatedAt.toISOString(),
      })),
      canEdit: user.permissions.has(Permission.ConfigManage),
    };
  }

  /**
   * Inline edit of one account: type, FSLI, counterparty and rate-basis override. Changing an
   * existing mapping (FSLI, counterparty or override) needs a reason; type/class warnings must
   * be confirmed. Audited with old and new values.
   */
  async update(
    user: AuthUser,
    entityCode: string,
    accountCode: string,
    input: CoaAccountInput,
    ip: string | null,
  ): Promise<EntityCoaDto> {
    await this.entity(entityCode);
    const before = await this.prisma.entityAccount.findUnique({
      where: { entityCode_accountCode: { entityCode, accountCode } },
    });
    if (!before)
      throw ApiError.notFound(
        `Account ${accountCode} is not in the ${entityCode} chart of accounts.`,
      );
    const [fsliRows, entities] = await Promise.all([
      this.prisma.fsli.findMany({ where: { isActive: true } }),
      this.prisma.entity.findMany({ select: { code: true, isActive: true, parentCode: true } }),
    ]);
    const fslis = fsliRows.map(toMappingFsli);
    const fsli = fsliRows.find((f) => f.code === input.fsliCode);
    const counterparty = fsli?.needsCounterparty ? input.counterpartyCode || null : null;
    const accountType = input.accountType?.trim() ? input.accountType.trim().slice(0, 60) : null;
    const override = input.rateBasisOverride || null;
    const check = validateMapping(
      { accountType, fsliCode: input.fsliCode, counterpartyCode: counterparty },
      { entityCode, fslis, entities },
    );
    const errors = [...check.errors];
    const changesMapping =
      before.fsliCode !== null &&
      (before.fsliCode !== input.fsliCode ||
        before.counterpartyCode !== counterparty ||
        before.rateBasisOverride !== override);
    if (changesMapping && !(input.reason && input.reason.trim().length >= 3))
      errors.push({
        code: 'REASON_REQUIRED',
        message: 'Give a reason for changing an existing mapping.',
      });
    if (errors.length > 0)
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        ApiErrorCode.ValidationFailed,
        errors.map((e) => e.message).join(' '),
        {
          errors,
          warnings: check.warnings,
        },
      );
    if (check.warnings.length > 0 && !input.confirmWarnings)
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        ApiErrorCode.ConfirmationRequired,
        check.warnings.map((w) => w.message).join(' '),
        {
          warnings: check.warnings,
        },
      );

    const unchanged =
      before.fsliCode === input.fsliCode &&
      before.counterpartyCode === counterparty &&
      before.rateBasisOverride === override &&
      before.accountType === accountType;
    if (!unchanged) {
      await this.prisma.$transaction(async (tx) => {
        await tx.entityAccount.update({
          where: { id: before.id },
          data: {
            accountType,
            fsliCode: input.fsliCode,
            counterpartyCode: counterparty,
            rateBasisOverride: override as Prisma.EntityAccountUpdateInput['rateBasisOverride'],
            source: 'CONFIGURATION',
            suggested: false,
            mappedInTaskId: null,
            updatedById: user.id,
          },
        });
        await this.audit.record(
          {
            userId: user.id,
            action: AuditAction.AccountUpdate,
            entityType: 'ENTITY_ACCOUNT',
            entityId: `${entityCode}:${accountCode}`,
            oldValue: {
              accountType: before.accountType,
              fsli: before.fsliCode,
              counterparty: before.counterpartyCode,
              rateBasisOverride: before.rateBasisOverride,
            },
            newValue: {
              account: `${accountCode} ${before.accountName}`,
              accountType,
              fsli: input.fsliCode,
              counterparty,
              rateBasisOverride: override,
              source: SOURCE_LABELS.CONFIGURATION,
              ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
              ...(input.confirmWarnings && check.warnings.length > 0
                ? { warningsConfirmed: true }
                : {}),
            },
            ip,
          },
          tx,
        );
      });
    }
    return this.coa(user, entityCode);
  }

  parse(file: { buffer: Buffer; originalname: string }): CoaParseResult {
    if (!/\.(xlsx|xls|csv)$/i.test(file.originalname))
      throw ApiError.validation('Chart-of-accounts files must be .xlsx, .xls or .csv.');
    let rows: Cell[][];
    try {
      rows = readSheetRows(file.buffer, file.originalname);
    } catch {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        ApiErrorCode.FileRejected,
        'The file could not be read as a spreadsheet.',
      );
    }
    const parsed = parseChartOfAccounts(rows);
    if (parsed.errors.length > 0)
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        ApiErrorCode.ValidationFailed,
        parsed.errors.map((e) => e.message).join(' '),
      );
    return parsed;
  }

  /** The default FSLI for a new account's type: the entity's ERP list first, then Zoho's. */
  private async defaults(db: Tx | PrismaService, erp: string) {
    const rows = await db.accountTypeDefault.findMany({
      where: { erp: { in: [erp as 'ZOHO', 'ZOHO'] } },
    });
    return (type: string | null) =>
      type === null
        ? null
        : ((
            rows.find((d) => d.erp === erp && d.accountType.toLowerCase() === type.toLowerCase()) ??
            rows.find((d) => d.accountType.toLowerCase() === type.toLowerCase())
          )?.fsliCode ?? null);
  }

  private async plan(
    db: Tx | PrismaService,
    entityCode: string,
    erp: string,
    parsed: CoaParseResult,
  ) {
    const existing = await db.entityAccount.findMany({ where: { entityCode } });
    const plan = planCoaMerge(
      existing.map((a) => ({
        code: a.accountCode,
        name: a.accountName,
        type: a.accountType,
        parent: a.parentAccount,
      })),
      parsed.accounts,
    );
    const fsliFor = await this.defaults(db, erp);
    return { ...plan, added: plan.added.map((a) => ({ ...a, fsliCode: fsliFor(a.type) })) };
  }

  /** What a chart-of-accounts upload would change, without saving. */
  async preview(entityCode: string, file: CoaFile): Promise<CoaPreviewDto> {
    const e = await this.entity(entityCode);
    const parsed = this.parse(file);
    const plan = await this.plan(this.prisma, entityCode, e.erp, parsed);
    return {
      fileName: file.originalname,
      added: plan.added.map((a) => ({
        code: a.code,
        name: a.name,
        type: a.type,
        fsliCode: a.fsliCode,
      })),
      updated: plan.updated.map((u) => ({
        code: u.account.code,
        before: { name: u.before.name, type: u.before.type, parent: u.before.parent },
        after: {
          name: u.account.name,
          type: u.account.type ?? u.before.type,
          parent: u.account.parent ?? u.before.parent,
        },
      })),
      unchanged: plan.unchanged.length,
      warnings: parsed.warnings.map((w) => ({ code: w.code, message: w.message })),
    };
  }

  /**
   * Merges a parsed chart of accounts into the entity's accounts, stores the file and audits
   * the change, inside the caller's transaction. `task` is set for uploads from a task.
   */
  async merge(
    tx: Tx,
    user: AuthUser,
    entity: { code: string; erp: string },
    file: CoaFile,
    parsed: CoaParseResult,
    ip: string | null,
    task: { id: string; number: string } | null,
  ) {
    const entityCode = entity.code;
    const plan = await this.plan(tx, entityCode, entity.erp, parsed);
    const stored = await storeUpload(tx, this.storage, {
      kind: 'COA',
      body: file.buffer,
      originalName: file.originalname,
      contentType: file.mimetype,
      taskId: task?.id ?? null,
      entityCode,
      uploadedById: user.id,
    });
    await tx.entityAccount.createMany({
      data: plan.added.map((a) => ({
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
          ...(task ? { task: task.number } : { from: 'Configuration' }),
          file: stored.originalName,
          sha256: stored.sha256,
          added: plan.added.map((a) => ({
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
    return { stored, plan };
  }

  /** Configuration upload: merge and return the refreshed page. */
  async upload(
    user: AuthUser,
    entityCode: string,
    file: CoaFile,
    ip: string | null,
  ): Promise<EntityCoaDto> {
    const e = await this.entity(entityCode);
    const parsed = this.parse(file);
    await this.prisma.$transaction((tx) => this.merge(tx, user, e, file, parsed, ip, null));
    return this.coa(user, entityCode);
  }

  async export(entityCode: string): Promise<Buffer> {
    await this.entity(entityCode);
    const rows = await this.prisma.entityAccount.findMany({
      where: { entityCode },
      include,
      orderBy: { accountCode: 'asc' },
    });
    const ws = XLSX.utils.aoa_to_sheet([
      [
        'Account Code',
        'Account Name',
        'Account Type',
        'Parent Account',
        'FSLI',
        'FSLI name',
        'Counterparty',
        'Rate basis override',
        'Source',
      ],
      ...rows.map((a) => [
        a.accountCode,
        a.accountName,
        a.accountType ?? '',
        a.parentAccount ?? '',
        a.fsliCode ?? '',
        a.fsli?.name ?? '',
        a.counterpartyCode ?? '',
        a.rateBasisOverride ?? '',
        sourceLabel(a),
      ]),
    ]);
    ws['!cols'] = [
      { wch: 14 },
      { wch: 40 },
      { wch: 24 },
      { wch: 24 },
      { wch: 14 },
      { wch: 36 },
      { wch: 12 },
      { wch: 18 },
      { wch: 28 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `${entityCode} accounts`);
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }
}
