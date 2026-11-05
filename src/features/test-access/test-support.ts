import { vi } from 'vitest';
import type { TesterAccessClient } from '../../client/test-access';
import type { ScoresClient } from '../../client/scoring';
import { fictionalId, fictionalWorkspace } from '../../client/catalog.test-support';
import { fakeScores, fictionalRoundScores } from '../../client/scoring.test-support';
import type { TesterAccessManagement, TesterCredential, TesterLink } from '../../domain/test-access';
import type { EventWorkspace } from '../../domain/setup';
import type { RoundScores } from '../../domain/scoring';

export const credential: TesterCredential = { eventId: fictionalWorkspace.event.id, linkId: fictionalId(801), token: 'A'.repeat(43) };
export const testerLink: TesterLink = { linkId: credential.linkId, state: 'active', revision: fictionalId(802),
  createdAt: '2026-11-05T00:00:00Z', expiresAt: '2026-11-06T00:00:00Z' };
export const management: TesterAccessManagement = { eventId: credential.eventId, eventStatus: 'active',
  scope: 'all-groups-in-event', etag: '"fictional-event-v1"', links: [testerLink] };
export const workspace: EventWorkspace = { ...fictionalWorkspace, event: { ...fictionalWorkspace.event, role: 'viewer' },
  testerAccess: true, canViewScores: true };
export const testerRound: RoundScores = { ...fictionalRoundScores,
  permissions: { role: 'tester', canManageGames: false, writePlayerIds: fictionalRoundScores.cards.map((card) => card.playerId) },
  groups: fictionalRoundScores.cards.map((card, index) => ({ number: index + 1, playerIds: [card.playerId] })) };

export function testerClient() {
  const base = fakeScores();
  let saved = testerRound;
  const scores: ScoresClient = {
    ...base,
    load: vi.fn<ScoresClient['load']>().mockImplementation(() => Promise.resolve(saved)),
    save: vi.fn<ScoresClient['save']>().mockImplementation(async (...args) => {
      const result = await base.save(...args);
      saved = { ...result.round, groups: testerRound.groups, permissions: {
        role: 'tester', canManageGames: false, writePlayerIds: testerRound.cards.map((card) => card.playerId),
      } };
      return { ...result, round: saved };
    }),
  };
  const client: TesterAccessClient = {
    list: vi.fn<TesterAccessClient['list']>().mockResolvedValue(management),
    create: vi.fn<TesterAccessClient['create']>().mockImplementation((_event, input, _etag, operationId) =>
      Promise.resolve({ operationId, linkId: input.linkId, state: 'active' })),
    revoke: vi.fn<TesterAccessClient['revoke']>().mockImplementation((_event, input, _etag, operationId) =>
      Promise.resolve({ operationId, linkId: input.linkId, state: 'revoked' })),
    workspace: vi.fn<TesterAccessClient['workspace']>().mockResolvedValue(workspace),
    bindScores: vi.fn<TesterAccessClient['bindScores']>().mockReturnValue(scores),
  };
  return { client, scores };
}
export function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Uninitialized fictional deferred value.'); };
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
