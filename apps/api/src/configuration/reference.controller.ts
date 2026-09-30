import { Controller, Get } from '@nestjs/common';
import type {
  AccountTypeDefaultDto,
  ExchangeRateRowDto,
  FormatDto,
  FsliDto,
} from '@finance-close/shared';
import { fromDbDate } from '../common/db-dates';
import { PrismaService } from '../prisma/prisma.service';
import { ViewConfig } from './access';

/** Read-only reference lists for the Configuration pages (maintenance screens come later). */
@Controller('config')
export class ReferenceController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('fslis')
  @ViewConfig()
  async fslis(): Promise<FsliDto[]> {
    const [rows, counts] = await Promise.all([
      this.prisma.fsli.findMany({ orderBy: { sortOrder: 'asc' } }),
      this.prisma.entityAccount.groupBy({ by: ['fsliCode'], _count: true }),
    ]);
    const n = new Map(counts.map((c) => [c.fsliCode, c._count]));
    return rows.map((f) => ({
      code: f.code,
      name: f.name,
      statement: f.statement,
      class: f.class,
      rateBasis: f.rateBasis,
      consolidationOnly: f.consolidationOnly,
      needsCounterparty: f.needsCounterparty,
      intercompany: f.intercompany,
      computed: f.computed,
      accounts: n.get(f.code) ?? 0,
    }));
  }

  @Get('account-type-defaults')
  @ViewConfig()
  async accountTypeDefaults(): Promise<AccountTypeDefaultDto[]> {
    const rows = await this.prisma.accountTypeDefault.findMany({
      include: { fsli: { select: { name: true } } },
      orderBy: [{ erp: 'asc' }, { accountType: 'asc' }],
    });
    return rows.map((r) => ({
      erp: r.erp,
      accountType: r.accountType,
      fsliCode: r.fsliCode,
      fsliName: r.fsli.name,
    }));
  }

  @Get('formats')
  @ViewConfig()
  async formats(): Promise<FormatDto[]> {
    const rows = await this.prisma.format.findMany({
      include: { _count: { select: { tasks: true } } },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map((f) => ({
      code: f.code,
      name: f.name,
      description: f.description,
      isActive: f.isActive,
      tasks: f._count.tasks,
    }));
  }

  @Get('exchange-rates')
  @ViewConfig()
  async exchangeRates(): Promise<ExchangeRateRowDto[]> {
    const rows = await this.prisma.exchangeRate.findMany({
      include: { enteredBy: { select: { name: true } } },
      orderBy: [{ month: 'desc' }, { currencyCode: 'asc' }],
    });
    return rows.map((r) => ({
      month: fromDbDate(r.month),
      currency: r.currencyCode,
      opening: r.opening?.toString() ?? null,
      closing: r.closing?.toString() ?? null,
      average: r.average?.toString() ?? null,
      source: r.source,
      enteredBy: r.enteredBy?.name ?? null,
      enteredAt: r.enteredAt.toISOString(),
    }));
  }
}
