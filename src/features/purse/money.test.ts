import { describe, expect, it } from 'vitest';
import { formatMoney, moneyText, parseMoney } from './money';

describe('exact purse money', () => {
  it('parses decimal strings into integer minor units without floating point multiplication', () => {
    expect(parseMoney('0')).toBe(0);
    expect(parseMoney('1.01')).toBe(101);
    expect(parseMoney('001.1')).toBe(110);
    expect(parseMoney('90071992547409.91')).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseMoney('00090071992547409.91')).toBe(Number.MAX_SAFE_INTEGER);
  });
  it.each(['', ' ', ' 1', '-1', '+1', '.1', '1.', '1.001', '1e3', '1,000', 'NaN',
    '90071992547409.92', '90071992547410', '999999999999999999999999999999999'])('rejects invalid/unsafe amount %s', (input) => {
    expect(parseMoney(input)).toBeNull();
  });
  it('preserves cents in every supported currency including the largest exact integer', () => {
    expect(moneyText(Number.MAX_SAFE_INTEGER)).toBe('90071992547409.91');
    for (const currency of ['USD', 'CAD', 'EUR', 'GBP', 'AUD'] as const) {
      expect(formatMoney(Number.MAX_SAFE_INTEGER, currency)).toBe(`${currency}\u00a090,071,992,547,409.91`);
      expect(formatMoney(1, currency)).toBe(`${currency}\u00a00.01`);
      expect(formatMoney(0, currency)).toBe(`${currency}\u00a00.00`);
      expect(formatMoney(null, currency)).toBe('Unavailable');
    }
    expect(formatMoney(Number.MAX_SAFE_INTEGER + 1, 'USD')).toBe('Unavailable');
  });
});
