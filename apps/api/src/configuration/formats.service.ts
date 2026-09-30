import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  checkFormatCoverage,
  Decimal,
  type FormatFsli,
  type FormatLine,
  renderFormat,
} from '@finance-close/engine';
import {
  ApiErrorCode,
  AuditAction,
  Permission,
  type FormatDetailDto,
  type FormatIssueDto,
  type FormatLineDto,
  type FormatPreviewDto,
  type FormatPreviewSourceDto,
  type FormatSaveInput,
  type FormatSaveResultDto,
} from '@finance-close/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/session-user';
import { ApiError } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';
import { mappedLines } from '../uploads/translation-inputs';

type Tx = Prisma.TransactionClient;

const finalisedWhere = {
  OR: [
    { entities: { some: { status: 'FINALISED' as const } } },
    { levels: { some: { status: 'FINALISED' as const } } },
  ],
} satisfies Prisma.TaskWhereInput;

function lineRows(
  versionId: string,
  lines: readonly FormatLineDto[],
): Prisma.FormatLineCreateManyInput[] {
  const order = { PL: 0, BS: 0 };
  return lines.map((l) => ({
    versionId,
    statement: l.statement,
    sortOrder: ++order[l.statement],
    key: l.key,
    type: l.type,
    label: l.label.trim(),
    indent: l.indent,
    fslis: l.type === 'LINE' ? l.fslis : [],
    formula: (l.type === 'TOTAL' ? l.formula : []) as unknown as Prisma.InputJsonValue,
    role: l.type === 'TOTAL' ? l.role : null,
  }));
}

/** A line as stored (so an unchanged save is recognised). */
const normalise = (l: FormatLineDto): FormatLineDto => ({
  key: l.key,
  statement: l.statement,
  type: l.type,
  label: l.label.trim(),
  indent: l.indent,
  fslis: l.type === 'LINE' ? l.fslis : [],
  formula: l.type === 'TOTAL' ? l.formula.map((p) => ({ key: p.key, op: p.op })) : [],
  role: l.type === 'TOTAL' ? l.role : null,
});

/**
 * Report formats (Configuration → Report formats). A format has versions; tasks record the
 * version they use. Saving changes the current version in place unless a finalised report
 * uses it — then a new version is created and the old one stays attached to that report.
 */
@Injectable()
export class FormatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async fslis(db: Tx | PrismaService = this.prisma): Promise<FormatFsli[]> {
    const rows = await db.fsli.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map((f) => ({
      code: f.code,
      name: f.name,
      statement: f.statement,
      class: f.class,
    }));
  }

  check(lines: readonly FormatLine[], fslis: readonly FormatFsli[]): FormatIssueDto[] {
    return checkFormatCoverage(lines, fslis);
  }

  private async lines(
    versionId: string,
    db: Tx | PrismaService = this.prisma,
  ): Promise<FormatLineDto[]> {
    const rows = await db.formatLine.findMany({
      where: { versionId },
      orderBy: [{ statement: 'desc' }, { sortOrder: 'asc' }],
    });
    // P&L first, then balance sheet ('PL' > 'BS' in desc order).
    return rows.map((l) => ({
      key: l.key,
      statement: l.statement,
      type: l.type,
      label: l.label,
      indent: l.indent,
      fslis: l.fslis,
      formula: l.formula as FormatLineDto['formula'],
      role: (l.role ?? null) as FormatLineDto['role'],
    }));
  }

  async detail(
    user: AuthUser,
    code: string,
    version?: number,
    db: Tx | PrismaService = this.prisma,
  ): Promise<FormatDetailDto> {
    const f = await db.format.findUnique({
      where: { code },
      include: {
        versions: {
          include: { createdBy: { select: { name: true } } },
          orderBy: { version: 'desc' },
        },
      },
    });
    if (!f) throw ApiError.notFound(`Format ${code} not found.`);
    const shown = f.versions.find((v) => v.version === (version ?? f.currentVersion));
    if (!shown) throw ApiError.notFound(`Format ${code} has no version ${version}.`);
    const tasks = await db.task.findMany({
      where: { formatCode: code },
      select: {
        number: true,
        formatVersion: true,
        entities: { select: { status: true } },
        levels: { select: { status: true } },
      },
      orderBy: { number: 'asc' },
    });
    const finalised = (t: (typeof tasks)[number]) =>
      t.entities.some((e) => e.status === 'FINALISED') ||
      t.levels.some((l) => l.status === 'FINALISED');
    const versions = f.versions.map((v) => {
      const on = tasks.filter((t) => (t.formatVersion ?? 1) === v.version);
      return {
        version: v.version,
        note: v.note,
        createdBy: v.createdBy?.name ?? null,
        createdAt: v.createdAt.toISOString(),
        tasks: on.map((t) => t.number),
        finalisedTasks: on.filter(finalised).map((t) => t.number),
      };
    });
    return {
      code: f.code,
      name: f.name,
      description: f.description,
      isActive: f.isActive,
      currentVersion: f.currentVersion,
      version: shown.version,
      lines: await this.lines(shown.id, db),
      versions,
      savesAsNewVersion:
        (versions.find((v) => v.version === f.currentVersion)?.finalisedTasks.length ?? 0) > 0,
      canEdit: user.permissions.has(Permission.ConfigManage),
    };
  }

  private rejectIssues(issues: FormatIssueDto[]): void {
    if (issues.length > 0)
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        ApiErrorCode.ValidationFailed,
        `The format cannot be saved: ${issues.length} problem${issues.length === 1 ? '' : 's'}. ${issues
          .slice(0, 3)
          .map((i) => i.message)
          .join(' ')}`,
        { issues },
      );
  }

  async save(
    user: AuthUser,
    code: string,
    input: FormatSaveInput,
    ip: string | null,
  ): Promise<FormatSaveResultDto> {
    const fslis = await this.fslis();
    this.rejectIssues(this.check(input.lines, fslis));
    return this.prisma.$transaction(async (tx) => {
      const before = await this.detail(user, code, undefined, tx);
      const current = await tx.formatVersion.findUniqueOrThrow({
        where: { formatCode_version: { formatCode: code, version: before.currentVersion } },
      });
      const linesChanged =
        JSON.stringify(before.lines.map(normalise)) !== JSON.stringify(input.lines.map(normalise));
      const newVersion = before.savesAsNewVersion && linesChanged;
      let version = before.currentVersion;
      if (newVersion) {
        version = before.currentVersion + 1;
        const v = await tx.formatVersion.create({
          data: {
            formatCode: code,
            version,
            note: input.note?.trim() || null,
            createdById: user.id,
          },
        });
        await tx.formatLine.createMany({ data: lineRows(v.id, input.lines) });
        // Tasks not yet finalised move to the new version; finalised ones keep theirs.
        await tx.task.updateMany({
          where: { formatCode: code, formatVersion: before.currentVersion, NOT: finalisedWhere },
          data: { formatVersion: version },
        });
      } else if (linesChanged) {
        await tx.formatLine.deleteMany({ where: { versionId: current.id } });
        await tx.formatLine.createMany({ data: lineRows(current.id, input.lines) });
        if (input.note?.trim())
          await tx.formatVersion.update({
            where: { id: current.id },
            data: { note: input.note.trim() },
          });
      }
      await tx.format.update({
        where: { code },
        data: {
          name: input.name.trim(),
          description: input.description.trim(),
          currentVersion: version,
        },
      });
      await this.audit.record(
        {
          userId: user.id,
          action: newVersion ? AuditAction.FormatVersionCreate : AuditAction.FormatUpdate,
          entityType: 'FORMAT',
          entityId: code,
          oldValue: {
            name: before.name,
            description: before.description,
            version: before.currentVersion,
            lines: before.lines,
          },
          newValue: {
            name: input.name.trim(),
            description: input.description.trim(),
            version,
            ...(newVersion
              ? { reason: `Version ${before.currentVersion} is used by finalised reports` }
              : {}),
            lines: input.lines,
          },
          ip,
        },
        tx,
      );
      return { format: await this.detail(user, code, undefined, tx), newVersion };
    });
  }

  async duplicate(
    user: AuthUser,
    code: string,
    input: { code: string; name: string },
    ip: string | null,
  ): Promise<FormatDetailDto> {
    const newCode = input.code.trim().toUpperCase();
    if (await this.prisma.format.findUnique({ where: { code: newCode } }))
      throw new ApiError(
        HttpStatus.CONFLICT,
        ApiErrorCode.Conflict,
        `A format with code ${newCode} already exists.`,
      );
    const source = await this.detail(user, code);
    return this.prisma.$transaction(async (tx) => {
      const max = await tx.format.aggregate({ _max: { sortOrder: true } });
      await tx.format.create({
        data: {
          code: newCode,
          name: input.name.trim(),
          description: source.description,
          sortOrder: (max._max.sortOrder ?? 0) + 1,
          currentVersion: 1,
        },
      });
      const v = await tx.formatVersion.create({
        data: {
          formatCode: newCode,
          version: 1,
          note: `Copied from ${source.name} v${source.version}`,
          createdById: user.id,
        },
      });
      await tx.formatLine.createMany({ data: lineRows(v.id, source.lines) });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.FormatDuplicate,
          entityType: 'FORMAT',
          entityId: newCode,
          oldValue: null,
          newValue: {
            code: newCode,
            name: input.name.trim(),
            copiedFrom: `${code} v${source.version}`,
          },
          ip,
        },
        tx,
      );
      return this.detail(user, newCode, undefined, tx);
    });
  }

  /** Task entities with a validated current TB (finalised first, then newest). */
  async previewSources(): Promise<FormatPreviewSourceDto[]> {
    const rows = await this.prisma.taskEntity.findMany({
      where: { task: { type: 'SFS' }, entity: { isActive: true } },
      include: {
        task: {
          select: { id: true, number: true, period: { select: { label: true, startDate: true } } },
        },
        entity: { select: { shortName: true, functionalCurrency: true, sortOrder: true } },
      },
    });
    const withTb = await this.prisma.tbVersion.findMany({
      where: { purpose: 'CURRENT', status: { not: 'ERROR' } },
      select: { taskId: true, entityCode: true },
      distinct: ['taskId', 'entityCode'],
    });
    const has = new Set(withTb.map((v) => `${v.taskId}:${v.entityCode}`));
    return rows
      .filter((r) => has.has(`${r.taskId}:${r.entityCode}`))
      .sort(
        (a, b) =>
          Number(b.status === 'FINALISED') - Number(a.status === 'FINALISED') ||
          b.task.period.startDate.getTime() - a.task.period.startDate.getTime() ||
          a.entity.sortOrder - b.entity.sortOrder,
      )
      .map((r) => ({
        taskId: r.task.id,
        taskNumber: r.task.number,
        periodLabel: r.task.period.label,
        entityCode: r.entityCode,
        entityName: r.entity.shortName,
        currency: r.entity.functionalCurrency,
        finalised: r.status === 'FINALISED',
      }));
  }

  /** The format filled with a task entity's figures (functional currency, mapped TB). */
  async preview(
    lines: readonly FormatLineDto[],
    taskId: string,
    entityCode: string,
  ): Promise<FormatPreviewDto> {
    const source = (await this.previewSources()).find(
      (s) => s.taskId === taskId && s.entityCode === entityCode,
    );
    if (!source)
      throw ApiError.notFound('Choose a task and entity with a validated trial balance.');
    const [tb, fslis] = await Promise.all([
      this.prisma.$transaction((tx) => mappedLines(tx, taskId, entityCode)),
      this.fslis(),
    ]);
    const amounts: Record<string, Decimal> = {};
    let unmapped = new Decimal(0);
    for (const l of tb ?? []) {
      if (!l.fsliCode) unmapped = unmapped.plus(l.amount);
      else amounts[l.fsliCode] = (amounts[l.fsliCode] ?? new Decimal(0)).plus(l.amount);
    }
    const { rows, balanced } = renderFormat(
      lines,
      Object.fromEntries(Object.entries(amounts).map(([k, v]) => [k, v.toFixed(2)])),
      fslis,
    );
    return { source, rows, balanced, unmapped: unmapped.toFixed(2) };
  }
}
