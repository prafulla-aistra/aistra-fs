import { Injectable, Logger } from '@nestjs/common';
import { type DailyRate, type IsoDate, perUsdFromBase } from '@finance-close/engine';

/** Currencies the European Central Bank publishes (reference rates, per EUR). */
const ECB = new Set([
  'AUD',
  'BGN',
  'BRL',
  'CAD',
  'CHF',
  'CNY',
  'CZK',
  'DKK',
  'EUR',
  'GBP',
  'HKD',
  'HUF',
  'IDR',
  'ILS',
  'INR',
  'ISK',
  'JPY',
  'KRW',
  'MXN',
  'MYR',
  'NOK',
  'NZD',
  'PHP',
  'PLN',
  'RON',
  'SEK',
  'SGD',
  'THB',
  'TRY',
  'USD',
  'ZAR',
]);

export const FEED_SOURCES = {
  ECB: 'Free API: ECB reference rates (Frankfurter)',
  CURRENCY_API: 'Free API: currency-api (fawazahmed0)',
} as const;
export type FeedSource = keyof typeof FEED_SOURCES;

/** JSON numbers from the feeds have at most 15 significant digits: String() is exact. */
const text = (v: unknown): string | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? String(v) : null;

const weekdays = (from: IsoDate, to: IsoDate): IsoDate[] => {
  const out: IsoDate[] = [];
  for (
    let d = new Date(`${from}T00:00:00Z`);
    d <= new Date(`${to}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const w = d.getUTCDay();
    if (w >= 1 && w <= 5) out.push(d.toISOString().slice(0, 10));
  }
  return out;
};

/**
 * Daily rates (units per 1 USD) from free public feeds, no API key:
 *  - ECB reference rates via Frankfurter for the currencies the ECB publishes (cross rate
 *    through EUR: C per EUR ÷ USD per EUR, at full precision);
 *  - currency-api (fawazahmed0, quoted per USD) for the others (e.g. AED, LKR).
 * Only network access lives here; the monthly figures are the engine's (monthFromDaily).
 */
@Injectable()
export class RateFeedService {
  private readonly logger = new Logger('RateFeed');

  sourceOf(currency: string): FeedSource {
    return ECB.has(currency) ? 'ECB' : 'CURRENCY_API';
  }

  /** GET a JSON document; null when it does not exist (404). Tests replace this. */
  async fetchJson(url: string): Promise<unknown> {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: 'follow' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  }

  /** Daily rates per currency between two dates (inclusive). Failures become problems. */
  async daily(
    currencies: string[],
    from: IsoDate,
    to: IsoDate,
  ): Promise<{ rates: Map<string, DailyRate[]>; problems: Map<string, string> }> {
    const rates = new Map<string, DailyRate[]>(currencies.map((c) => [c, []]));
    const problems = new Map<string, string>();
    const ecb = currencies.filter((c) => this.sourceOf(c) === 'ECB');
    const other = currencies.filter((c) => this.sourceOf(c) === 'CURRENCY_API');

    if (ecb.length) {
      try {
        const symbols = [...new Set(['USD', ...ecb])].filter((c) => c !== 'EUR').join(',');
        const body = (await this.fetchJson(
          `https://api.frankfurter.dev/v1/${from}..${to}?base=EUR&symbols=${symbols}`,
        )) as { rates?: Record<string, Record<string, unknown>> } | null;
        for (const [date, r] of Object.entries(body?.rates ?? {})) {
          if (date < from || date > to) continue;
          const usd = text(r.USD);
          if (!usd) continue;
          for (const c of ecb) {
            const v = c === 'EUR' ? '1' : text(r[c]);
            if (v) rates.get(c)!.push({ date, perUsd: perUsdFromBase(v, usd) });
          }
        }
      } catch (e) {
        this.logger.warn(`ECB feed failed: ${String(e)}`);
        for (const c of ecb)
          problems.set(c, 'The ECB rate feed could not be reached; try again later.');
      }
    }

    if (other.length) {
      const dates = weekdays(from, to);
      const fetchDay = async (date: IsoDate) => {
        const urls = [
          `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/usd.json`,
          `https://${date}.currency-api.pages.dev/v1/currencies/usd.json`,
        ];
        let lastError: unknown = null;
        for (const url of urls) {
          try {
            return (await this.fetchJson(url)) as {
              date?: string;
              usd?: Record<string, unknown>;
            } | null;
          } catch (e) {
            lastError = e;
          }
        }
        throw lastError;
      };
      try {
        // A few days at a time, to stay polite to the free service.
        for (let i = 0; i < dates.length; i += 6) {
          const batch = dates.slice(i, i + 6);
          const bodies = await Promise.all(batch.map(fetchDay));
          bodies.forEach((body, k) => {
            if (!body || body.date !== batch[k]) return;
            for (const c of other) {
              const v = text(body.usd?.[c.toLowerCase()]);
              if (v) rates.get(c)!.push({ date: batch[k]!, perUsd: v });
            }
          });
        }
      } catch (e) {
        this.logger.warn(`currency-api feed failed: ${String(e)}`);
        for (const c of other)
          problems.set(c, 'The currency-api rate feed could not be reached; try again later.');
      }
    }
    for (const c of currencies)
      if (!problems.has(c) && rates.get(c)!.length === 0)
        problems.set(c, `No published rates for ${c} between ${from} and ${to}.`);
    return { rates, problems };
  }
}
