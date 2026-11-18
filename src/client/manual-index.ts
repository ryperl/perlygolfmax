import type { ManualIndexInput } from '../domain/catalog';

export function defaultManualIndex(value: string, today = new Date()): ManualIndexInput {
  const year = String(today.getFullYear()).padStart(4, '0');
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return { value: value.trim(), effectiveDate: `${year}-${month}-${day}`, source: 'GHIN' };
}
