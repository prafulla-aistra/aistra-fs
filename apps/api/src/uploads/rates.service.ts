import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  checkRates,
  type IsoDate,
  monthLabel,
  monthsBetween,
  type MonthlyRate,
  parseRateSheet,
  priorMonth,
  toDecimal,
  validRate,
} from '@finance-close/engine';
import {
  ApiErrorCode,
  AuditAction,
  PERIOD_AVERAGE_ASSUMPTION,
  Permission,
  type RateInputDto,
  type RateSaveResultDto,
  type RatesPanelDto,
} from '@finance-close/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/session-user';
import { ApiError } from '../common/api-error';
import { fromDbDate, toDbDate } from '../common/db-dates';
import { PrismaService } from '../prisma/prisma.service';
import { rateSourceLabel } from '../common/settings';
import { StorageService } from '../storage/storage.service';
import { fileRef } from './file-ref';
import { storeUpload } from './stored-files';
import { readSheetRows } from './sheets';

type Db = Prisma.TransactionClient | PrismaService;
type Field = 'opening' | 'closing' | 'average';
const FIELDS: Field[] = ['opening', 'closing', 'average'];

/** May enter or upload group exchange rates. */
export function canEditRates(user: AuthUser): boolean {
  return [Permission.SfsPrepare, Permission.CfsPrepare, Permission.ConfigManage].some((p) =>
    user.permissions.has(p),
  );
}

const same = (a: string | null, b: string | null) =>
  a === null || b === null ? a === b : toDecimal(a).equals(toDecimal(b));

/**
 * Group exchange rates: units of currency per 1 USD per month (CLAUDE.md). A month is locked
 * once any report whose period includes it is finalised (or when flagged locked); locked
 * rates can be re-sent unchanged but never changed.
 */
@Injectable()
export class RatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  /** Month → why it is locked (the finalised reports that use it). */
  async lockedMonths(db: Db = this.prisma): Promise<Map<IsoDate, string>> {
    const tasks = await db.task.findMany({
      where: {
        OR: [
          { entities: { some: { status: 'FINALISED' } } },
          { levels: { some: { status: 'FINALISED' } } },
        ],
      },
      select: { number: true, period: { select: { startDate: true, endDate: true } } },
      orderBy: { number: 'asc' },
    });
    const byMonth = new Map<IsoDate, string[]>();
    for (const t of tasks) {
      for (const m of monthsBetween(fromDbDate(t.period.startDate), fromDbDate(t.period.endDate))) {
        byMonth.set(m, [...(byMonth.get(m) ?? []), t.number]);
      }
    }
    const flagged = await db.exchangeRate.findMany({
      where: { locked: true },
      select: { month: true },
    });
    for (const r of flagged) {
      const m = fromDbDate(r.month);
      if (!byMonth.has(m)) byMonth.set(m, []);
    }
    return new Map(
      [...byMonth].map(([m, numbers]) => [
        m,
        numbers.length > 0
          ? `Locked: a report using ${monthLabel(m)} is finalised (${numbers.join(', ')}).`
          : `Locked: ${monthLabel(m)} rates are locked.`,
      ]),
    );
  }

  async panel(
    user: AuthUser,
    p: { label: string; type: string; startDate: IsoDate; endDate: IsoDate },
    currencies: string[],
    taskLocked: boolean,
  ): Promise<RatesPanelDto> {
    const months = monthsBetween(p.startDate, p.endDate);
    const [rows, locked] = await Promise.all([
      this.prisma.exchangeRate.findMany({
        where: {
          currencyCode: { in: currencies },
          month: { gte: toDbDate(priorMonth(months[0]!)), lte: toDbDate(months.at(-1)!) },
        },
        include: { enteredBy: { select: { name: true } } },
      }),
      this.lockedMonths(),
    ]);
    const key = (m: string, c: string) => `${c}:${m}`;
    const byKey = new Map(rows.map((r) => [key(fromDbDate(r.month), r.currencyCode), r]));
    const str = (d: Prisma.Decimal | null) => (d === null ? null : d.toString());

    const cells = currencies.flatMap((currency) =>
      months.map((month) => {
        const r = byKey.get(key(month, currency));
        return {
          month,
          currency,
          opening: str(r?.opening ?? null),
          closing: str(r?.closing ?? null),
          average: str(r?.average ?? null),
          source: r?.source ?? null,
          enteredBy: r?.enteredBy?.name ?? null,
          enteredAt: r?.enteredAt.toISOString() ?? null,
        };
      }),
    );
    const missing = cells.reduce((n, c) => n + FIELDS.filter((f) => c[f] === null).length, 0);
    const monthly: MonthlyRate[] = rows.map((r) => ({
      month: fromDbDate(r.month),
      currency: r.currencyCode,
      opening: str(r.opening),
      closing: str(r.closing),
      average: str(r.average),
    }));
    const inPeriod = new Set(months);
    return {
      periodLabel: p.label,
      currencies,
      months: months.map((m) => ({
        month: m,
        label: monthLabel(m),
        locked: locked.has(m),
        lockedReason: locked.get(m) ?? null,
      })),
      cells,
      complete: missing === 0,
      missing,
      warnings: checkRates(monthly).filter((w) => inPeriod.has(w.month)),
      sourceLabel: await rateSourceLabel(this.prisma),
      assumption: p.type === 'MONTHLY' ? null : PERIOD_AVERAGE_ASSUMPTION,
      canEdit: canEditRates(user) && !taskLocked,
    };
  }

  /** Manual entry (inline grid). A null value clears nothing: it means "leave as is". */
  async save(user: AuthUser, input: RateInputDto[], ip: string | null): Promise<RateSaveResultDto> {
    const rows = input.map((r, i) => {
      const values = Object.fromEntries(
        FIELDS.map((f) => {
          const v = r[f]?.trim() ?? '';
          if (v !== '' && !validRate(v))
            throw ApiError.validation(
              `Row ${i + 1} (${r.currency} ${r.month}): ${f} must be a positive number with at most 10 decimals.`,
            );
          return [f, v === '' ? null : toDecimal(v).toFixed()];
        }),
      ) as Record<Field, string | null>;
      return { month: r.month, currency: r.currency.toUpperCase(), ...values };
    });
    return this.apply(user, rows, { source: 'Manual entry', file: null, ip });
  }

  async upload(
    user: AuthUser,
    file: { buffer: Buffer; originalname: string; mimetype: string },
    ip: string | null,
    opts: { skipLocked?: boolean } = {},
  ): Promise<RateSaveResultDto> {
    let parsed;
    try {
      parsed = parseRateSheet(readSheetRows(file.buffer, file.originalname));
    } catch {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        ApiErrorCode.FileRejected,
        'The file could not be read as a spreadsheet.',
      );
    }
    if (parsed.errors.length > 0) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        ApiErrorCode.ValidationFailed,
        `The rate file has ${parsed.errors.length} problem(s): ${parsed.errors
          .slice(0, 5)
          .map((e) => e.message)
          .join(' ')}`,
        { errors: parsed.errors },
      );
    }
    return this.apply(user, parsed.rates, {
      source: `Rate file: ${file.originalname}`.slice(0, 200),
      file: { body: file.buffer, name: file.originalname, type: file.mimetype },
      ip,
      skipLocked: opts.skipLocked,
    });
  }

  private async apply(
    user: AuthUser,
    rows: MonthlyRate[],
    how: {
      source: string;
      file: { body: Buffer; name: string; type: string } | null;
      ip: string | null;
      /** Leave out rows of locked months instead of refusing the whole file. */
      skipLocked?: boolean;
    },
  ): Promise<RateSaveResultDto> {
    const currencies = new Set(
      (await this.prisma.currency.findMany({ select: { code: true } })).map((c) => c.code),
    );
    for (const r of rows) {
      if (!/^\d{4}-\d{2}-01$/.test(r.month))
        throw ApiError.validation(`Month "${r.month}" must be the first day of a month.`);
      if (r.currency === 'USD')
        throw ApiError.validation('USD rates are always 1 and are not entered.');
      if (!currencies.has(r.currency))
        throw ApiError.validation(`Unknown currency ${r.currency}. Add it in Configuration first.`);
    }

    return this.prisma.$transaction(async (tx) => {
      const locked = await this.lockedMonths(tx);
      const existing = await tx.exchangeRate.findMany({
        where: { OR: rows.map((r) => ({ month: toDbDate(r.month), currencyCode: r.currency })) },
      });
      const byKey = new Map(existing.map((e) => [`${e.currencyCode}:${fromDbDate(e.month)}`, e]));
      const changes: {
        month: string;
        currency: string;
        before: Record<Field, string | null> | null;
        after: Record<Field, string | null>;
      }[] = [];
      let skippedLocked = 0;
      for (const r of rows) {
        const e = byKey.get(`${r.currency}:${r.month}`);
        const before = e
          ? {
              opening: e.opening?.toString() ?? null,
              closing: e.closing?.toString() ?? null,
              average: e.average?.toString() ?? null,
            }
          : null;
        // A blank value keeps what is stored.
        const after = Object.fromEntries(
          FIELDS.map((f) => [f, r[f] ?? before?.[f] ?? null]),
        ) as Record<Field, string | null>;
        if (before && FIELDS.every((f) => same(before[f], after[f]))) continue;
        if (!before && FIELDS.every((f) => after[f] === null)) continue;
        if (locked.has(r.month) && how.skipLocked) {
          skippedLocked++;
          continue;
        }
        if (locked.has(r.month)) {
          throw new ApiError(
            HttpStatus.CONFLICT,
            ApiErrorCode.RatesLocked,
            `${r.currency} ${monthLabel(r.month)}: ${locked.get(r.month)!} Its rates cannot be changed.`,
          );
        }
        changes.push({ month: r.month, currency: r.currency, before, after });
      }

      const stored = how.file
        ? await storeUpload(tx, this.storage, {
            kind: 'RATES',
            body: how.file.body,
            originalName: how.file.name,
            contentType: how.file.type,
            uploadedById: user.id,
          })
        : null;
      for (const c of changes) {
        const data = {
          ...c.after,
          source: how.source,
          enteredById: user.id,
          enteredAt: new Date(),
        };
        await tx.exchangeRate.upsert({
          where: { month_currencyCode: { month: toDbDate(c.month), currencyCode: c.currency } },
          create: { month: toDbDate(c.month), currencyCode: c.currency, ...data },
          update: data,
        });
      }
      if (changes.length > 0 || stored) {
        await this.audit.record(
          {
            userId: user.id,
            action: stored ? AuditAction.RatesUpload : AuditAction.RatesUpdate,
            entityType: 'EXCHANGE_RATE',
            entityId:
              stored?.id ??
              changes
                .map((c) => `${c.currency}:${c.month}`)
                .join(',')
                .slice(0, 100),
            oldValue: changes.map((c) => ({ month: c.month, currency: c.currency, ...c.before })),
            newValue: {
              ...(stored ? { file: stored.originalName, sha256: stored.sha256 } : {}),
              source: how.source,
              rates: changes.map((c) => ({ month: c.month, currency: c.currency, ...c.after })),
            },
            ip: how.ip,
          },
          tx,
        );
      }

      // Warnings for the months touched, compared with the month before.
      const months = [...new Set(rows.map((r) => r.month))];
      const all = await tx.exchangeRate.findMany({
        where: { month: { in: months.flatMap((m) => [toDbDate(m), toDbDate(priorMonth(m))]) } },
      });
      const warnings = checkRates(
        all.map((r) => ({
          month: fromDbDate(r.month),
          currency: r.currencyCode,
          opening: r.opening?.toString() ?? null,
          closing: r.closing?.toString() ?? null,
          average: r.average?.toString() ?? null,
        })),
      ).filter(
        (w) =>
          months.includes(w.month) &&
          rows.some((r) => r.currency === w.currency && r.month === w.month),
      );

      return {
        file: stored ? await fileRef(tx, stored.id) : null,
        changed: changes.length,
        unchanged: rows.length - changes.length - skippedLocked,
        ...(how.skipLocked ? { skippedLocked } : {}),
        warnings,
      };
    });
  }
}
