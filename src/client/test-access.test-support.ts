import { vi } from 'vitest';
import type { RoundScores } from '../domain/scoring';
import type { EventWorkspace } from '../domain/setup';
import type { TesterCredential } from '../domain/test-access';
import type { TesterAccessClient } from './test-access';
import type { ScoresClient } from './scoring';
import { PrivateRequestError } from './private-request';
import { fictionalEvent, fictionalId, fictionalWorkspace } from './catalog.test-support';
import { fictionalChange, fictionalRoundScores, scoreResult } from './scoring.test-support';

export const fictionalTesterCredential: TesterCredential = {
  eventId: fictionalEvent.id, linkId: fictionalId(910), token: 'A'.repeat(43),
};
export const fictionalTesterScores: RoundScores = {
  ...fictionalRoundScores,
  groups: [{ number: 1, playerIds: [fictionalId(1), fictionalId(2)] }, { number: 2, playerIds: [fictionalId(3), fictionalId(4)] }],
  permissions: { role: 'tester', writePlayerIds: fictionalRoundScores.cards.map((card) => card.playerId), canManageGames: false },
};
export const fictionalTesterWorkspace: EventWorkspace = {
  ...fictionalWorkspace, event: { ...fictionalEvent, role: 'viewer' }, canViewScores: true, testerAccess: true,
  rounds: fictionalWorkspace.rounds.map((round) => ({
    ...round, groups: fictionalTesterScores.groups,
    players: round.players.map((player) => ({ playerId: player.playerId, displayName: player.displayName })),
  })),
};
export function fakeTesterScores(): ScoresClient {
  let saved = fictionalTesterScores;
  return {
    load: vi.fn<ScoresClient['load']>().mockImplementation(() => Promise.resolve(saved)),
    save: vi.fn<ScoresClient['save']>().mockImplementation((_event, _round, playerId, holeNumber, score, etag, id) => {
      const result = scoreResult({ ...fictionalChange, playerId, holeNumber, after: score, expectedEtag: etag, id,
        before: saved.cards.find((card) => card.playerId === playerId)?.holes.find((hole) => hole.number === holeNumber)?.score ?? { kind: 'unplayed' },
        recordedBy: { kind: 'tester-link', eventId: fictionalEvent.id, linkId: fictionalTesterCredential.linkId },
      }, saved);
      saved = result.round;
      return Promise.resolve(result);
    }),
    history: vi.fn<ScoresClient['history']>().mockRejectedValue(new PrivateRequestError(403, 'Tester access does not include history.')),
    saveGames: vi.fn<ScoresClient['saveGames']>().mockRejectedValue(new PrivateRequestError(403, 'Tester access does not include management.')),
  };
}
export function fakeTesterAccessClient(scores: ScoresClient = fakeTesterScores()): TesterAccessClient {
  return {
    list: vi.fn<TesterAccessClient['list']>().mockResolvedValue({
      eventId: fictionalEvent.id, eventStatus: 'active', etag: fictionalEvent.etag, scope: 'all-groups-in-event', links: [],
    }),
    create: vi.fn<TesterAccessClient['create']>().mockImplementation((_event, input, _etag, operationId) =>
      Promise.resolve({ operationId, linkId: input.linkId, state: 'active' })),
    revoke: vi.fn<TesterAccessClient['revoke']>().mockImplementation((_event, input, _etag, operationId) =>
      Promise.resolve({ operationId, linkId: input.linkId, state: 'revoked' })),
    workspace: vi.fn<TesterAccessClient['workspace']>().mockResolvedValue(fictionalTesterWorkspace),
    bindScores: vi.fn<TesterAccessClient['bindScores']>().mockReturnValue(scores),
  };
}
