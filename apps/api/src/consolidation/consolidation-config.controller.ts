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
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ACQUISITION_COLUMNS,
  deriveConsolidationLevels,
  Decimal,
  type GroupEntity,
  parseAcquisitionTemplate,
} from '@finance-close/engine';
import {
  AuditAction,
  MAX_UPLOAD_BYTES,
  Permission,
  type AcquisitionDto,
  type AcquisitionsDto,
  type AcquisitionUploadPreviewDto,
  type AcquisitionUploadRowDto,
  type IntercompanyPairsDto,
} from '@finance-close/shared';
import ExcelJS from 'exceljs';
import type { Response } from 'express';
import { z } from 'zod';
import type { UploadedBlob } from '../uploads/upload-step.service';
import { readSheetRows } from '../uploads/sheets';
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
  nciMeasurement: z.enum(['PROPORTIONATE', 'FAIR_VALUE']).nullable().default(null),
  nciFairValue: amount('NCI fair value')
    .refine((v) => !v.startsWith('-'), 'NCI fair value: 0 or more')
    .nullable()
    .default(null),
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
    preparesConsolidation: e.preparesConsolidation,
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
        nciMeasurement: (r.nciMeasurement as AcquisitionDto['nciMeasurement']) ?? null,
        nciFairValue: r.nciFairValue?.toFixed(2) ?? null,
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
    const problems = await this.problemsFor(body);
    if (problems.length) {
      if (problems[0]!.startsWith('Entity ')) throw ApiError.notFound(problems[0]!);
      throw ApiError.validation(problems[0]!);
    }
    const before = id
      ? await this.prisma.acquisition.findUnique({ where: { id }, include: { rates: true } })
      : null;
    if (id && !before) throw ApiError.notFound('Acquisition not found.');
    await this.prisma.$transaction((tx) => this.write(tx, user, id, before, body, ip));
    return this.acquisitions(user);
  }

  /** Checks against the group (the schema checks each value). */
  private async problemsFor(body: z.output<typeof acquisitionSchema>): Promise<string[]> {
    const out: string[] = [];
    const sub = await this.prisma.entity.findUnique({ where: { code: body.subsidiaryCode } });
    if (!sub) out.push(`Entity ${body.subsidiaryCode} not found.`);
    if (!(await this.prisma.entity.findUnique({ where: { code: body.parentCode } })))
      out.push(`Entity ${body.parentCode} not found.`);
    if (body.subsidiaryCode === body.parentCode)
      out.push('The subsidiary and the parent must differ.');
    const currencies = body.rates.map((r) => r.currency);
    if (new Set(currencies).size !== currencies.length) out.push('Enter each currency once.');
    if (sub && currencies.includes(sub.functionalCurrency))
      out.push(`No rate is needed into ${sub.functionalCurrency} (the subsidiary's own currency).`);
    if (
      body.nciMeasurement === 'FAIR_VALUE' &&
      body.nciFairValue === null &&
      new Decimal(body.pctAcquired).lessThan(100)
    )
      out.push('Enter the NCI fair value at the acquisition date (NCI measured at fair value).');
    return out;
  }

  private async write(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    user: AuthUser,
    id: string | null,
    before: AcquisitionRow | null,
    body: z.output<typeof acquisitionSchema>,
    ip: string | null,
  ): Promise<void> {
    const data = {
      subsidiaryCode: body.subsidiaryCode,
      parentCode: body.parentCode,
      acquiredOn: toDbDate(body.acquiredOn),
      pctAcquired: body.pctAcquired,
      cost: body.cost,
      shareCapital: body.shareCapital,
      premium: body.premium,
      preAcquisitionReserves: body.preAcquisitionReserves,
      nciMeasurement: body.nciMeasurement,
      nciFairValue: body.nciFairValue,
      toBeConfirmed: body.toBeConfirmed,
      note: body.note || null,
      updatedById: user.id,
    };
    {
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
    }
  }

  // ------------------------------------------------- acquisitions template (round 1, Q3)

  /** Currencies for the template's rate columns: functional and level currencies. */
  private async templateCurrencies(): Promise<string[]> {
    const entities = await this.prisma.entity.findMany({ include: { levelCurrency: true } });
    return [
      ...new Set(
        entities.flatMap((e) => [
          e.functionalCurrency,
          e.levelCurrency?.currency ?? e.reportingCurrency,
        ]),
      ),
    ]
      .filter(Boolean)
      .sort();
  }

  @Get('acquisitions/template')
  @ViewConfig()
  async template(@Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const currencies = await this.templateCurrencies();
    const rows = await this.prisma.acquisition.findMany({
      include: { rates: true },
      orderBy: [{ subsidiaryCode: 'asc' }, { acquiredOn: 'asc' }],
    });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Acquisitions');
    const header = [...ACQUISITION_COLUMNS, ...currencies.map((c) => `Rate ${c}`)];
    ws.addRow(header).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    for (const r of rows)
      ws.addRow([
        r.subsidiaryCode,
        r.parentCode,
        fromDbDate(r.acquiredOn),
        Number(r.pctAcquired.toString()),
        Number(r.cost.toFixed(2)),
        Number(r.shareCapital.toFixed(2)),
        Number(r.premium.toFixed(2)),
        Number(r.preAcquisitionReserves.toFixed(2)),
        r.nciMeasurement === 'FAIR_VALUE'
          ? 'Fair value'
          : r.nciMeasurement === 'PROPORTIONATE'
            ? 'Proportionate'
            : '',
        r.nciFairValue ? Number(r.nciFairValue.toFixed(2)) : null,
        r.toBeConfirmed ? 'Y' : 'N',
        r.rates.some((x) => x.toBeConfirmed) ? 'Y' : 'N',
        r.note ?? '',
        ...currencies.map((c) => {
          const x = r.rates.find((y) => y.currency === c);
          return x ? Number(x.rate.toFixed(10)) : null;
        }),
      ]);
    ws.columns.forEach((c, i) => {
      c.width = i < 2 ? 12 : i === 12 ? 40 : 16;
      if (i === 2) c.numFmt = '@';
    });
    const help = wb.addWorksheet('Instructions');
    for (const line of [
      'One row per acquisition (step). Existing rows are matched on Subsidiary + Parent + Acquired on and updated; other rows are added. Rows not in the file are kept.',
      'Subsidiary / Parent: entity codes. Acquired on: YYYY-MM-DD. % acquired: e.g. 58.49.',
      "Amounts in the subsidiary's functional currency. Pre-acquisition reserves may be negative.",
      'NCI measurement: Proportionate, Fair value, or blank (default by the consolidating parent’s GAAP: US GAAP fair value, otherwise proportionate — to be confirmed).',
      'NCI fair value: required for Fair value when less than 100% is held (subsidiary currency, at the acquisition date).',
      'To be confirmed / Rates to be confirmed: Y or N (blank = Y).',
      "Rate <CCY>: 1 unit of the subsidiary's currency = rate units of CCY at the acquisition date; blank = no rate.",
      'Upload the filled file under Configuration → Acquisitions → Upload filled template: you see a preview and confirm before anything is saved.',
    ])
      help.addRow([line]);
    help.getColumn(1).width = 140;
    const body = Buffer.from(await wb.xlsx.writeBuffer());
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent('acquisitions-template.xlsx')}`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(body);
  }

  /** Preview (default) or save (confirm=true) a filled template; nothing saves with any error. */
  @Post('acquisitions/upload')
  @EditConfig()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  async upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedBlob | undefined,
    @Query('confirm') confirm: string | undefined,
    @ClientIp() ip: string | null,
  ): Promise<AcquisitionUploadPreviewDto> {
    if (!file) throw ApiError.validation('Choose the filled acquisitions template to upload.');
    if (!/\.(xlsx|xls|csv)$/i.test(file.originalname))
      throw ApiError.validation('Upload an Excel (.xlsx, .xls) or CSV file.');
    let cells;
    try {
      cells = readSheetRows(file.buffer, file.originalname);
    } catch {
      throw ApiError.validation('The file could not be read as a spreadsheet.');
    }
    const parsed = parseAcquisitionTemplate(cells);
    const existing = await this.prisma.acquisition.findMany({ include: { rates: true } });
    const rows: AcquisitionUploadRowDto[] = [];
    const toSave: {
      id: string | null;
      before: AcquisitionRow | null;
      body: z.output<typeof acquisitionSchema>;
    }[] = [];
    for (const p of parsed.rows) {
      const problems = [...p.problems];
      const input = {
        subsidiaryCode: p.subsidiaryCode,
        parentCode: p.parentCode,
        acquiredOn: p.acquiredOn,
        pctAcquired: p.pctAcquired,
        cost: p.cost,
        shareCapital: p.shareCapital,
        premium: p.premium,
        preAcquisitionReserves: p.preAcquisitionReserves,
        nciMeasurement: p.nciMeasurement,
        nciFairValue: p.nciFairValue,
        toBeConfirmed: p.toBeConfirmed,
        note: p.note,
        rates: p.rates.map((r) => ({ ...r, toBeConfirmed: p.ratesToBeConfirmed })),
      };
      let body: z.output<typeof acquisitionSchema> | null = null;
      if (problems.length === 0) {
        const z1 = acquisitionSchema.safeParse(input);
        if (!z1.success) problems.push(...z1.error.issues.map((i) => i.message));
        else {
          body = z1.data;
          problems.push(...(await this.problemsFor(body)));
        }
      }
      const match = existing.find(
        (e) =>
          e.subsidiaryCode === p.subsidiaryCode &&
          e.parentCode === p.parentCode &&
          fromDbDate(e.acquiredOn) === p.acquiredOn,
      );
      const same =
        match && body
          ? JSON.stringify(snapshot(match)) === JSON.stringify(snapshotOf(body, match))
          : false;
      rows.push({
        row: p.row,
        action: problems.length ? 'ERROR' : !match ? 'CREATE' : same ? 'UNCHANGED' : 'UPDATE',
        subsidiaryCode: p.subsidiaryCode,
        parentCode: p.parentCode,
        acquiredOn: p.acquiredOn,
        pctAcquired: p.pctAcquired,
        cost: p.cost,
        nciMeasurement: p.nciMeasurement,
        nciFairValue: p.nciFairValue,
        rates: p.rates.map((r) => `${r.currency} ${r.rate}`),
        problems,
      });
      if (body && !problems.length && !same)
        toSave.push({ id: match?.id ?? null, before: match ?? null, body });
    }
    const canSave =
      parsed.problems.length === 0 && rows.length > 0 && rows.every((r) => r.action !== 'ERROR');
    let saved = false;
    if (confirm === 'true') {
      if (!canSave) throw ApiError.validation('Fix the errors in the file before saving.');
      await this.prisma.$transaction(async (tx) => {
        for (const x of toSave) await this.write(tx, user, x.id, x.before, x.body, ip);
      });
      saved = true;
    }
    return { fileName: file.originalname, rows, problems: parsed.problems, canSave, saved };
  }
}

type AcquisitionRow = Awaited<ReturnType<PrismaService['acquisition']['findUniqueOrThrow']>> & {
  rates: { currency: string; rate: { toFixed: (n: number) => string }; toBeConfirmed: boolean }[];
};
/** The snapshot an upload row would leave (to tell UNCHANGED rows apart). */
function snapshotOf(body: z.output<typeof acquisitionSchema>, match: AcquisitionRow) {
  return snapshot({
    ...match,
    acquiredOn: toDbDate(body.acquiredOn),
    pctAcquired: new Decimal(body.pctAcquired) as never,
    cost: new Decimal(body.cost) as never,
    shareCapital: new Decimal(body.shareCapital) as never,
    premium: new Decimal(body.premium) as never,
    preAcquisitionReserves: new Decimal(body.preAcquisitionReserves) as never,
    nciMeasurement: body.nciMeasurement,
    nciFairValue: body.nciFairValue === null ? null : (new Decimal(body.nciFairValue) as never),
    toBeConfirmed: body.toBeConfirmed,
    note: body.note || null,
    rates: body.rates
      .map((r) => ({
        currency: r.currency,
        rate: new Decimal(r.rate),
        toBeConfirmed: r.toBeConfirmed,
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
  });
}

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
    nciMeasurement: a.nciMeasurement,
    nciFairValue: a.nciFairValue?.toFixed(2) ?? null,
    toBeConfirmed: a.toBeConfirmed,
    note: a.note,
    rates: [...a.rates]
      .sort((x, y) => x.currency.localeCompare(y.currency))
      .map((r) => `${r.currency} ${r.rate.toFixed(10)}${r.toBeConfirmed ? ' (TBC)' : ''}`),
  };
}
