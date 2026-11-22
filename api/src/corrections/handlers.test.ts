import { HttpRequest, InvocationContext } from '@azure/functions';
import { describe, expect, it, vi } from 'vitest';
import { createCorrectionsHandler } from './handlers.js';
import type { CorrectionsApi } from './handlers.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { creator, event } from '../../test/fixtures.js';
import { ApiError } from '../errors.js';
import { catalogFixture } from '../../test/catalog-fixtures.js';

const roundId = identifier(500);

function request(method: 'GET' | 'PUT', body?: unknown, headers: Record<string, string> = {}) {
  return new HttpRequest({
    url: 'https://fictional.example.test/api/events/test/rounds/test/corrections',
    method,
    params: { id: event.id, roundId },
    headers: {
      authorization: 'Bearer fictional-token',
      ...(method === 'PUT' ? { 'content-type': 'application/json', 'Idempotency-Key': identifier(900) } : {}),
      ...headers,
    },
    ...(method === 'PUT' ? { body: { string: JSON.stringify(body ?? {}) } } : {}),
  });
}

describe('round corrections HTTP handlers', () => {
  it('records actionable safe system diagnostics without leaking messages, bodies or credentials', async () => {
    const f = catalogFixture();
    const failure = Object.assign(new Error('fixture-private-system-detail'), {
      name: 'RestError', code: 'AuthorizationPermissionMismatch', statusCode: 403,
      requestId: identifier(555), token: 'fixture-private-token',
    });
    vi.spyOn(f.workspace, 'correctionModel').mockRejectedValue(failure);
    const api: CorrectionsApi = { verify: vi.fn().mockResolvedValue(creator),
      limiter: { check: vi.fn().mockResolvedValue(undefined) }, workspace: f.workspace };
    const context = new InvocationContext({ invocationId: 'fictional-diagnostic', logHandler: () => undefined });
    const logged = vi.spyOn(context, 'error');
    expect(await createCorrectionsHandler(() => api, 'model')(request('GET'), context)).toMatchObject({
      status: 503, jsonBody: { code: 'SERVICE_UNAVAILABLE' },
    });
    expect(logged).toHaveBeenCalledWith('Corrections API request failed', {
      code: 'SERVICE_UNAVAILABLE', action: 'model', status: 503, invocationId: 'fictional-diagnostic',
      failureType: 'RestError', failureCode: 'AuthorizationPermissionMismatch', failureStatus: 403,
      failureRequestId: identifier(555),
    });
    expect(JSON.stringify(logged.mock.calls)).not.toContain('fixture-private');
    expect(JSON.stringify(logged.mock.calls)).not.toContain('Bearer');
  });
  it('serves owner correction model and correction write result', async () => {
    const correctionModel = vi.fn().mockResolvedValue({
      eventId: event.id,
      roundId,
      eventEtag: 'event-v1',
      roundEtag: 'round-v1',
      allowPerGolferTees: false,
      teeProfileId: 101,
      compatibleTees: [{
        id: 101,
        name: 'Fictional Blue',
        category: 'Fictional category',
        holeCount: 18,
        totalYardage: 6300,
        totalMeters: 5760,
        totalPar: 72,
        strokeAllocation: true,
        shorter: false,
        eligibleSides: 'All',
        ratings: [
          { type: 'Total', course: 72, slope: 120, bogey: 95 },
          { type: 'Front', course: 36, slope: 120, bogey: 47.5 },
          { type: 'Back', course: 36, slope: 120, bogey: 47.5 },
        ],
        holes: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, sourceId: i + 1, length: 350, par: 4, allocation: i + 1 })),
      }],
      players: [{ playerId: identifier(200), displayName: 'Fictional Player', handicapIndex: null }],
      playerTeeSelections: [],
      groups: [{ number: 1, playerIds: [identifier(200)] }],
      gameTeams: [],
      warnings: [],
    });
    const correctRound = vi.fn().mockResolvedValue({
      applied: true,
      receiptId: identifier(900),
      model: {
        eventId: event.id,
        roundId,
        eventEtag: 'event-v2',
        roundEtag: 'round-v2',
        inputRevision: identifier(900),
        allowPerGolferTees: false,
        teeProfileId: 101,
        compatibleTees: [],
        players: [{ playerId: identifier(200), displayName: 'Fictional Player', handicapIndex: null }],
        playerTeeSelections: [],
        groups: [{ number: 1, playerIds: [identifier(200)] }],
        gameTeams: [],
        warnings: [{ code: 'purse-review-required', message: 'Review payouts.' }],
      },
    });
    const workspace = {
      correctionModel,
      correctRound,
    };
    const check = vi.fn().mockResolvedValue(undefined);
    const api = {
      verify: vi.fn().mockResolvedValue(creator),
      limiter: { check },
      workspace,
    } as unknown as CorrectionsApi;
    const context = new InvocationContext({ invocationId: 'fictional-corrections', logHandler: () => undefined });

    const read = await createCorrectionsHandler(() => api, 'model')(request('GET'), context);
    expect(read).toMatchObject({ status: 200, headers: { 'Cache-Control': 'no-store' } });
    expect(correctionModel).toHaveBeenCalledWith(creator, event.id, roundId);
    expect(check).toHaveBeenCalledWith(creator, 'setup-read');

    const write = await createCorrectionsHandler(() => api, 'write')(request('PUT', {
      expected: { eventEtag: 'event-v1', roundEtag: 'round-v1', inputRevision: null },
      reason: 'Fictional correction reason.',
      correction: {
        teeProfileId: 101,
        groups: [{ number: 1, playerIds: [identifier(200)] }],
        players: [{ playerId: identifier(200), handicapIndexValue: null }],
      },
    }), context);
    expect(write).toMatchObject({ status: 200, headers: { 'Cache-Control': 'no-store' } });
    expect(correctRound).toHaveBeenCalledWith(
      creator,
      event.id,
      roundId,
      identifier(900),
      expect.objectContaining({ reason: 'Fictional correction reason.' }),
      false,
      false,
      false,
    );
    expect(check).toHaveBeenCalledWith(creator, 'setup-write');
  });

  it('fails fast for invalid method/body/request-id and propagates auth/limits errors', async () => {
    const correctionModel = vi.fn();
    const correctRound = vi.fn();
    const workspace = {
      correctionModel,
      correctRound,
    };
    const verify = vi.fn().mockResolvedValue(creator);
    const check = vi.fn().mockResolvedValue(undefined);
    const api = {
      verify,
      limiter: { check },
      workspace,
    } as unknown as CorrectionsApi;
    const context = new InvocationContext({ invocationId: 'fictional-corrections', logHandler: () => undefined });

    const wrongMethod = await createCorrectionsHandler(() => api, 'model')(request('PUT', {}), context);
    expect(wrongMethod).toMatchObject({ status: 405, jsonBody: { code: 'METHOD_NOT_ALLOWED' } });

    const invalid = await createCorrectionsHandler(() => api, 'write')(request('PUT', {
      expected: { eventEtag: 'event-v1', roundEtag: 'round-v1', inputRevision: null },
      reason: '',
      correction: { teeProfileId: 101, groups: [], players: [] },
    }, { 'Idempotency-Key': 'not-a-uuid' }), context);
    expect(invalid).toMatchObject({ status: 400 });
    expect(correctRound).not.toHaveBeenCalled();

    verify.mockRejectedValueOnce(new ApiError(401, 'INVALID_TOKEN'));
    const auth = await createCorrectionsHandler(() => api, 'model')(request('GET'), context);
    expect(auth).toMatchObject({ status: 401, headers: { 'WWW-Authenticate': 'Bearer' } });

    check.mockRejectedValueOnce(new ApiError(429, 'REQUEST_LIMIT_EXCEEDED'));
    const limited = await createCorrectionsHandler(() => api, 'model')(request('GET'), context);
    expect(limited).toMatchObject({ status: 429, headers: { 'Retry-After': '60' } });
  });
});
