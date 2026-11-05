import { app, HttpRequest, InvocationContext } from '@azure/functions';
import type * as FunctionsModule from '@azure/functions';
import { describe, expect, it, vi } from 'vitest';
import { event } from '../../test/fixtures.js';
import * as config from '../config.js';
import * as identity from '../identity.js';
import * as runtime from './runtime.js';
import { publicFixture } from './test-support.js';

vi.mock('@azure/functions', async (importOriginal) => {
  const actual = await importOriginal<typeof FunctionsModule>();
  return { ...actual, app: { ...actual.app, http: vi.fn() } };
});

describe('fixed anonymous public namespace registration', () => {
  it('registers only six approved routes and initializes them without private identity configuration or verification', async () => {
    const f = await publicFixture();
    const settings = vi.spyOn(config, 'readSettings').mockImplementation(() => { throw new Error('Fictional identity config absent'); });
    const verifier = vi.spyOn(identity, 'createIdentityVerifier');
    const api = { publicEvents: f.publicEvents, workspace: f.workspace, scores: f.scores, purse: f.purse,
      limiter: { check: vi.fn().mockResolvedValue(undefined) } };
    const create = vi.spyOn(runtime, 'createPublicApi').mockReturnValue(api);
    await import('../functions.js');
    const registrations = vi.mocked(app.http).mock.calls.filter(([name]) => name.startsWith('publicAccess-'));
    expect(registrations.map(([, options]) => ({ route: options.route, methods: options.methods, authLevel: options.authLevel })))
      .toEqual([
        { route: 'public/events', methods: ['GET'], authLevel: 'anonymous' },
        { route: 'public/events/{id}/workspace', methods: ['GET'], authLevel: 'anonymous' },
        { route: 'public/events/{id}/rounds/{roundId}/scores', methods: ['GET'], authLevel: 'anonymous' },
        { route: 'public/events/{id}/rounds/{roundId}/players/{playerId}/holes/{holeNumber}', methods: ['PUT'], authLevel: 'anonymous' },
        { route: 'public/events/{id}/leaderboard', methods: ['GET'], authLevel: 'anonymous' },
        { route: 'public/events/{id}/purse', methods: ['GET'], authLevel: 'anonymous' },
      ]);
    const context = new InvocationContext({ invocationId: 'fictional-public-routes', logHandler: () => undefined });
    for (const action of ['events', 'workspace']) {
      const options = registrations.find(([name]) => name === `publicAccess-${action}`)?.[1];
      if (!options) throw new Error('Missing fictional public registration');
      const result = await options.handler(new HttpRequest({
        url: `https://fictional.example.test/api/public/events/${event.id}/workspace`, method: 'GET', params: { id: event.id },
      }), context);
      expect(result.status).toBe(200);
    }
    expect(create).toHaveBeenCalledTimes(1);
    expect(settings).not.toHaveBeenCalled();
    expect(verifier).not.toHaveBeenCalled();
  });
});
