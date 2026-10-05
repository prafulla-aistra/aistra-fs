import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { deriveConsolidationLevels, Decimal, type GroupEntity } from '@finance-close/engine';
import {
  AuditAction,
  Permission,
  type AcquisitionDto,
  type AcquisitionsDto,
  type IntercompanyPairsDto,
} from '@finance-close/shared';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../auth/access-control';
import type { AuthUser } from '../auth/session-user';
import { ApiError } from '../common/api-error';
import { ClientIp } from '../common/client-ip';
import { fromDbDate, toDbDate } from '../common/db-dates';
import { ZodPipe } from '../common/zod.pipe';
import { EditConfig, ViewConfig } from '../configuration/access';
import { PrismaService } from '../prisma/prisma.service';

const code = z.string().regex(/^[A-Z0-9]{1,10}$/, 'Invalid entity code');
const amount = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^-?\d{1,16}(\.\d{1,4})?$/, `${label}: a number with up to 4 decimals`);
const rate = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,10})?$/, 'Rate: a positive number with up to 10 decimals')
  .refine((v) => new Decimal(v).greaterThan(0), 'Rate: must be more than 0');
const pairSchema = z.object({
  entityA: code,
  entityB: code,
  tolerance: amount('Tolerance').refine((v) => !v.startsWith('-'), 'Tolerance: 0 or more'),
  toBeConfirmed: z.boolean(),
  note: z.string().trim().max(300).nullable(),
});
const acquisitionSchema = z.object({
  subsidiaryCode: code,
  parentCode: code,
  acquiredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date: YYYY-MM-DD'),
  pctAcquired: z
    .string()
    .trim()
    .regex(/^\d{1,3}(\.\d{1,4})?$/, '% acquired: a number')
    .refine(
      (v) => new Decimal(v).greaterThan(0) && new Decimal(v).lessThanOrEqualTo(100),
      '% acquired: more than 0 and at most 100',
    ),
  cost: amount('Cost'),
  shareCapital: amount('Share capital'),
  premium: amount('Premium'),
  preAcquisitionReserves: amount('Pre-acquisition reserves'),
  toBeConfirmed: z.boolean(),
  note: z.string().trim().max(500).nullable(),
  rates: z
    .array(z.object({ currency: z.string().regex(/^[A-Z]{3}$/), rate, toBeConfirmed: z.boolean() }))
    .max(20),
});

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Currencies an acquisition needs a rate for: the parent's functional currency and the currency
 * of every consolidation level the subsidiary is in (except its own functional currency).
 */
export async function acquisitionRatesNeeded(
  prisma: PrismaService,
  subsidiaryCode: string,
  parentCode: string,
): Promise<{ currency: string; reasons: string[] }[]> {
  const entities = await prisma.entity.findMany({ include: { levelCurrency: true } });
  const sub = entities.find((e) => e.code === subsidiaryCode);
  const parent = entities.find((e) => e.code === parentCode);
  if (!sub || !parent) return [];
  const group: GroupEntity[] = entities.map((e) => ({
    code: e.code,
    name: e.shortName,
    parentCode: e.parentCode,
    heldByParentPct: e.heldByParentPct?.toString() ?? null,
    reportingCurrency: e.levelCurrency?.currency ?? e.reportingCurrency,
    isActive: e.isActive,
  }));
  let levels: ReturnType<typeof deriveConsolidationLevels> = [];
  try {
    levels = deriveConsolidationLevels(group);
  } catch {
    levels = [];
  }
  const needed = new Map<string, string[]>();
  const need = (c: string, why: string) => {
    if (c === sub.functionalCurrency) return;
    needed.set(c, [...(needed.get(c) ?? []), why]);
  };
  need(parent.functionalCurrency, `parent ${parent.code}'s currency (goodwill)`);
  for (const l of levels)
    if (l.members.includes(subsidiaryCode) && l.members.includes(parentCode))
      need(l.currency, `Level ${l.level} ${l.name} currency`);
  return [...needed]
    .map(([currency, reasons]) => ({ currency, reasons }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/** Configuration → Intercompany pairs and Acquisitions (consolidation). Every change audited. */
@Controller('config')
export class ConsolidationConfigController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ----------------------------------------------------------------- intercompany pairs

  @Get('intercompany-pairs')
  @ViewConfig()
  async pairs(@CurrentUser() user: AuthUser): Promise<IntercompanyPairsDto> {
    const [pairs, entities, accounts] = await Promise.all([
      this.prisma.intercompanyPair.findMany({ orderBy: [{ entityA: 'asc' }, { entityB: 'asc' }] }),
      this.prisma.entity.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.entityAccount.findMany({
        where: { counterpartyCode: { not: null }, fsli: { intercompany: true } },
        select: { entityCode: true, counterpartyCode: true },
      }),
    ]);
    const linked = new Map<string, number>();
    for (const a of accounts) {
      const k = pairKey(a.entityCode, a.counterpartyCode!);
      linked.set(k, (linked.get(k) ?? 0) + 1);
    }
    const marked = new Set(pairs.map((p) => pairKey(p.entityA, p.entityB)));
    return {
      pairs: pairs.map((p) => ({
        id: p.id,
        entityA: p.entityA,
        entityB: p.entityB,
        tolerance: p.tolerance.toFixed(2),
        toBeConfirmed: p.toBeConfirmed,
        note: p.note,
        accountsLinked: linked.get(pairKey(p.entityA, p.entityB)) ?? 0,
      })),
      entities: entities.map((e) => ({ code: e.code, shortName: e.shortName })),
      suggested: [...linked]
        .filter(([k]) => !marked.has(k))
        .map(([k, n]) => {
          const [entityA, entityB] = k.split('|') as [string, string];
          return { entityA, entityB, accounts: n };
        }),
      canEdit: user.permissions.has(Permission.ConfigManage),
    };
  }

  @Put('intercompany-pairs')
  @EditConfig()
  async savePair(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(pairSchema)) body: z.output<typeof pairSchema>,
    @ClientIp() ip: string | null,
  ): Promise<IntercompanyPairsDto> {
    if (body.entityA === body.entityB) throw ApiError.validation('Choose two different entities.');
    const [a, b] = [body.entityA, body.entityB].sort() as [string, string];
    const found = await this.prisma.entity.count({ where: { code: { in: [a, b] } } });
    if (found !== 2) throw ApiError.notFound('Entity not found.');
    const before = await this.prisma.intercompanyPair.findUnique({
      where: { entityA_entityB: { entityA: a, entityB: b } },
    });
    const data = {
      tolerance: new Decimal(body.tolerance).toFixed(4),
      toBeConfirmed: body.toBeConfirmed,
      note: body.note || null,
      updatedById: user.id,
    };
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.intercompanyPair.upsert({
        where: { entityA_entityB: { entityA: a, entityB: b } },
        create: { entityA: a, entityB: b, ...data },
        update: data,
      });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.IntercompanyPairChange,
          entityType: 'INTERCOMPANY_PAIR',
          entityId: row.id,
          oldValue: before
            ? {
                pair: `${a}–${b}`,
                tolerance: before.tolerance.toFixed(2),
                toBeConfirmed: before.toBeConfirmed,
                note: before.note,
              }
            : null,
          newValue: {
            pair: `${a}–${b}`,
            tolerance: new Decimal(body.tolerance).toFixed(2),
            toBeConfirmed: body.toBeConfirmed,
            note: data.note,
          },
          ip,
        },
        tx,
      );
    });
    return this.pairs(user);
  }

  @Delete('intercompany-pairs/:id')
  @EditConfig()
  @HttpCode(204)
  async removePair(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientIp() ip: string | null,
  ): Promise<void> {
    const before = await this.prisma.intercompanyPair.findUnique({ where: { id } });
    if (!before) throw ApiError.notFound('Intercompany pair not found.');
    await this.prisma.$transaction(async (tx) => {
      await tx.intercompanyPair.delete({ where: { id } });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.IntercompanyPairChange,
          entityType: 'INTERCOMPANY_PAIR',
          entityId: id,
          oldValue: {
            pair: `${before.entityA}–${before.entityB}`,
            tolerance: before.tolerance.toFixed(2),
          },
          newValue: null,
          ip,
        },
        tx,
      );
    });
  }

  // ----------------------------------------------------------------- acquisitions register

  @Get('acquisitions')
  @ViewConfig()
  async acquisitions(@CurrentUser() user: AuthUser): Promise<AcquisitionsDto> {
    const [rows, entities] = await Promise.all([
      this.prisma.acquisition.findMany({
        include: { rates: true },
        orderBy: [{ subsidiaryCode: 'asc' }, { acquiredOn: 'asc' }],
      }),
      this.prisma.entity.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    ]);
    const byCode = new Map(entities.map((e) => [e.code, e]));
    const out: AcquisitionDto[] = [];
    for (const r of rows) {
      const sub = byCode.get(r.subsidiaryCode);
      const parent = byCode.get(r.parentCode);
      const needed = await acquisitionRatesNeeded(this.prisma, r.subsidiaryCode, r.parentCode);
      const have = new Set(r.rates.map((x) => x.currency));
      out.push({
        id: r.id,
        subsidiaryCode: r.subsidiaryCode,
        subsidiaryName: sub?.shortName ?? r.subsidiaryCode,
        subsidiaryCurrency: sub?.functionalCurrency ?? '',
        parentCode: r.parentCode,
        parentCurrency: parent?.functionalCurrency ?? '',
        acquiredOn: fromDbDate(r.acquiredOn),
        pctAcquired: r.pctAcquired.toDecimalPlaces(4).toString(),
        cost: r.cost.toFixed(2),
        shareCapital: r.shareCapital.toFixed(2),
        premium: r.premium.toFixed(2),
        preAcquisitionReserves: r.preAcquisitionReserves.toFixed(2),
        toBeConfirmed: r.toBeConfirmed,
        note: r.note,
        rates: r.rates
          .map((x) => ({
            currency: x.currency,
            rate: x.rate.toFixed(10),
            toBeConfirmed: x.toBeConfirmed,
          }))
          .sort((a, b) => a.currency.localeCompare(b.currency)),
        ratesNeeded: needed.map((n) => ({ ...n, present: have.has(n.currency) })),
      });
    }
    const withRow = new Set(rows.map((r) => r.subsidiaryCode));
    return {
      acquisitions: out,
      missing: entities
        .filter((e) => e.parentCode && !withRow.has(e.code))
        .map((e) => ({ code: e.code, shortName: e.shortName, parentCode: e.parentCode! })),
      entities: entities.map((e) => ({
        code: e.code,
        shortName: e.shortName,
        functionalCurrency: e.functionalCurrency,
        parentCode: e.parentCode,
      })),
      canEdit: user.permissions.has(Permission.ConfigManage),
    };
  }

  @Post('acquisitions')
  @EditConfig()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(acquisitionSchema)) body: z.output<typeof acquisitionSchema>,
    @ClientIp() ip: string | null,
  ): Promise<AcquisitionsDto> {
    return this.save(user, null, body, ip);
  }

  @Put('acquisitions/:id')
  @EditConfig()
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(acquisitionSchema)) body: z.output<typeof acquisitionSchema>,
    @ClientIp() ip: string | null,
  ): Promise<AcquisitionsDto> {
    return this.save(user, id, body, ip);
  }

  @Delete('acquisitions/:id')
  @EditConfig()
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientIp() ip: string | null,
  ): Promise<void> {
    const before = await this.prisma.acquisition.findUnique({
      where: { id },
      include: { rates: true },
    });
    if (!before) throw ApiError.notFound('Acquisition not found.');
    await this.prisma.$transaction(async (tx) => {
      await tx.acquisition.delete({ where: { id } });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.AcquisitionChange,
          entityType: 'ACQUISITION',
          entityId: id,
          oldValue: snapshot(before),
          newValue: null,
          ip,
        },
        tx,
      );
    });
  }

  private async save(
    user: AuthUser,
    id: string | null,
    body: z.output<typeof acquisitionSchema>,
    ip: string | null,
  ): Promise<AcquisitionsDto> {
    const sub = await this.prisma.entity.findUnique({ where: { code: body.subsidiaryCode } });
    if (!sub) throw ApiError.notFound(`Entity ${body.subsidiaryCode} not found.`);
    if (!(await this.prisma.entity.findUnique({ where: { code: body.parentCode } })))
      throw ApiError.notFound(`Entity ${body.parentCode} not found.`);
    if (body.subsidiaryCode === body.parentCode)
      throw ApiError.validation('The subsidiary and the parent must differ.');
    const currencies = body.rates.map((r) => r.currency);
    if (new Set(currencies).size !== currencies.length)
      throw ApiError.validation('Enter each currency once.');
    if (currencies.includes(sub.functionalCurrency))
      throw ApiError.validation(
        `No rate is needed into ${sub.functionalCurrency} (the subsidiary's own currency).`,
      );
    const before = id
      ? await this.prisma.acquisition.findUnique({ where: { id }, include: { rates: true } })
      : null;
    if (id && !before) throw ApiError.notFound('Acquisition not found.');
    const data = {
      subsidiaryCode: body.subsidiaryCode,
      parentCode: body.parentCode,
      acquiredOn: toDbDate(body.acquiredOn),
      pctAcquired: body.pctAcquired,
      cost: body.cost,
      shareCapital: body.shareCapital,
      premium: body.premium,
      preAcquisitionReserves: body.preAcquisitionReserves,
      toBeConfirmed: body.toBeConfirmed,
      note: body.note || null,
      updatedById: user.id,
    };
    await this.prisma.$transaction(async (tx) => {
      const row = id
        ? await tx.acquisition.update({ where: { id }, data })
        : await tx.acquisition.create({ data });
      await tx.acquisitionRate.deleteMany({ where: { acquisitionId: row.id } });
      if (body.rates.length)
        await tx.acquisitionRate.createMany({
          data: body.rates.map((r) => ({
            acquisitionId: row.id,
            currency: r.currency,
            rate: r.rate,
            toBeConfirmed: r.toBeConfirmed,
          })),
        });
      const after = await tx.acquisition.findUniqueOrThrow({
        where: { id: row.id },
        include: { rates: true },
      });
      await this.audit.record(
        {
          userId: user.id,
          action: AuditAction.AcquisitionChange,
          entityType: 'ACQUISITION',
          entityId: row.id,
          oldValue: before ? snapshot(before) : null,
          newValue: snapshot(after),
          ip,
        },
        tx,
      );
    });
    return this.acquisitions(user);
  }
}

type AcquisitionRow = Awaited<ReturnType<PrismaService['acquisition']['findUniqueOrThrow']>> & {
  rates: { currency: string; rate: { toFixed: (n: number) => string }; toBeConfirmed: boolean }[];
};
function snapshot(a: AcquisitionRow) {
  return {
    subsidiary: a.subsidiaryCode,
    parent: a.parentCode,
    acquiredOn: fromDbDate(a.acquiredOn),
    pctAcquired: a.pctAcquired.toString(),
    cost: a.cost.toFixed(2),
    shareCapital: a.shareCapital.toFixed(2),
    premium: a.premium.toFixed(2),
    preAcquisitionReserves: a.preAcquisitionReserves.toFixed(2),
    toBeConfirmed: a.toBeConfirmed,
    note: a.note,
    rates: a.rates.map(
      (r) => `${r.currency} ${r.rate.toFixed(10)}${r.toBeConfirmed ? ' (TBC)' : ''}`,
    ),
  };
}
