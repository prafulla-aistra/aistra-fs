import { HttpStatus, Injectable } from '@nestjs/common';
import {
  crossRate,
  fyLabel,
  fyStartYearOf,
  type IsoDate,
  monthLabel,
  type MonthlyRate,
  nextMonth,
  parseRateSheet,
  priorMonth,
  reviewRateMonth,
  toDecimal,
} from '@finance-close/engine';
import {
  ApiErrorCode,
  Permission,
  type CrossRateDto,
  type RateGridDto,
  type RatePreviewDto,
  type RatePreviewRowDto,
} from '@finance-close/shared';
import * as XLSX from 'xlsx';
import type { AuthUser } from '../auth/session-user';
import { ApiError } from '../common/api-error';
import { fromDbDate, toDbDate } from '../common/db-dates';
import { rateSourceLabel } from '../common/settings';
import { PrismaService } from '../prisma/prisma.service';
import { RatesService } from './rates.service';
import { readSheetRows } from './sheets';

const FIELDS = ['opening', 'closing', 'average'] as const;
const RATE_HEADER = ['Month', 'Currency', 'Opening', 'Closing', 'Average'];

/** Configuration → Exchange rates: the rate master grid, upload preview, files, cross rates. */
@Injectable()
export class RateConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rates: RatesService,
  ) {}

  private async all(): Promise<MonthlyRate[]> {
    const rows = await this.prisma.exchangeRate.findMany({
      orderBy: [{ month: 'asc' }, { currencyCode: 'asc' }],
    });
    return rows.map((r) => ({
      month: fromDbDate(r.month),
      currency: r.currencyCode,
      opening: r.opening?.toString() ?? null,
      closing: r.closing?.toString() ?? null,
      average: r.average?.toString() ?? null,
    }));
  }

  /** Currencies the group needs rates for: entities' functional, reporting and translated ones. */
  private async required(): Promise<string[]> {
    const entities = await this.prisma.entity.findMany({
      where: { isActive: true },
      select: {
        functionalCurrency: true,
        reportingCurrency: true,
        translatedCurrencies: { select: { currencyCode: true } },
      },
    });
    const set = new Set(
      entities.flatMap((e) => [
        e.functionalCurrency,
        e.reportingCurrency,
        ...e.translatedCurrencies.map((t) => t.currencyCode),
      ]),
    );
    set.delete('USD');
    return [...set].sort();
  }

  async grid(user: AuthUser): Promise<RateGridDto> {
    const [rows, required, locked, meta] = await Promise.all([
      this.prisma.exchangeRate.findMany({ include: { enteredBy: { select: { name: true } } } }),
      this.required(),
      this.lockedBy(),
      this.rates.lockedMonths(),
    ]);
    const rates: MonthlyRate[] = rows.map((r) => ({
      month: fromDbDate(r.month),
      currency: r.currencyCode,
      opening: r.opening?.toString() ?? null,
      closing: r.closing?.toString() ?? null,
      average: r.average?.toString() ?? null,
    }));
    const currencies = [...new Set([...required, ...rates.map((r) => r.currency)])].sort();
    const months = [...new Set(rates.map((r) => r.month))].sort().reverse();
    const byKey = new Map(rows.map((r) => [`${r.currencyCode}:${fromDbDate(r.month)}`, r]));
    const newest = months[0] ?? null;
    const next = newest ? nextMonth(newest) : '2026-04-01';
    return {
      currencies,
      months: months.map((m) => {
        const review = reviewRateMonth(rates, m, required, meta.has(m));
        return {
          month: m,
          label: monthLabel(m),
          fyLabel: fyLabel(fyStartYearOf(m)),
          status: review.status,
          lockedBy: locked.get(m) ?? [],
          lockedReason: meta.get(m) ?? null,
          missing: review.missing,
          checks: review.checks,
          cells: currencies.map((c) => {
            const r = byKey.get(`${c}:${m}`);
            return {
              currency: c,
              opening: r?.opening?.toString() ?? null,
              closing: r?.closing?.toString() ?? null,
              average: r?.average?.toString() ?? null,
              source: r?.source ?? null,
              enteredBy: r?.enteredBy?.name ?? null,
              enteredAt: r?.enteredAt.toISOString() ?? null,
            };
          }),
        };
      }),
      nextMonth: {
        month: next,
        label: monthLabel(next),
        openings: Object.fromEntries(
          currencies.map((c) => [
            c,
            newest ? (byKey.get(`${c}:${newest}`)?.closing?.toString() ?? null) : null,
          ]),
        ),
      },
      sourceLabel: await rateSourceLabel(this.prisma),
      canEdit: user.permissions.has(Permission.ConfigManage),
    };
  }

  /** Month → the finalised report numbers that lock it. */
  private async lockedBy(): Promise<Map<IsoDate, string[]>> {
    const reasons = await this.rates.lockedMonths();
    const tasks = await this.prisma.task.findMany({
      where: {
        OR: [
          { entities: { some: { status: 'FINALISED' } } },
          { levels: { some: { status: 'FINALISED' } } },
        ],
      },
      select: { number: true, period: { select: { startDate: true, endDate: true } } },
      orderBy: { number: 'asc' },
    });
    const out = new Map<IsoDate, string[]>();
    for (const m of reasons.keys()) {
      out.set(
        m,
        tasks
          .filter((t) => fromDbDate(t.period.startDate) <= m && m <= fromDbDate(t.period.endDate))
          .map((t) => t.number),
      );
    }
    return out;
  }

  private parse(file: { buffer: Buffer; originalname: string }) {
    if (!/\.(xlsx|xls|csv)$/i.test(file.originalname))
      throw ApiError.validation('Rate files must be .xlsx, .xls or .csv.');
    try {
      return parseRateSheet(readSheetRows(file.buffer, file.originalname));
    } catch {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        ApiErrorCode.FileRejected,
        'The file could not be read as a spreadsheet.',
      );
    }
  }

  /** What an upload would do, without saving: new / changed / unchanged / skipped (locked). */
  async preview(file: { buffer: Buffer; originalname: string }): Promise<RatePreviewDto> {
    const parsed = this.parse(file);
    const [existing, locked, currencies] = await Promise.all([
      this.all(),
      this.rates.lockedMonths(),
      this.prisma.currency.findMany({ select: { code: true } }),
    ]);
    const known = new Set(currencies.map((c) => c.code));
    const errors = [...parsed.errors];
    const byKey = new Map(existing.map((r) => [`${r.currency}:${r.month}`, r]));
    const rows: RatePreviewRowDto[] = [];
    for (const r of parsed.rates) {
      if (r.currency === 'USD') {
        errors.push({
          row: r.row,
          message: `Row ${r.row}: USD rates are always 1 and are not entered.`,
        });
        continue;
      }
      if (!known.has(r.currency)) {
        errors.push({
          row: r.row,
          message: `Row ${r.row}: unknown currency ${r.currency}. Add it in Configuration first.`,
        });
        continue;
      }
      const e = byKey.get(`${r.currency}:${r.month}`);
      const before = e ? { opening: e.opening, closing: e.closing, average: e.average } : null;
      const after = Object.fromEntries(
        FIELDS.map((f) => [f, r[f] ?? before?.[f] ?? null]),
      ) as RatePreviewRowDto['after'];
      const same = (a: string | null, b: string | null) =>
        a === null || b === null ? a === b : toDecimal(a).equals(toDecimal(b));
      const unchanged = before
        ? FIELDS.every((f) => same(before[f], after[f]))
        : FIELDS.every((f) => after[f] === null);
      rows.push({
        month: r.month,
        label: monthLabel(r.month),
        currency: r.currency,
        status: unchanged
          ? 'UNCHANGED'
          : locked.has(r.month)
            ? 'LOCKED'
            : before
              ? 'CHANGED'
              : 'NEW',
        before,
        after,
      });
    }
    // Checks on the result: stored rates overlaid with the file's rows.
    const merged = new Map(existing.map((r) => [`${r.currency}:${r.month}`, r]));
    for (const r of rows)
      if (r.status !== 'LOCKED')
        merged.set(`${r.currency}:${r.month}`, {
          month: r.month,
          currency: r.currency,
          ...r.after,
        });
    const touched = new Set(rows.map((r) => `${r.currency}:${r.month}`));
    const all = [...merged.values()];
    const warnings = [...new Set(rows.map((r) => r.month))].flatMap((m) =>
      reviewRateMonth(all, m, [], false)
        .checks.filter((c) => touched.has(`${c.currency}:${m}`))
        .map((c) => ({ month: m, ...c })),
    );
    const count = (s: string) => rows.filter((r) => r.status === s).length;
    return {
      fileName: file.originalname,
      rows,
      summary: {
        new: count('NEW'),
        changed: count('CHANGED'),
        unchanged: count('UNCHANGED'),
        skippedLocked: count('LOCKED'),
      },
      errors,
      warnings,
    };
  }

  private workbook(rows: (string | null)[][], sheet: string): Buffer {
    const ws = XLSX.utils.aoa_to_sheet([RATE_HEADER, ...rows]);
    ws['!cols'] = [{ wch: 10 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheet);
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  /**
   * Upload template: the next month for every required currency, opening pre-filled from the
   * latest closing. Rates are written as text so no value passes through floating point.
   */
  async template(): Promise<Buffer> {
    const [rates, required] = await Promise.all([this.all(), this.required()]);
    const newest = rates
      .map((r) => r.month)
      .sort()
      .at(-1);
    const month = newest ? nextMonth(newest) : '2026-04-01';
    return this.workbook(
      required.map((c) => [
        month.slice(0, 7),
        c,
        rates.find((r) => r.currency === c && r.month === priorMonth(month))?.closing ?? '',
        '',
        '',
      ]),
      'Rates',
    );
  }

  /** Every stored rate, newest month first (text cells, 10 dp as stored). */
  async export(): Promise<Buffer> {
    const rates = await this.all();
    return this.workbook(
      [...rates]
        .sort((a, b) => b.month.localeCompare(a.month) || a.currency.localeCompare(b.currency))
        .map((r) => [r.month.slice(0, 7), r.currency, r.opening, r.closing, r.average]),
      'Rates',
    );
  }

  async cross(month: IsoDate, from: string, to: string): Promise<CrossRateDto> {
    const known = new Set(
      (await this.prisma.currency.findMany({ select: { code: true } })).map((c) => c.code),
    );
    for (const c of [from, to])
      if (!known.has(c)) throw ApiError.validation(`Unknown currency ${c}.`);
    const rows = await this.prisma.exchangeRate.findMany({
      where: { month: toDbDate(month), currencyCode: { in: [from, to] } },
    });
    const rates: MonthlyRate[] = rows.map((r) => ({
      month,
      currency: r.currencyCode,
      opening: r.opening?.toString() ?? null,
      closing: r.closing?.toString() ?? null,
      average: r.average?.toString() ?? null,
    }));
    const period = { startDate: month, endDate: month };
    return {
      month,
      label: monthLabel(month),
      from,
      to,
      rates: FIELDS.map((kind) => ({ kind, ...crossRate(rates, period, from, to, kind) })),
    };
  }
}
