import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureEventServices } from './event-services';
import { createEventSession } from '../client/identity';
import { emptyWorkspace, fictionalEvent } from '../client/catalog.test-support';
import { fictionalRoundScores } from '../client/scoring.test-support';

vi.mock('../client/identity', () => ({ createEventSession: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); });

describe('event service composition', () => {
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
      .mockResolvedValueOnce(new Response(JSON.stringify(fictionalRoundScores)));
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
    expect(token).toHaveBeenCalledTimes(4);
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
