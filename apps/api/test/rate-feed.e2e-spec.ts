import type { RateFetchPreviewDto, RateSaveResultDto } from '@finance-close/shared';
import { DEMO_USERS } from '../prisma/seed-demo';
import { RateFeedService } from '../src/uploads/rate-feed.service';
import { createTestApp, type TestContext, tokenFor } from './helpers';

/**
 * Free API exchange rates for the months of a period, with the two feeds stubbed (no network):
 * ECB (per EUR, through Frankfurter) for INR, currency-api (per USD) for LKR. Hand-checked
 * figures for Jun-2026 (1 Jun is a Monday; 29 May a Friday; 30 Jun a Tuesday).
 */
let ctx: TestContext;
let priya: string;
let saved: {
  month: Date;
  currencyCode: string;
  opening: unknown;
  closing: unknown;
  average: unknown;
  source: string;
}[] = [];
const as = (t: string) => ({ Authorization: `Bearer ${t}` });
const pw = (e: string) => DEMO_USERS.find((d) => d.email === e)!.password;

// ECB: USD per EUR 1.25 every day; INR per EUR 100 → 80 INR per USD, except 30 Jun: 105 → 84.
const ecb = {
  rates: {
    '2026-05-29': { USD: 1.25, INR: 100 }, // opening: 80
    '2026-06-01': { USD: 1.25, INR: 100 }, // 80
    '2026-06-15': { USD: 1.25, INR: 102.5 }, // 82
    '2026-06-30': { USD: 1.25, INR: 105 }, // closing: 84
    '2026-07-31': { USD: 1.25, INR: 106 }, // July (a finalised, locked month)
  },
};
// currency-api: LKR per USD on weekdays only (weekend files are ignored anyway).
const lkr: Record<string, number> = {
  '2026-05-29': 300,
  '2026-06-01': 301,
  '2026-06-30': 303,
};

beforeAll(async () => {
  ctx = await createTestApp();
  priya = await tokenFor(ctx, 'priya@financeclose.local', pw('priya@financeclose.local'));
  saved = await ctx.prisma.exchangeRate.findMany({
    where: { month: new Date('2026-06-01T00:00:00Z'), currencyCode: { in: ['INR', 'LKR'] } },
  });
  jest.spyOn(ctx.app.get(RateFeedService), 'fetchJson').mockImplementation(async (url: string) => {
    if (url.includes('frankfurter')) return ecb;
    const date = /(\d{4}-\d{2}-\d{2})/.exec(url)![1]!;
    return lkr[date] !== undefined ? { date, usd: { lkr: lkr[date] } } : null;
  });
});
afterAll(async () => {
  if (ctx) {
    // Put Jun-2026 back as it was.
    await ctx.prisma.exchangeRate.deleteMany({
      where: { month: new Date('2026-06-01T00:00:00Z'), currencyCode: { in: ['INR', 'LKR'] } },
    });
    for (const r of saved) await ctx.prisma.exchangeRate.create({ data: r as never });
  }
  await ctx?.app.close();
});

const fetchRates = (months: string[], currencies: string[]) =>
  ctx.http().post('/api/exchange-rates/fetch').set(as(priya)).send({ months, currencies });

describe('exchange rates from the free API', () => {
  it('works out opening, closing and average per month and currency', async () => {
    const res = await fetchRates(['2026-06-01'], ['INR', 'LKR']);
    expect(res.status).toBe(201);
    const p = res.body as RateFetchPreviewDto;
    const pick = (c: string) => p.rows.find((r) => r.currency === c)!;
    expect(pick('INR')).toMatchObject({
      opening: '80.0000000000',
      closing: '84.0000000000',
      average: '82.0000000000', // (80 + 82 + 84) / 3
      openingDate: '2026-05-29',
      closingDate: '2026-06-30',
      days: 3,
      source: 'Free API: ECB reference rates (Frankfurter)',
    });
    expect(pick('LKR')).toMatchObject({
      opening: '300.0000000000',
      closing: '303.0000000000',
      average: '302.0000000000', // (301 + 303) / 2
      days: 2,
      source: 'Free API: currency-api (fawazahmed0)',
    });
    expect(p.canSave).toBe(true);
  });

  it('saves on confirm with the source; refuses months that have not ended', async () => {
    const res = await ctx
      .http()
      .post('/api/exchange-rates/fetch/confirm')
      .set(as(priya))
      .send({ months: ['2026-06-01'], currencies: ['INR', 'LKR'] });
    expect(res.status).toBe(201);
    expect((res.body as RateSaveResultDto).changed).toBe(2);
    const inr = await ctx.prisma.exchangeRate.findUniqueOrThrow({
      where: {
        month_currencyCode: { month: new Date('2026-06-01T00:00:00Z'), currencyCode: 'INR' },
      },
    });
    expect([inr.opening?.toFixed(4), inr.closing?.toFixed(4), inr.average?.toFixed(4)]).toEqual([
      '80.0000',
      '84.0000',
      '82.0000',
    ]);
    expect(inr.source).toMatch(
      /^Free API: ECB reference rates \(Frankfurter\) – 3 working days, close 2026-06-30$/,
    );
    // Fetching again: already stored.
    const again = (await fetchRates(['2026-06-01'], ['INR'])).body as RateFetchPreviewDto;
    expect(again.rows[0]!.status).toBe('UNCHANGED');
    expect(again.canSave).toBe(false);

    // FIXED_TODAY is 2026-09-29: September has not ended.
    const sep = (await fetchRates(['2026-09-01'], ['INR'])).body as RateFetchPreviewDto;
    expect(sep.rows[0]).toMatchObject({ status: 'ERROR', closing: null });
    expect(sep.rows[0]!.problems[0]).toMatch(/has not ended yet/);
  });

  it('a finalised month stays locked; a viewer cannot fetch', async () => {
    const jul = (await fetchRates(['2026-07-01'], ['INR'])).body as RateFetchPreviewDto;
    expect(jul.rows[0]!.status).toBe('LOCKED');
    expect(jul.rows[0]!.problems.join(' ')).toMatch(/^Locked: /);
    expect(jul.canSave).toBe(false);
    const viewer = await tokenFor(
      ctx,
      'viewer@financeclose.local',
      pw('viewer@financeclose.local'),
    );
    const r = await ctx
      .http()
      .post('/api/exchange-rates/fetch')
      .set(as(viewer))
      .send({ months: ['2026-06-01'], currencies: ['INR'] });
    expect(r.status).toBe(403);
  });
});
