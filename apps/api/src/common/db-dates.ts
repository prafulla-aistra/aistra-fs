import { isIsoDate, type IsoDate } from '@finance-close/engine';

/*
 * PostgreSQL DATE columns hold calendar days. Prisma represents them as a JS Date at UTC
 * midnight, so conversion must always go through UTC — never the server's local time zone.
 */

export function toDbDate(date: IsoDate): Date {
  if (!isIsoDate(date)) throw new RangeError(`Not a valid date: "${date}"`);
  return new Date(`${date}T00:00:00.000Z`);
}

export function fromDbDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}
