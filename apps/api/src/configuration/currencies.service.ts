import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  type CreateCurrencyRequest,
  type CurrencyDto,
  type UpdateCurrencyRequest,
} from '@finance-close/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/session-user';
import { ApiError } from '../common/api-error';
import { diffFields } from '../common/audit-diff';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CurrenciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<CurrencyDto[]> {
    const [currencies, usage] = await Promise.all([
      this.prisma.currency.findMany({ orderBy: { code: 'asc' } }),
      this.usage(),
    ]);
    return currencies.map((c) => ({
      code: c.code,
      name: c.name,
      symbol: c.symbol,
      isActive: c.isActive,
      usedBy: [...(usage.get(c.code) ?? [])].sort(),
    }));
  }

  async create(
    actor: AuthUser,
    req: CreateCurrencyRequest,
    ip: string | null,
  ): Promise<CurrencyDto> {
    const code = req.code.trim().toUpperCase();
    if (await this.prisma.currency.findUnique({ where: { code } })) {
      throw ApiError.conflict(`Currency ${code} already exists.`);
    }
    const data = { code, name: req.name.trim(), symbol: req.symbol.trim() };
    await this.prisma.$transaction(async (tx) => {
      await tx.currency.create({ data });
      await this.audit.record(
        {
          userId: actor.id,
          action: AuditAction.CurrencyCreate,
          entityType: 'CURRENCY',
          entityId: code,
          newValue: { ...data, isActive: true },
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
    req: UpdateCurrencyRequest,
    ip: string | null,
  ): Promise<CurrencyDto> {
    const code = codeRaw.toUpperCase();
    const before = await this.find(code);

    if (req.isActive === false && before.isActive) {
      const users = await this.activeEntityUsers(code);
      if (users.length > 0) {
        throw ApiError.notAllowed(
          `${code} is used by active entities (${users.join(', ')}) as a functional, reporting or translated currency. Change those entities first.`,
        );
      }
    }

    const snapshot = (c: { name: string; symbol: string; isActive: boolean }) => ({
      name: c.name,
      symbol: c.symbol,
      isActive: c.isActive,
    });
    await this.prisma.$transaction(async (tx) => {
      const after = await tx.currency.update({
        where: { code },
        data: {
          ...(req.name !== undefined ? { name: req.name.trim() } : {}),
          ...(req.symbol !== undefined ? { symbol: req.symbol.trim() } : {}),
          ...(req.isActive !== undefined ? { isActive: req.isActive } : {}),
        },
      });
      const d = diffFields(snapshot(before), snapshot(after));
      if (d) {
        await this.audit.record(
          {
            userId: actor.id,
            action: AuditAction.CurrencyUpdate,
            entityType: 'CURRENCY',
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

  /** Only a currency nothing refers to can be deleted; otherwise deactivate it. */
  async remove(actor: AuthUser, codeRaw: string, ip: string | null): Promise<void> {
    const code = codeRaw.toUpperCase();
    const before = await this.find(code);
    const usedBy = [...((await this.usage()).get(code) ?? [])];
    if (usedBy.length > 0) {
      throw ApiError.conflict(
        `${code} cannot be deleted because it is used by ${usedBy.sort().join(', ')}. Deactivate it instead.`,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.currency.delete({ where: { code } });
      await this.audit.record(
        {
          userId: actor.id,
          action: AuditAction.CurrencyDelete,
          entityType: 'CURRENCY',
          entityId: code,
          oldValue: { name: before.name, symbol: before.symbol, isActive: before.isActive },
          ip,
        },
        tx,
      );
    });
  }

  private async get(code: string): Promise<CurrencyDto> {
    const found = (await this.list()).find((c) => c.code === code);
    if (!found) throw ApiError.notFound(`Currency ${code} not found.`);
    return found;
  }

  private async find(code: string) {
    const c = await this.prisma.currency.findUnique({ where: { code } });
    if (!c) throw ApiError.notFound(`Currency ${code} not found.`);
    return c;
  }

  /** currency code → entity codes that refer to it anywhere. */
  private async usage(): Promise<Map<string, Set<string>>> {
    const entities = await this.prisma.entity.findMany({
      select: {
        code: true,
        functionalCurrency: true,
        reportingCurrency: true,
        translatedCurrencies: { select: { currencyCode: true } },
        historicalRates: { select: { targetCurrency: true } },
      },
    });
    const map = new Map<string, Set<string>>();
    const add = (ccy: string, entity: string) =>
      map.set(ccy, (map.get(ccy) ?? new Set()).add(entity));
    for (const e of entities) {
      add(e.functionalCurrency, e.code);
      add(e.reportingCurrency, e.code);
      e.translatedCurrencies.forEach((t) => add(t.currencyCode, e.code));
      e.historicalRates.forEach((r) => add(r.targetCurrency, e.code));
    }
    return map;
  }

  private async activeEntityUsers(code: string): Promise<string[]> {
    const rows = await this.prisma.entity.findMany({
      where: {
        isActive: true,
        OR: [
          { functionalCurrency: code },
          { reportingCurrency: code },
          { translatedCurrencies: { some: { currencyCode: code } } },
        ],
      },
      select: { code: true },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map((r) => r.code);
  }
}
