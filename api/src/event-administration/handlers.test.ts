import { HttpRequest, InvocationContext } from '@azure/functions';
import { describe, expect, it, vi } from 'vitest';
import { identifier, memoryTable } from '../../test/catalog-fixtures.js';
import { creator, event, member } from '../../test/fixtures.js';
import { ApiError } from '../errors.js';
import { TableEventAdministration } from './store.js';
import { createEventAdministrationHandler } from './handlers.js';

function fixture(organizer = true) {
  const f = memoryTable();
  const row = f.seed({ partitionKey: event.id, rowKey: 'event', ...event, quickRound: true, quickRoundReady: true, status: 'archived' });
  const verify = vi.fn().mockResolvedValue(organizer ? creator : member);
  const limiter = { check: vi.fn().mockResolvedValue(undefined) };
  const api = { verify, limiter, administration: new TableEventAdministration(f.table,
    (identity) => identity.objectId === creator.objectId && identity.tenantId === creator.tenantId) };
  function request(action: 'restore' | 'delete' | 'continue', body: unknown = {}, headers: Record<string, string> = {}, query = '') {
    return new HttpRequest({ method: 'POST', url: `https://fictional.example/api/organizer/${action}${query}`,
      params: { id: event.id }, headers: { Authorization: 'Bearer fictional', 'Content-Type': 'application/json',
        'If-Match': row.etag, 'Idempotency-Key': identifier(980), ...headers },
      body: { string: JSON.stringify(body) } });
  }
  const context = new InvocationContext();
  return { ...f, api, context, request };
}

describe('Event administration API authorization and request boundaries', () => {
  it('requires verified organizer authority and never accepts owner membership or anonymous access as manager authority', async () => {
    const f = fixture(false);
    f.seed({ partitionKey: event.id, rowKey: `member:${member.objectId}`, ...member, role: 'owner' });
    const handler = createEventAdministrationHandler(() => f.api, 'delete');
    expect((await handler(f.request('delete', { confirmation: event.name }), f.context)).status).toBe(403);
    f.api.verify.mockRejectedValue(new ApiError(401, 'AUTHENTICATION_REQUIRED'));
    expect((await handler(f.request('delete', { confirmation: event.name }), f.context)).status).toBe(401);
    expect(f.rows.get(`${event.id}|event`)?.status).toBe('archived');
  });

  it('checks caller, shared site and event durable budgets before a manager mutation', async () => {
    const f = fixture();
    const result = await createEventAdministrationHandler(() => f.api, 'restore')(f.request('restore'), f.context);
    expect(result.status).toBe(200);
    expect(f.api.limiter.check.mock.calls).toEqual([
      [creator, 'events-manage'], [{ kind: 'public-browse' }, 'events-manage'],
      [{ kind: 'public-score', eventId: event.id }, 'events-manage'],
    ]);
  });

  it('enforces ordinary 4 KiB payloads, strict bodies and revision/request identities', async () => {
    const f = fixture();
    const handler = createEventAdministrationHandler(() => f.api, 'delete');
    expect((await handler(f.request('delete', { confirmation: event.name }, { 'Content-Length': '4097' }), f.context)).status).toBe(413);
    expect((await handler(f.request('delete', { confirmation: event.name, fakeOwner: true }), f.context)).status).toBe(400);
    expect((await handler(f.request('delete', { confirmation: event.name }, { 'If-Match': '' }), f.context)).status).toBe(400);
    expect((await handler(f.request('delete', { confirmation: event.name }, { 'Idempotency-Key': 'invalid' }), f.context)).status).toBe(400);
    f.api.limiter.check.mockRejectedValue(new Error('Fictional durable budget unavailable'));
    expect((await handler(f.request('delete', { confirmation: event.name }), f.context)).status).toBe(503);
    expect(f.rows.get(`${event.id}|event`)?.status).toBe('archived');
  });
  it('returns deletion progress only when asked, so frontends from before progress keep their exact response shape', async () => {
    const legacy = fixture();
    const plain = await createEventAdministrationHandler(() => legacy.api, 'delete')(
      legacy.request('delete', { confirmation: event.name }), legacy.context);
    expect(plain.jsonBody).toEqual({ eventId: event.id, requestId: identifier(980), state: 'deleted' });
    const current = fixture();
    const detailed = await createEventAdministrationHandler(() => current.api, 'delete')(
      current.request('delete', { confirmation: event.name }, {}, '?progress=1'), current.context);
    expect(detailed.jsonBody).toEqual({ eventId: event.id, requestId: identifier(980), state: 'deleted',
      progress: { stage: 'finished', removed: 0 } });
    const resumed = await createEventAdministrationHandler(() => current.api, 'continue')(
      current.request('continue', {}, {}, '?progress=1'), current.context);
    expect(resumed.jsonBody).toEqual(detailed.jsonBody);
  });
});
