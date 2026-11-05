import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureEventServices } from './event-services';
import { createEventSession } from '../client/identity';
import { emptyWorkspace, fictionalEvent } from '../client/catalog.test-support';
import { fictionalRoundScores } from '../client/scoring.test-support';
import { fictionalTesterCredential, fictionalTesterWorkspace } from '../client/test-access.test-support';

vi.mock('../client/identity', () => ({ createEventSession: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); });

describe('event service composition', () => {
  it('composes guest workspace access without initializing identity or acquiring an account token', async () => {
    const token = vi.fn<() => Promise<string>>().mockResolvedValue('fictional-owner-token');
    const initialize = vi.fn<() => Promise<boolean>>().mockResolvedValue(false);
    vi.mocked(createEventSession).mockReturnValue({
      token, initialize, signIn: vi.fn().mockResolvedValue(undefined), signOut: vi.fn().mockResolvedValue(undefined),
    });
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(fictionalTesterWorkspace)));
    vi.stubGlobal('fetch', send);
    const { services } = configureEventServices({
      VITE_ENTRA_SPA_CLIENT_ID: '00000000-0000-4000-8000-000000000001',
      VITE_ENTRA_TENANT_ID: '00000000-0000-4000-8000-000000000003',
      VITE_ENTRA_SUBDOMAIN: 'fictional',
      VITE_ENTRA_API_SCOPE: 'api://00000000-0000-4000-8000-000000000002/Events.Access',
      VITE_API_URL: 'https://fictional.example.test/api',
    });
    if (!services?.testerAccess) throw new Error('Configured services must include scoped tester access.');
    await services.testerAccess.workspace(fictionalTesterCredential, new AbortController().signal);
    expect(token).not.toHaveBeenCalled();
    expect(initialize).not.toHaveBeenCalled();
    expect(send.mock.calls[0]?.[0]).toBe(`https://fictional.example.test/api/tester/events/${fictionalTesterCredential.eventId}/workspace`);
    expect(new Headers(send.mock.calls[0]?.[1]?.headers).get('authorization'))
      .toBe(`Tester ${fictionalTesterCredential.linkId}.${fictionalTesterCredential.token}`);
  });
  it('uses the same session token for event, manager catalog and scoped workspace adapters', async () => {
    const token = vi.fn().mockResolvedValue('fictional-token');
    vi.mocked(createEventSession).mockReturnValue({
      token, initialize: vi.fn().mockResolvedValue(true),
      signIn: vi.fn().mockResolvedValue(undefined), signOut: vi.fn().mockResolvedValue(undefined),
    });
    const send = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ canCreateEvents: true, canManageCatalog: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ courses: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify(emptyWorkspace)))
      .mockResolvedValueOnce(new Response(JSON.stringify(fictionalRoundScores)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ workspace: emptyWorkspace, roundScores: [],
        standings: { status: 'disabled', rounds: [], players: [], staleRoundIds: [] } })));
    vi.stubGlobal('fetch', send);
    const { services } = configureEventServices({
      VITE_ENTRA_SPA_CLIENT_ID: '00000000-0000-4000-8000-000000000001',
      VITE_ENTRA_TENANT_ID: '00000000-0000-4000-8000-000000000003',
      VITE_ENTRA_SUBDOMAIN: 'fictional',
      VITE_ENTRA_API_SCOPE: 'api://00000000-0000-4000-8000-000000000002/Events.Access',
      VITE_API_URL: 'https://fictional.example.test/api',
    });
    if (!services) throw new Error('Expected configured fictional services.');
    const signal = new AbortController().signal;
    await services.events.capabilities(signal);
    await services.catalog.courses(signal);
    await services.setup.load(fictionalEvent.id, signal);
    await services.scores.load(fictionalRoundScores.eventId, fictionalRoundScores.roundId, signal);
    if (!services.leaderboard) throw new Error('Configured production services must include overall results.');
    await services.leaderboard.load(fictionalEvent.id, signal);
    expect(token).toHaveBeenCalledTimes(5);
    expect(send.mock.calls[4]?.[0]).toBe(`https://fictional.example.test/api/events/${fictionalEvent.id}/leaderboard`);
    for (const [, request] of send.mock.calls) {
      expect(new Headers(request?.headers).get('Authorization')).toBe('Bearer fictional-token');
      expect(request).toMatchObject({ credentials: 'omit', cache: 'no-store', signal });
    }
  });
  it('does not instantiate identity or persistence when configuration is absent or invalid', () => {
    expect(configureEventServices({})).toEqual({ services: undefined });
    const invalid = configureEventServices({ VITE_API_URL: 'not-a-url' });
    expect(invalid.services).toBeUndefined();
    expect(invalid.configurationError).toContain('invalid');
  });
});
