import { describe, expect, it } from 'vitest';
import { statementAmount } from './format';

describe('statementAmount', () => {
  it('international grouping, brackets for negatives, dash for nil', () => {
    expect(statementAmount('745317348.66')).toBe('745,317,348.66');
    expect(statementAmount('-1900000.00')).toBe('(1,900,000.00)');
    expect(statementAmount('0.00')).toBe('–');
    expect(statementAmount(null)).toBe('');
  });
  it('Indian lakh / crore grouping', () => {
    expect(statementAmount('7453.17', true)).toBe('7,453.17');
    expect(statementAmount('745317348.66', true)).toBe('74,53,17,348.66');
    expect(statementAmount('-123456.00', true)).toBe('(1,23,456.00)');
    expect(statementAmount('999.00', true)).toBe('999.00');
  });
});
