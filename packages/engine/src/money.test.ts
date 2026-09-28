import DecimalJs from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { Decimal, isBalanced, roundAmount, sumAmounts, toDecimal } from './money';

describe('toDecimal', () => {
  it('parses plain and signed decimal strings exactly', () => {
    expect(toDecimal('1234.5678').toString()).toBe('1234.5678');
    expect(toDecimal('-0.0001').toString()).toBe('-0.0001');
    expect(toDecimal('+12').toString()).toBe('12');
    expect(toDecimal('.5').toString()).toBe('0.5');
  });

  it('accepts thousands separators and surrounding whitespace', () => {
    expect(toDecimal(' 1,234,567.89 ').toString()).toBe('1234567.89');
  });

  it('accepts Decimal instances, including ones from the global decimal.js', () => {
    expect(toDecimal(new Decimal('2.5')).toString()).toBe('2.5');
    expect(toDecimal(new DecimalJs('3.25')).toString()).toBe('3.25');
  });

  it('rejects JS numbers so floats cannot enter the engine', () => {
    expect(() => toDecimal(0.1 as unknown as string)).toThrow(TypeError);
  });

  it.each(['', 'abc', '1e5', 'NaN', 'Infinity', '1.2.3', '--1'])('rejects %j', (bad) => {
    expect(() => toDecimal(bad)).toThrow(RangeError);
  });

  it('rejects non-finite Decimals', () => {
    expect(() => toDecimal(new Decimal(NaN))).toThrow(RangeError);
  });
});

describe('sumAmounts', () => {
  it('is exact where floating point is not (0.1 + 0.2)', () => {
    expect(sumAmounts(['0.1', '0.2']).toString()).toBe('0.3');
  });

  it('keeps full precision on large NUMERIC(20,4) values', () => {
    expect(sumAmounts(['9999999999999999.9999', '0.0001']).toString()).toBe('10000000000000000');
  });

  it('returns zero for an empty list', () => {
    expect(sumAmounts([]).isZero()).toBe(true);
  });
});

describe('roundAmount', () => {
  it('rounds to 2 dp by default, half away from zero', () => {
    expect(roundAmount('1.005').toFixed(2)).toBe('1.01');
    expect(roundAmount('-1.005').toFixed(2)).toBe('-1.01');
    expect(roundAmount('1.00499999').toFixed(2)).toBe('1.00');
  });

  it('supports other precisions', () => {
    expect(roundAmount('83.123456789', 4).toString()).toBe('83.1235');
    expect(roundAmount('2.5', 0).toString()).toBe('3');
  });

  it('rejects invalid dp', () => {
    expect(() => roundAmount('1', -1)).toThrow(RangeError);
    expect(() => roundAmount('1', 1.5)).toThrow(RangeError);
  });
});

describe('isBalanced (debit = positive, credit = negative)', () => {
  it('is true when debits and credits net to zero', () => {
    expect(isBalanced(['1000.00', '250.50', '-1250.50'])).toBe(true);
  });

  it('is false when off by even one unit of the 4th decimal', () => {
    expect(isBalanced(['1000.00', '-999.9999'])).toBe(false);
  });

  it('treats an empty trial balance as balanced', () => {
    expect(isBalanced([])).toBe(true);
  });
});
