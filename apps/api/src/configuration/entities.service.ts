import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  deriveConsolidationLevels,
  type ConsolidationLevel,
  type GroupEntity,
  missingHistoricalRates,
  toDecimal,
  validateGroupStructure,
} from '@finance-close/engine';
import {
  AuditAction,
  type ConsolidationLevelDto,
  type CreateEntityRequest,
  type EntityDto,
  type EntityInput,
  type GroupStructureDto,
  type GroupTreeNode,
  type UpdateEntityRequest,
} from '@finance-close/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/session-user';
import { ApiError } from '../common/api-error';
import { diffFields } from '../common/audit-diff';
import { PrismaService } from '../prisma/prisma.service';

const include = {
  translatedCurrencies: { select: { currencyCode: true } },
  historicalRates: true,
  parent: { select: { shortName: true } },
} satisfies Prisma.EntityInclude;
type EntityRow = Prisma.EntityGetPayload<{ include: typeof include }>;

@Injectable()
export class EntitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- queries

  async list(): Promise<EntityDto[]> {
    const rows = await this.rows();
    const levels = safeLevels(rows.map(toGroupEntity));
    const rateEntities = rows.map(toRateEntity);
    return rows.map((r) => toDto(r, missingHistoricalRates(toRateEntity(r), rateEntities, levels)));
  }

  async get(code: string): Promise<EntityDto> {
    const found = (await this.list()).find((e) => e.code === code.toUpperCase());
    if (!found) throw ApiError.notFound(`Entity ${code} not found.`);
    return found;
  }

  async groupStructure(): Promise<GroupStructureDto> {
    const rows = await this.rows();
    const groupEntities = rows.map(toGroupEntity);
    const issues = validateGroupStructure(groupEntities);
    if (issues.length > 0) return { tree: null, levels: [], issues };

    const active = rows.filter((r) => r.isActive);
    const byCode = new Map(active.map((r) => [r.code, r]));
    const build = (r: EntityRow): GroupTreeNode => ({
      code: r.code,
      shortName: r.shortName,
      legalName: r.legalName,
      functionalCurrency: r.functionalCurrency,
      reportingCurrency: r.reportingCurrency,
      heldByParentPct: r.heldByParentPct?.toString() ?? null,
      toBeConfirmed: r.toBeConfirmed,
      children: active.filter((c) => c.parentCode === r.code).map(build),
    });
    const root = active.find((r) => r.parentCode === null);
    const levels = deriveConsolidationLevels(groupEntities).map((l): ConsolidationLevelDto => ({
      level: l.level,
      name: l.name,
      parentCode: l.parentCode,
      currency: l.currency,
      members: l.members.map((code) => ({ code, shortName: byCode.get(code)?.shortName ?? code })),
    }));
    return { tree: root ? build(root) : null, levels, issues: [] };
  }

  // ---------------------------------------------------------------- commands

  async create(actor: AuthUser, req: CreateEntityRequest, ip: string | null): Promise<EntityDto> {
    const code = req.code.trim().toUpperCase();
    if (await this.prisma.entity.findUnique({ where: { code } })) {
      throw ApiError.conflict(`An entity with code ${code} already exists.`);
    }
    await this.validate(code, req, null);
    const maxSort = await this.prisma.entity.aggregate({ _max: { sortOrder: true } });

    await this.prisma.$transaction(async (tx) => {
      await tx.entity.create({
        data: { code, ...scalarData(req), sortOrder: (maxSort._max.sortOrder ?? 0) + 1 },
      });
      await this.writeCurrencies(tx, code, req);
      const after = await tx.entity.findUniqueOrThrow({ where: { code }, include });
      await this.audit.record(
        {
          userId: actor.id,
          action: AuditAction.EntityCreate,
          entityType: 'ENTITY',
          entityId: code,
          newValue: snapshot(after),
          ip,
        },
        tx,
      );
    });
    return this.get(code);
  }

  async update(
    actor: AuthUser,
    codeRaw: string,
    req: UpdateEntityRequest,
    ip: string | null,
  ): Promise<EntityDto> {
    const code = codeRaw.toUpperCase();
    const before = await this.prisma.entity.findUnique({ where: { code }, include });
    if (!before) throw ApiError.notFound(`Entity ${code} not found.`);
    await this.validate(code, req, before);

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
            ...d,
            ip,
          },
          tx,
        );
      }
    });
    return this.get(code);
  }

  // ---------------------------------------------------------------- helpers

  private rows(): Promise<EntityRow[]> {
    return this.prisma.entity.findMany({
      include,
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
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
  private async validate(code: string, req: EntityInput, before: EntityRow | null): Promise<void> {
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
    if (req.toBeConfirmed && !req.toBeConfirmedNote?.trim()) {
      problems.push('Add a note explaining what is to be confirmed.');
    }

    // Whole-group rules, checked on the group as it would be after this change.
    const others = (await this.rows()).filter((r) => r.code !== code).map(toGroupEntity);
    const proposed: GroupEntity = {
      code,
      name: req.shortName,
      parentCode: req.parentCode,
      heldByParentPct: req.heldByParentPct,
      reportingCurrency: req.reportingCurrency,
      isActive: req.isActive,
    };
    for (const issue of validateGroupStructure([...others, proposed])) problems.push(issue.message);
    if (before?.isActive && !req.isActive) {
      const activeChildren = others.filter((o) => o.parentCode === code && o.isActive !== false);
      if (activeChildren.length > 0) {
        problems.push(
          `${code} cannot be deactivated while it has active subsidiaries (${activeChildren.map((c) => c.code).join(', ')}).`,
        );
      }
    }

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
    parentCode: req.parentCode,
    heldByParentPct: req.heldByParentPct,
    erp: req.erp,
    gaap: req.gaap,
    isActive: req.isActive,
    toBeConfirmed: req.toBeConfirmed,
    toBeConfirmedNote: req.toBeConfirmed ? req.toBeConfirmedNote?.trim() || null : null,
    ...(req.materiality !== undefined ? { materiality: req.materiality || null } : {}),
  };
}

function toGroupEntity(r: EntityRow): GroupEntity {
  return {
    code: r.code,
    name: r.shortName,
    parentCode: r.parentCode,
    heldByParentPct: r.heldByParentPct?.toString() ?? null,
    reportingCurrency: r.reportingCurrency,
    isActive: r.isActive,
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

/** Levels if the structure is valid; none otherwise (the issues are shown elsewhere). */
function safeLevels(entities: GroupEntity[]): ConsolidationLevel[] {
  return validateGroupStructure(entities).length === 0 ? deriveConsolidationLevels(entities) : [];
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
    heldByParentPct: r.heldByParentPct?.toString() ?? null,
    erp: r.erp,
    gaap: r.gaap,
    isActive: r.isActive,
    toBeConfirmed: r.toBeConfirmed,
    toBeConfirmedNote: r.toBeConfirmedNote,
    materiality: r.materiality?.toString() ?? null,
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

function toDto(r: EntityRow, missing: EntityDto['missingHistoricalRates']): EntityDto {
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
    heldByParentPct: r.heldByParentPct?.toString() ?? null,
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
    missingHistoricalRates: r.isActive ? missing : [],
  };
}
