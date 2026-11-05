import type { PurseCurrency } from '../../domain/purse';

/** Decimal text is converted before Number is used, preserving every minor unit. */
export function parseMoney(text: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole = '', fraction = ''] = text.split('.');
  const digits = whole.replace(/^0+/, '') || '0';
  if (digits.length > 14) return null;
  const minor = BigInt(digits) * 100n + BigInt(fraction.padEnd(2, '0'));
  return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
}

export function moneyText(minor: number): string {
  const exact = BigInt(minor);
  return `${String(exact / 100n)}.${String(exact % 100n).padStart(2, '0')}`;
}

export function formatMoney(minor: number | null, currency: PurseCurrency): string {
  if (minor === null || !Number.isSafeInteger(minor) || minor < 0) return 'Unavailable';
  const exact = BigInt(minor);
  const fraction = String(exact % 100n).padStart(2, '0');
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency, currencyDisplay: 'code', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).formatToParts(exact / 100n).map((part) => part.type === 'fraction' ? fraction : part.value).join('');
}
