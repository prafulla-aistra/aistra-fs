import { Global, Injectable, Module } from '@nestjs/common';
import type { IsoDate } from '@finance-close/engine';

/**
 * "Today" as a calendar date for close logic (period in close, overdue, days left).
 *
 * Uses the group's time zone (APP_TIMEZONE, default Asia/Kolkata) so the date does not flip
 * at UTC midnight. FIXED_TODAY=YYYY-MM-DD pins the date — for tests and demos only.
 */
@Injectable()
export class ClockService {
  today(): IsoDate {
    const fixed = process.env.FIXED_TODAY?.trim();
    if (fixed && /^\d{4}-\d{2}-\d{2}$/.test(fixed)) return fixed;
    const timeZone = process.env.APP_TIMEZONE?.trim() || 'Asia/Kolkata';
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }
}

@Global()
@Module({ providers: [ClockService], exports: [ClockService] })
export class ClockModule {}
