import { isRecord } from '../../src/contracts/events.js';

export function tableErrorCode(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined;
  if (typeof error.code === 'string') return error.code;
  // The Table SDK's OData error mapper nests the service code in details.
  if (!isRecord(error.details) || !isRecord(error.details.odataError)) return undefined;
  const code = error.details.odataError.code;
  return typeof code === 'string' ? code : undefined;
}

export function isMissingTableEntity(error: unknown): boolean {
  return isRecord(error) && error.statusCode === 404 && tableErrorCode(error) === 'ResourceNotFound';
}
