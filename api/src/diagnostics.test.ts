import { describe, expect, it } from 'vitest';
import { failureDiagnostics } from './diagnostics.js';

describe('safe dependency failure diagnostics', () => {
  it('retains only bounded type, code, status and network-cause classifications', () => {
    const error = Object.assign(new Error('private fixture detail'), {
      name: 'RestError', code: 'AuthorizationPermissionMismatch', statusCode: 403,
      cause: { code: 'ENOTFOUND', message: 'private fixture detail' },
    });
    expect(failureDiagnostics(error)).toEqual({
      failureType: 'RestError', failureCode: 'AuthorizationPermissionMismatch',
      failureStatus: 403, causeCode: 'ENOTFOUND',
    });
  });

  it('never includes messages, tokens, URLs, bodies or arbitrary nested fields', () => {
    expect(failureDiagnostics({
      name: 'invalid@fixture.example.test',
      code: 'https://fixture.example.test/private',
      statusCode: 900,
      message: 'fixture-sensitive-message',
      token: 'fixture-sensitive-token',
      body: 'fixture-sensitive-body',
      cause: { code: 'not a classification', message: 'fixture-sensitive-cause' },
    })).toEqual({});
    expect(failureDiagnostics(null)).toEqual({});
  });
});
