import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  deriveConsolidationLevels,
  deriveTaskStatus,
  effectiveOwnership,
  type ConsolidationLevel,
  type GroupEntity,
  missingHistoricalRates,
  monthLabel,
  nciPoints,
  ownershipAsAt,
  type OwnershipRow,
  toDecimal,
  validateGroupStructure,
} from '@finance-close/engine';
import {
  AuditAction,
  type ChangeOwnershipRequest,
  type ConsolidationLevelDto,
  type CreateEntityRequest,
  type EntityDetailDto,
  type EntityDto,
  type EntityInput,
  type EntityPreviewDto,
  type EntityPreviewRequest,
  type GroupIssueDto,
  type GroupStructureDto,
  type GroupTreeNode,
  type UpdateEntityRequest,
} from '@finance-close/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/session-user';
import { ApiError } from '../common/api-error';
import { diffFields } from '../common/audit-diff';
import { ClockService } from '../common/clock';
import { fromDbDate, toDbDate } from '../common/db-dates';
import { PrismaService } from '../prisma/prisma.service';

const include = {
  translatedCurrencies: { select: { currencyCode: true } },
  historicalRates: true,
  parent: { select: { shortName: true, legalName: true } },
  ownership: { orderBy: { effectiveFrom: 'asc' as const } },
  levelCurrency: true,
} satisfies Prisma.EntityInclude;
type EntityRow = Prisma.EntityGetPayload<{ include: typeof include }>;

const FIRST_OF_MONTH = /^\d{4}-\d{2}-01$/;
const pctText = (d: Prisma.Decimal | null) => d?.toString() ?? null;
const trimPct = (s: string) => toDecimal(s).toString();

/**
 * Entity master and group structure (CLAUDE.md). The parent and % held have a history
 * (entity_ownership): a change adds a row effective from a month, and every structure —
 * the org chart, consolidation levels, new CFS tasks — uses the rows in force for the month
 * in question. Entity.parentCode / heldByParentPct mirror the row in force this month.
 */
@Injectable()
export class EntitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
  ) {}

  private thisMonth(): string {
    return `${this.clock.today().slice(0, 7)}-01`;
  }

  // ---------------------------------------------------------------- structure as at a month

  private ownershipRows(rows: EntityRow[]): OwnershipRow[] {
    return rows.flatMap((r) =>
      r.ownership.map((o) => ({
        entityCode: r.code,
        parentCode: o.parentCode,
        heldByParentPct: pctText(o.heldByParentPct),
        effectiveFrom: fromDbDate(o.effectiveFrom),
      })),
    );
  }

  /** Group entities with the parent and % held in force in `month` (later acquisitions left out). */
  private structureAt(rows: EntityRow[], month: string, extra: OwnershipRow[] = []): GroupEntity[] {
    const inForce = ownershipAsAt([...this.ownershipRows(rows), ...extra], month);
    return rows
      .filter((r) => inForce.has(r.code) || r.ownership.length === 0)
      .map((r) => {
        const o = inForce.get(r.code);
        return {
          code: r.code,
          name: r.shortName,
          parentCode: o ? o.parentCode : r.parentCode,
          heldByParentPct: o ? o.heldByParentPct : pctText(r.heldByParentPct),
          reportingCurrency: r.levelCurrency?.currency ?? r.reportingCurrency,
          isActive: r.isActive,
        };
      });
  }

  private safeLevels(entities: GroupEntity[]): ConsolidationLevel[] {
    return validateGroupStructure(entities).length === 0 ? deriveConsolidationLevels(entities) : [];
  }

  // ---------------------------------------------------------------- queries

  async list(): Promise<EntityDto[]> {
    const rows = await this.rows();
    const structure = this.structureAt(rows, this.thisMonth());
    const levels = this.safeLevels(structure);
    const effective =
      validateGroupStructure(structure).length === 0 ? effectiveOwnership(structure) : {};
    const rateEntities = rows.map(toRateEntity);
    const locked = await this.finalisedEntities();
    return rows.map((r) =>
      toDto(r, missingHistoricalRates(toRateEntity(r), rateEntities, levels), {
        effectiveGroupPct: effective[r.code] ?? null,
        ownershipEffectiveFrom: this.currentOwnership(r)?.effectiveFrom ?? null,
        lockReason: locked.get(r.code) ?? null,
      }),
    );
  }

  async get(code: string): Promise<EntityDto> {
    const found = (await this.list()).find((e) => e.code === code.toUpperCase());
    if (!found) throw ApiError.notFound(`Entity ${code} not found.`);
    return found;
  }

  /** Structure as at a month (default: this month), with effective % and NCI per level. */
  async groupStructure(asAt?: string): Promise<GroupStructureDto> {
    const month = asAt ? `${asAt.slice(0, 7)}-01` : this.thisMonth();
    const rows = await this.rows();
    const groupEntities = this.structureAt(rows, month);
    const issues = validateGroupStructure(groupEntities);
    if (issues.length > 0) return { tree: null, levels: [], issues, asAt: month };

    const effective = effectiveOwnership(groupEntities);
    const byCode = new Map(rows.map((r) => [r.code, r]));
    const active = groupEntities.filter((g) => g.isActive !== false);
    const build = (g: GroupEntity): GroupTreeNode => {
      const r = byCode.get(g.code)!;
      return {
        code: r.code,
        shortName: r.shortName,
        legalName: r.legalName,
        functionalCurrency: r.functionalCurrency,
        reportingCurrency: r.reportingCurrency,
        heldByParentPct: g.heldByParentPct,
        effectiveGroupPct: effective[r.code] ?? '100',
        toBeConfirmed: r.toBeConfirmed,
        children: active.filter((c) => c.parentCode === g.code).map(build),
      };
    };
    const root = active.find((g) => g.parentCode === null);
    const levels = deriveConsolidationLevels(groupEntities).map((l): ConsolidationLevelDto => {
      const parent = byCode.get(l.parentCode)!;
      return {
        level: l.level,
        name: l.name,
        parentCode: l.parentCode,
        parentLegalName: parent.legalName,
        currency: l.currency,
        defaultCurrency: parent.reportingCurrency,
        currencyOverridden: Boolean(parent.levelCurrency),
        members: l.members.map((code) => {
          const m = byCode.get(code)!;
          return {
            code,
            shortName: m.shortName,
            legalName: m.legalName,
            functionalCurrency: m.functionalCurrency,
          };
        }),
        nci: nciPoints(l, groupEntities).map((n) => ({
          ...n,
          name: `${byCode.get(n.entityCode)!.shortName} group`,
        })),
      };
    });
    return { tree: root ? build(root) : null, levels, issues: [], asAt: month };
  }

  async detail(codeRaw: string): Promise<EntityDetailDto> {
    const code = codeRaw.toUpperCase();
    const entity = await this.get(code);
    const row = (await this.rows()).find((r) => r.code === code)!;
    const names = new Map(
      (await this.prisma.entity.findMany({ select: { code: true, legalName: true } })).map((e) => [
        e.code,
        e.legalName,
      ]),
    );
    const current = this.currentOwnership(row);
    const users = new Map(
      (
        await this.prisma.user.findMany({
          where: {
            id: {
              in: row.ownership.map((o) => o.createdById).filter((x): x is string => Boolean(x)),
            },
          },
          select: { id: true, name: true },
        })
      ).map((u) => [u.id, u.name]),
    );
    const structure = await this.groupStructure();
    const [accounts, taskEntities, cfsTasks, history] = await Promise.all([
      this.prisma.entityAccount.findMany({
        where: { entityCode: code },
        select: { fsliCode: true },
      }),
      this.prisma.taskEntity.findMany({
        where: { entityCode: code },
        include: { task: { include: { period: true, entities: { select: { status: true } } } } },
        orderBy: { task: { createdAt: 'desc' } },
      }),
      this.prisma.task.findMany({
        where: { type: 'CFS', levels: { some: { members: { has: code } } } },
        include: { period: true, levels: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auditLog.findMany({
        where: { entityType: 'ENTITY', entityId: code },
        include: { user: { select: { name: true } } },
        orderBy: { id: 'desc' },
        take: 200,
      }),
    ]);
    const mapped = accounts.filter((a) => a.fsliCode).length;
    return {
      entity,
      ownership: [...row.ownership].reverse().map((o) => ({
        id: o.id,
        parentCode: o.parentCode,
        parentLegalName: o.parentCode ? (names.get(o.parentCode) ?? null) : null,
        heldByParentPct: pctText(o.heldByParentPct),
        effectiveFrom: fromDbDate(o.effectiveFrom),
        reason: o.reason,
        by: o.createdById ? (users.get(o.createdById) ?? null) : null,
        at: o.createdAt.toISOString(),
        current: current?.id === o.id,
      })),
      levels: structure.levels
        .filter((l) => l.members.some((m) => m.code === code))
        .map((l) => ({ level: l.level, name: l.name, currency: l.currency })),
      chartOfAccounts: {
        accounts: accounts.length,
        mapped,
        mappedPct:
          accounts.length === 0
            ? '0'
            : toDecimal(String(mapped))
                .times(100)
                .dividedBy(accounts.length)
                .toDecimalPlaces(0)
                .toString(),
      },
      tasks: [
        ...taskEntities.map((te) => ({
          id: te.taskId,
          number: te.task.number,
          type: te.task.type,
          periodLabel: te.task.period.label,
          status: deriveTaskStatus(te.task.entities.map((e) => e.status)),
          itemStatus: te.status,
        })),
        ...cfsTasks.map((t) => ({
          id: t.id,
          number: t.number,
          type: t.type,
          periodLabel: t.period.label,
          status: deriveTaskStatus(t.levels.map((l) => l.status)),
          itemStatus: '—',
        })),
      ],
      history: history.map((h) => ({
        id: h.id.toString(),
        timestamp: h.timestamp.toISOString(),
        action: h.action,
        user: h.user?.name ?? null,
        oldValue: h.oldValue,
        newValue: h.newValue,
      })),
      deactivateBlockedReason: row.isActive ? await this.deactivateBlocked(code) : null,
    };
  }

  /** Where a proposed entity would sit: path, effective %, levels, historical rates needed. */
  async preview(req: EntityPreviewRequest): Promise<EntityPreviewDto> {
    const code = req.code.trim().toUpperCase() || 'NEW';
    const month = FIRST_OF_MONTH.test(req.effectiveFrom) ? req.effectiveFrom : this.thisMonth();
    const rows = (await this.rows()).filter((r) => r.code !== code);
    const proposed: GroupEntity = {
      code,
      name: code,
      parentCode: req.parentCode,
      heldByParentPct: req.heldByParentPct?.trim() || null,
      reportingCurrency: req.reportingCurrency,
      isActive: true,
    };
    const structure = [...this.structureAt(rows, month), proposed];
    const issues: GroupIssueDto[] = validateGroupStructure(structure);
    const byCode = new Map(rows.map((r) => [r.code, r]));
    const path: EntityPreviewDto['path'] = [];
    for (let c: string | null = code, guard = 0; c && guard < 50; guard++) {
      path.unshift({
        code: c,
        legalName: c === code ? 'New entity' : (byCode.get(c)?.legalName ?? c),
      });
      c =
        c === code
          ? proposed.parentCode
          : (structure.find((g) => g.code === c)?.parentCode ?? null);
    }
    if (issues.length > 0)
      return { path, effectiveGroupPct: null, levels: [], requiredHistoricalRates: [], issues };
    const levels = deriveConsolidationLevels(structure);
    const rateEntities = [
      ...rows.map(toRateEntity),
      {
        code,
        functionalCurrency: req.functionalCurrency,
        parentCode: req.parentCode,
        translatedCurrencies: req.translatedCurrencies,
        historicalRateCurrencies: [],
      },
    ];
    return {
      path,
      effectiveGroupPct: effectiveOwnership(structure)[code] ?? null,
      levels: levels
        .filter((l) => l.members.includes(code))
        .map((l) => ({ level: l.level, name: l.name, currency: l.currency })),
      requiredHistoricalRates: missingHistoricalRates(rateEntities.at(-1)!, rateEntities, levels),
      issues: [],
    };
  }

  // ---------------------------------------------------------------- commands

  async create(actor: AuthUser, req: CreateEntityRequest, ip: string | null): Promise<EntityDto> {
    const code = req.code.trim().toUpperCase();
    if (await this.prisma.entity.findUnique({ where: { code } })) {
      throw ApiError.conflict(`An entity with code ${code} already exists.`);
    }
    const effectiveFrom = req.ownershipEffectiveFrom ?? this.thisMonth();
    if (!FIRST_OF_MONTH.test(effectiveFrom))
      throw ApiError.validation('Ownership "effective from" must be the first day of a month.');
    await this.validate(code, req, null, effectiveFrom);
    const maxSort = await this.prisma.entity.aggregate({ _max: { sortOrder: true } });

    await this.prisma.$transaction(async (tx) => {
      await tx.entity.create({
        data: {
          code,
          ...scalarData(req),
          parentCode: req.parentCode,
          heldByParentPct: req.heldByParentPct,
          isActive: true,
          sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
        },
      });
      await tx.entityOwnership.create({
        data: {
          entityCode: code,
          parentCode: req.parentCode,
          heldByParentPct: req.heldByParentPct,
          effectiveFrom: toDbDate(effectiveFrom),
          reason: 'New entity',
          createdById: actor.id,
        },
      });
      await this.writeCurrencies(tx, code, req);
      const after = await tx.entity.findUniqueOrThrow({ where: { code }, include });
      await this.audit.record(
        {
          userId: actor.id,
          action: AuditAction.EntityCreate,
          entityType: 'ENTITY',
          entityId: code,
          newValue: { ...snapshot(after), ownershipEffectiveFrom: effectiveFrom },
          ip,
        },
        tx,
      );
    });
    return this.get(code);
  }

  /**
   * Edits everything except the code, the parent / % held (a new ownership row: see
   * changeOwnership) and the active flag (deactivate / reactivate). A currency change needs
   * a reason; the functional currency is fixed once the entity has a finalised report.
   */
  async update(
    actor: AuthUser,
    codeRaw: string,
    req: UpdateEntityRequest,
    ip: string | null,
  ): Promise<EntityDto> {
    const code = codeRaw.toUpperCase();
    const before = await this.prisma.entity.findUnique({ where: { code }, include });
    if (!before) throw ApiError.notFound(`Entity ${code} not found.`);

    const parentChanged =
      (req.parentCode ?? null) !== before.parentCode ||
      (req.heldByParentPct === null ? null : trimPct(req.heldByParentPct)) !==
        pctText(before.heldByParentPct);
    if (parentChanged)
      throw ApiError.validation(
        'The parent and % held are changed with "Change ownership", which keeps the ownership history.',
      );
    if (req.isActive !== before.isActive)
      throw ApiError.validation(
        `Use ${before.isActive ? 'Deactivate' : 'Reactivate'} to change whether the entity is active.`,
      );

    const translatedBefore = before.translatedCurrencies
      .map((t) => t.currencyCode)
      .sort()
      .join(',');
    const currencyChanged =
      req.functionalCurrency !== before.functionalCurrency ||
      req.reportingCurrency !== before.reportingCurrency ||
      [...new Set(req.translatedCurrencies)].sort().join(',') !== translatedBefore;
    if (currencyChanged && !(req.reason && req.reason.trim().length >= 3))
      throw ApiError.validation('Give a reason for the currency change.');
    if (req.functionalCurrency !== before.functionalCurrency) {
      const lock = (await this.finalisedEntities()).get(code);
      if (lock) throw ApiError.validation(`The functional currency cannot change: ${lock}`);
    }
    await this.validate(code, req, before, this.thisMonth());

    await this.prisma.$transaction(async (tx) => {
      await tx.entity.update({ where: { code }, data: scalarData(req) });
      await tx.entityTranslatedCurrency.deleteMany({ where: { entityCode: code } });
      await tx.entityHistoricalRate.deleteMany({ where: { entityCode: code } });
      await this.writeCurrencies(tx, code, req);
      const after = await tx.entity.findUniqueOrThrow({ where: { code }, include });
      const d = diffFields(snapshot(before), snapshot(after));
      if (d) {
        await this.audit.record(
          {
            userId: actor.id,
            action: AuditAction.EntityUpdate,
            entityType: 'ENTITY',
            entityId: code,
            oldValue: d.oldValue,
            newValue: {
              ...(d.newValue as object),
              ...(req.reason?.trim() ? { reason: req.reason.trim() } : {}),
            },
            ip,
          },
          tx,
        );
      }
    });
    return this.get(code);
  }

  /** Adds an ownership row (parent, % held) effective from a month; the history is kept. */
  async changeOwnership(
    actor: AuthUser,
    codeRaw: string,
    req: ChangeOwnershipRequest,
    ip: string | null,
  ): Promise<EntityDetailDto> {
    const code = codeRaw.toUpperCase();
    const rows = await this.rows();
    const row = rows.find((r) => r.code === code);
    if (!row) throw ApiError.notFound(`Entity ${code} not found.`);
    if (!FIRST_OF_MONTH.test(req.effectiveFrom))
      throw ApiError.validation('"Effective from" must be the first day of a month.');
    if (!(req.reason && req.reason.trim().length >= 3))
      throw ApiError.validation('Give a reason for the ownership change.');
    if (req.heldByParentPct !== null && !/^\d{1,3}(\.\d{1,4})?$/.test(req.heldByParentPct.trim()))
      throw ApiError.validation(
        `% held by parent must be a number with at most 4 decimals (got "${req.heldByParentPct}").`,
      );
    if (row.ownership.some((o) => fromDbDate(o.effectiveFrom) === req.effectiveFrom))
      throw ApiError.conflict(
        `${code} already has an ownership change effective from ${monthLabel(req.effectiveFrom)}. Choose another month.`,
      );
    const first = row.ownership[0];
    if (first && req.effectiveFrom < fromDbDate(first.effectiveFrom))
      throw ApiError.validation(
        `${code}'s ownership history starts in ${monthLabel(fromDbDate(first.effectiveFrom))}; a change cannot be earlier.`,
      );

    const next: OwnershipRow = {
      entityCode: code,
      parentCode: req.parentCode,
      heldByParentPct: req.heldByParentPct?.trim() || null,
      effectiveFrom: req.effectiveFrom,
    };
    // The structure must be valid from the change onwards, at every later change too.
    const checkpoints = [
      ...new Set([
        req.effectiveFrom,
        ...this.ownershipRows(rows)
          .map((o) => o.effectiveFrom)
          .filter((m) => m > req.effectiveFrom),
      ]),
    ].sort();
    for (const month of checkpoints) {
      const issues = validateGroupStructure(this.structureAt(rows, month, [next]));
      if (issues.length > 0)
        throw ApiError.validation(
          `From ${monthLabel(month)}: ${[...new Set(issues.map((i) => i.message))].join(' ')}`,
        );
    }

    const before = this.currentOwnership(row);
    await this.prisma.$transaction(async (tx) => {
      await tx.entityOwnership.create({
        data: {
          entityCode: code,
          parentCode: next.parentCode,
          heldByParentPct: next.heldByParentPct,
          effectiveFrom: toDbDate(req.effectiveFrom),
          reason: req.reason.trim(),
          createdById: actor.id,
        },
      });
      await this.syncCurrent(tx, code);
      await this.audit.record(
        {
          userId: actor.id,
          action: AuditAction.EntityOwnershipChange,
          entityType: 'ENTITY',
          entityId: code,
          oldValue: before
            ? {
                parentCode: before.parentCode,
                heldByParentPct: before.heldByParentPct,
                effectiveFrom: before.effectiveFrom,
              }
            : null,
          newValue: {
            parentCode: next.parentCode,
            heldByParentPct: next.heldByParentPct,
            effectiveFrom: req.effectiveFrom,
            reason: req.reason.trim(),
          },
          ip,
        },
        tx,
      );
    });
    return this.detail(code);
  }

  async setActive(
    actor: AuthUser,
    codeRaw: string,
    active: boolean,
    reason: string,
    ip: string | null,
  ): Promise<EntityDetailDto> {
    const code = codeRaw.toUpperCase();
    const row = await this.prisma.entity.findUnique({ where: { code } });
    if (!row) throw ApiError.notFound(`Entity ${code} not found.`);
    if (!(reason && reason.trim().length >= 3))
      throw ApiError.validation(
        `Give a reason to ${active ? 'reactivate' : 'deactivate'} ${code}.`,
      );
    if (row.isActive === active)
      throw ApiError.validation(`${code} is already ${active ? 'active' : 'inactive'}.`);
    if (!active) {
      const blocked = await this.deactivateBlocked(code);
      if (blocked) throw ApiError.conflict(blocked);
    } else if (row.parentCode) {
      const parent = await this.prisma.entity.findUnique({ where: { code: row.parentCode } });
      if (!parent?.isActive)
        throw ApiError.conflict(`Reactivate the parent ${row.parentCode} first.`);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.entity.update({ where: { code }, data: { isActive: active } });
      await this.audit.record(
        {
          userId: actor.id,
          action: active ? AuditAction.EntityReactivate : AuditAction.EntityDeactivate,
          entityType: 'ENTITY',
          entityId: code,
          oldValue: { isActive: !active },
          newValue: { isActive: active, reason: reason.trim() },
          ip,
        },
        tx,
      );
    });
    return this.detail(code);
  }

  /** Level currency override (null = back to the parent's reporting currency). */
  async setLevelCurrency(
    actor: AuthUser,
    parentCode: string,
    currency: string | null,
    reason: string,
    ip: string | null,
  ): Promise<GroupStructureDto> {
    const code = parentCode.toUpperCase();
    const entity = await this.prisma.entity.findUnique({
      where: { code },
      include: { levelCurrency: true },
    });
    if (!entity) throw ApiError.notFound(`Entity ${code} not found.`);
    if (!(reason && reason.trim().length >= 3))
      throw ApiError.validation('Give a reason for the level currency change.');
    if (currency) {
      const c = await this.prisma.currency.findUnique({ where: { code: currency } });
      if (!c?.isActive) throw ApiError.validation(`${currency} is not an active currency.`);
    }
    const next = currency && currency !== entity.reportingCurrency ? currency : null;
    const before = entity.levelCurrency?.currency ?? null;
    if (before !== next) {
      await this.prisma.$transaction(async (tx) => {
        if (next) {
          await tx.levelCurrencyOverride.upsert({
            where: { parentEntityCode: code },
            create: { parentEntityCode: code, currency: next, updatedById: actor.id },
            update: { currency: next, updatedById: actor.id },
          });
        } else {
          await tx.levelCurrencyOverride.deleteMany({ where: { parentEntityCode: code } });
        }
        await this.audit.record(
          {
            userId: actor.id,
            action: AuditAction.LevelCurrencyChange,
            entityType: 'ENTITY',
            entityId: code,
            oldValue: { levelCurrency: before ?? `${entity.reportingCurrency} (default)` },
            newValue: {
              levelCurrency: next ?? `${entity.reportingCurrency} (default)`,
              reason: reason.trim(),
            },
            ip,
          },
          tx,
        );
      });
    }
    return this.groupStructure();
  }

  // ---------------------------------------------------------------- helpers

  private rows(): Promise<EntityRow[]> {
    return this.prisma.entity.findMany({
      include,
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
  }

  private currentOwnership(r: EntityRow) {
    const month = this.thisMonth();
    const o = [...r.ownership].filter((x) => fromDbDate(x.effectiveFrom) <= month).at(-1);
    return o
      ? {
          id: o.id,
          parentCode: o.parentCode,
          heldByParentPct: pctText(o.heldByParentPct),
          effectiveFrom: fromDbDate(o.effectiveFrom),
        }
      : null;
  }

  /** Entity.parentCode / heldByParentPct = the ownership row in force this month. */
  private async syncCurrent(tx: Prisma.TransactionClient, code: string) {
    const month = toDbDate(this.thisMonth());
    const o = await tx.entityOwnership.findFirst({
      where: { entityCode: code, effectiveFrom: { lte: month } },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (o)
      await tx.entity.update({
        where: { code },
        data: { parentCode: o.parentCode, heldByParentPct: o.heldByParentPct },
      });
  }

  /** Entities with a finalised report → why their functional currency is fixed. */
  private async finalisedEntities(): Promise<Map<string, string>> {
    const [entities, levels] = await Promise.all([
      this.prisma.taskEntity.findMany({
        where: { status: 'FINALISED' },
        include: { task: { select: { number: true } } },
        orderBy: { finalisedAt: 'asc' },
      }),
      this.prisma.taskLevel.findMany({
        where: { status: 'FINALISED' },
        include: { task: { select: { number: true } } },
      }),
    ]);
    const out = new Map<string, string>();
    for (const te of entities)
      if (!out.has(te.entityCode))
        out.set(te.entityCode, `${te.entityCode} has finalised reports (e.g. ${te.task.number}).`);
    for (const l of levels)
      for (const m of l.members)
        if (!out.has(m)) out.set(m, `${m} is in a finalised consolidation (${l.task.number}).`);
    return out;
  }

  /** Why the entity cannot be deactivated (open task, active subsidiaries), or null. */
  private async deactivateBlocked(code: string): Promise<string | null> {
    const [sfs, cfs, children] = await Promise.all([
      this.prisma.task.findMany({
        where: { type: 'SFS', entities: { some: { entityCode: code } } },
        include: { entities: { select: { status: true } } },
      }),
      this.prisma.task.findMany({
        where: { type: 'CFS', levels: { some: { members: { has: code } } } },
        include: { levels: { select: { status: true } } },
      }),
      this.prisma.entity.findMany({
        where: { parentCode: code, isActive: true },
        select: { code: true },
      }),
    ]);
    const open = [
      ...sfs.filter((t) => deriveTaskStatus(t.entities.map((e) => e.status)) !== 'DONE'),
      ...cfs.filter((t) => deriveTaskStatus(t.levels.map((l) => l.status)) !== 'DONE'),
    ].map((t) => t.number);
    if (open.length > 0)
      return `${code} is in open task${open.length === 1 ? '' : 's'} ${open.join(', ')}. Finish or remove it from those tasks first.`;
    if (children.length > 0)
      return `${code} has active subsidiaries (${children.map((c) => c.code).join(', ')}). Reassign them to another parent first.`;
    return null;
  }

  private async writeCurrencies(tx: Prisma.TransactionClient, code: string, req: EntityInput) {
    await tx.entityTranslatedCurrency.createMany({
      data: [...new Set(req.translatedCurrencies)].map((currencyCode) => ({
        entityCode: code,
        currencyCode,
      })),
    });
    await tx.entityHistoricalRate.createMany({
      data: req.historicalRates.map((r) => ({
        entityCode: code,
        targetCurrency: r.currency,
        rate: r.rate,
        toBeConfirmed: r.toBeConfirmed,
        note: r.note?.trim() || null,
      })),
    });
  }

  /** All business rules for a proposed entity; throws a 400 listing every problem. */
  private async validate(
    code: string,
    req: EntityInput,
    before: EntityRow | null,
    month: string,
  ): Promise<void> {
    const problems: string[] = [];
    const currencies = new Map(
      (await this.prisma.currency.findMany()).map((c) => [c.code, c.isActive]),
    );
    const checkCurrency = (ccy: string, label: string) => {
      if (!currencies.has(ccy)) problems.push(`${label}: ${ccy} is not a known currency.`);
      else if (!currencies.get(ccy)) problems.push(`${label}: ${ccy} is inactive.`);
    };
    checkCurrency(req.functionalCurrency, 'Functional currency');
    checkCurrency(req.reportingCurrency, 'Reporting currency');

    const translated = [...new Set(req.translatedCurrencies)];
    translated.forEach((c) => checkCurrency(c, 'Translated currency'));
    if (translated.includes(req.functionalCurrency)) {
      problems.push(
        `Translated currencies must not include the functional currency (${req.functionalCurrency}).`,
      );
    }

    const rateCurrencies = req.historicalRates.map((r) => r.currency);
    if (new Set(rateCurrencies).size !== rateCurrencies.length) {
      problems.push('Each historical-rate currency can appear only once.');
    }
    for (const r of req.historicalRates) {
      checkCurrency(r.currency, 'Historical rate');
      if (r.currency === req.functionalCurrency) {
        problems.push(
          `A historical rate into the functional currency (${r.currency}) is not needed.`,
        );
      }
      if (!/^\d{1,10}(\.\d{1,10})?$/.test(r.rate) || toDecimal(r.rate).isZero()) {
        problems.push(
          `Historical rate to ${r.currency} must be a positive number with at most 10 decimals (got "${r.rate}").`,
        );
      }
    }

    if (req.heldByParentPct !== null && !/^\d{1,3}(\.\d{1,4})?$/.test(req.heldByParentPct)) {
      problems.push(
        `% held by parent must be a number with at most 4 decimals (got "${req.heldByParentPct}").`,
      );
    }
    if (req.materiality && !/^\d{1,16}(\.\d{1,4})?$/.test(req.materiality)) {
      problems.push(
        `Materiality must be a positive amount with at most 4 decimals (got "${req.materiality}").`,
      );
    }
    if (req.incorporatedOn && !/^\d{4}-\d{2}-\d{2}$/.test(req.incorporatedOn)) {
      problems.push('Date of incorporation or acquisition must be a date.');
    }
    if (req.toBeConfirmed && !req.toBeConfirmedNote?.trim()) {
      problems.push('Add a note explaining what is to be confirmed.');
    }

    // Whole-group rules, on the group as at the month the change applies.
    const rows = (await this.rows()).filter((r) => r.code !== code);
    const proposed: GroupEntity = {
      code,
      name: req.shortName,
      parentCode: req.parentCode,
      heldByParentPct: req.heldByParentPct,
      reportingCurrency: req.reportingCurrency,
      isActive: before ? before.isActive : true,
    };
    for (const issue of validateGroupStructure([...this.structureAt(rows, month), proposed]))
      problems.push(issue.message);

    if (problems.length > 0) throw ApiError.validation([...new Set(problems)].join(' '));
  }
}

function scalarData(req: EntityInput) {
  return {
    legalName: req.legalName.trim(),
    shortName: req.shortName.trim(),
    country: req.country.trim(),
    functionalCurrency: req.functionalCurrency,
    reportingCurrency: req.reportingCurrency,
    erp: req.erp,
    gaap: req.gaap,
    toBeConfirmed: req.toBeConfirmed,
    toBeConfirmedNote: req.toBeConfirmed ? req.toBeConfirmedNote?.trim() || null : null,
    ...(req.materiality !== undefined ? { materiality: req.materiality || null } : {}),
    ...(req.incorporatedOn !== undefined
      ? { incorporatedOn: req.incorporatedOn ? toDbDate(req.incorporatedOn) : null }
      : {}),
  };
}

function toRateEntity(r: EntityRow) {
  return {
    code: r.code,
    functionalCurrency: r.functionalCurrency,
    parentCode: r.parentCode,
    translatedCurrencies: r.translatedCurrencies.map((t) => t.currencyCode),
    historicalRateCurrencies: r.historicalRates.map((h) => h.targetCurrency),
  };
}

/** Audit snapshot: every editable field, decimals as strings. */
function snapshot(r: EntityRow) {
  return {
    legalName: r.legalName,
    shortName: r.shortName,
    country: r.country,
    functionalCurrency: r.functionalCurrency,
    reportingCurrency: r.reportingCurrency,
    translatedCurrencies: r.translatedCurrencies.map((t) => t.currencyCode).sort(),
    parentCode: r.parentCode,
    heldByParentPct: pctText(r.heldByParentPct),
    erp: r.erp,
    gaap: r.gaap,
    isActive: r.isActive,
    toBeConfirmed: r.toBeConfirmed,
    toBeConfirmedNote: r.toBeConfirmedNote,
    materiality: r.materiality?.toString() ?? null,
    incorporatedOn: r.incorporatedOn ? fromDbDate(r.incorporatedOn) : null,
    historicalRates: Object.fromEntries(
      [...r.historicalRates]
        .sort((a, b) => a.targetCurrency.localeCompare(b.targetCurrency))
        .map((h) => [
          h.targetCurrency,
          `${h.rate.toString()}${h.toBeConfirmed ? ' (to be confirmed)' : ''}${h.note ? ` — ${h.note}` : ''}`,
        ]),
    ),
  };
}

function toDto(
  r: EntityRow,
  missing: EntityDto['missingHistoricalRates'],
  extra: {
    effectiveGroupPct: string | null;
    ownershipEffectiveFrom: string | null;
    lockReason: string | null;
  },
): EntityDto {
  return {
    code: r.code,
    legalName: r.legalName,
    shortName: r.shortName,
    country: r.country,
    functionalCurrency: r.functionalCurrency,
    reportingCurrency: r.reportingCurrency,
    translatedCurrencies: r.translatedCurrencies.map((t) => t.currencyCode).sort(),
    parentCode: r.parentCode,
    parentName: r.parent?.shortName ?? null,
    parentLegalName: r.parent?.legalName ?? null,
    heldByParentPct: pctText(r.heldByParentPct),
    effectiveGroupPct: extra.effectiveGroupPct,
    ownershipEffectiveFrom: extra.ownershipEffectiveFrom,
    incorporatedOn: r.incorporatedOn ? fromDbDate(r.incorporatedOn) : null,
    functionalCurrencyLocked: extra.lockReason !== null,
    functionalCurrencyLockReason: extra.lockReason,
    erp: r.erp,
    gaap: r.gaap,
    isActive: r.isActive,
    toBeConfirmed: r.toBeConfirmed,
    toBeConfirmedNote: r.toBeConfirmedNote,
    materiality: r.materiality?.toFixed(2) ?? null,
    sortOrder: r.sortOrder,
    historicalRates: [...r.historicalRates]
      .sort((a, b) => a.targetCurrency.localeCompare(b.targetCurrency))
      .map((h) => ({
        currency: h.targetCurrency,
        rate: h.rate.toString(),
        toBeConfirmed: h.toBeConfirmed,
        note: h.note,
      })),
    missingHistoricalRates: missing,
  };
}
