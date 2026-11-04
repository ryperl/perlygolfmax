import { isRecord } from '../../src/contracts/events.js';

function classification(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(value)
    ? value
    : undefined;
}

export function failureDiagnostics(error: unknown): Readonly<Record<string, string | number>> {
  if (!isRecord(error)) return {};
  const result: Record<string, string | number> = {};
  const name = classification(error.name);
  const code = classification(error.code);
  if (name) result.failureType = name;
  if (code) result.failureCode = code;
  if (typeof error.statusCode === 'number' && Number.isInteger(error.statusCode)
    && error.statusCode >= 100 && error.statusCode <= 599) {
    result.failureStatus = error.statusCode;
  }
  if (isRecord(error.cause)) {
    const causeCode = classification(error.cause.code);
    if (causeCode) result.causeCode = causeCode;
  }
  return result;
}
