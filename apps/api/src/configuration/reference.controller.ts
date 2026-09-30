import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Put } from '@nestjs/common';
import type {
  AccountTypeDefaultDto,
  AppSettingsDto,
  ExchangeRateRowDto,
  FormatDto,
  FsliDto,
} from '@finance-close/shared';
import { Decimal } from '@finance-close/engine';
import { z } from 'zod';
import { CurrentUser } from '../auth/access-control';
import type { AuthUser } from '../auth/session-user';
import { ClientIp } from '../common/client-ip';
import { ZodPipe } from '../common/zod.pipe';
import { fromDbDate } from '../common/db-dates';
import { PrismaService } from '../prisma/prisma.service';
import { EditConfig, ViewConfig } from './access';
import { ReferenceService } from './reference.service';

const decimal = (max: string, label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{1,12}(\.\d{1,4})?$/, `${label} must be a number with at most 4 decimals`)
    .refine(
      (v) => !/^\d{1,12}(\.\d{1,4})?$/.test(v) || new Decimal(v).lte(max),
      `${label} must be at most ${max}`,
    );
const settingsSchema = z.object({
  rateSource: z.string().trim().max(200),
  icDiffThreshold: decimal('1000000', 'The IC difference threshold'),
  variancePct: decimal('1000', 'The variance threshold').refine(
    (v) => !/^[0-9.]+$/.test(v) || new Decimal(v).gt(0),
    'The variance threshold must be above 0',
  ),
});
const fsliCode = z.string().regex(/^[A-Z0-9_]{1,30}$/, 'Invalid FSLI code');
const erp = z.enum(['ZOHO', 'XERO', 'OTHER']);
const defaultSchema = z.object({
  erp,
  accountType: z.string().trim().min(1, 'Enter the account type').max(60),
  fsliCode,
});

/** Reference lists and their maintenance: settings, FSLI names, account-type defaults. */
@Controller('config')
export class ReferenceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reference: ReferenceService,
  ) {}

  @Get('settings')
  @ViewConfig()
  settings(@CurrentUser() user: AuthUser): Promise<AppSettingsDto> {
    return this.reference.settings(user);
  }

  @Put('settings')
  @EditConfig()
  saveSettings(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(settingsSchema)) body: z.output<typeof settingsSchema>,
    @ClientIp() ip: string | null,
  ): Promise<AppSettingsDto> {
    return this.reference.saveSettings(user, body, ip);
  }

  @Patch('fslis/:code')
  @EditConfig()
  @HttpCode(204)
  renameFsli(
    @CurrentUser() user: AuthUser,
    @Param('code', new ZodPipe(fsliCode)) code: string,
    @Body(new ZodPipe(z.object({ name: z.string().trim().min(1, 'Enter a name').max(120) })))
    body: { name: string },
    @ClientIp() ip: string | null,
  ): Promise<void> {
    return this.reference.renameFsli(user, code, body.name, ip);
  }

  @Put('account-type-defaults')
  @EditConfig()
  setDefault(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(defaultSchema)) body: z.output<typeof defaultSchema>,
    @ClientIp() ip: string | null,
  ): Promise<AccountTypeDefaultDto> {
    return this.reference.setDefault(user, body, ip);
  }

  @Delete('account-type-defaults/:erp/:accountType')
  @EditConfig()
  @HttpCode(204)
  deleteDefault(
    @CurrentUser() user: AuthUser,
    @Param('erp', new ZodPipe(erp)) erpCode: string,
    @Param('accountType', new ZodPipe(z.string().min(1).max(60))) accountType: string,
    @ClientIp() ip: string | null,
  ): Promise<void> {
    return this.reference.deleteDefault(user, erpCode, accountType, ip);
  }

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
      currentVersion: f.currentVersion,
      sortOrder: f.sortOrder,
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
