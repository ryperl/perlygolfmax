import { vi } from 'vitest';
import type { PublicServices } from './public-events';
import type { RoundScores } from '../domain/scoring';
import type { EventWorkspace } from '../domain/setup';
import { PrivateRequestError } from './private-request';
import { fictionalEvent, fictionalId, fictionalWorkspace } from './catalog.test-support';
import { fictionalChange, fictionalRoundScores, scoreResult } from './scoring.test-support';
import { fictionalEventPurse } from './purse.test-support';

export const fictionalPublicScores: RoundScores = { ...fictionalRoundScores,
  permissions: { role: 'public', writePlayerIds: fictionalRoundScores.cards.map((card) => card.playerId), canManageGames: false },
  groups: [{ number: 1, playerIds: [fictionalId(1), fictionalId(2)] }, { number: 2, playerIds: [fictionalId(3), fictionalId(4)] }],
};
export const fictionalPublicWorkspace: EventWorkspace = { ...fictionalWorkspace,
  event: { ...fictionalEvent, role: 'viewer' }, publicAccess: true, canViewScores: true,
  rounds: fictionalWorkspace.rounds.map((round) => ({ ...round, groups: fictionalPublicScores.groups,
    players: round.players.map(({ playerId, displayName }) => ({ playerId, displayName })),
  })),
};
export function fakePublicServices(): PublicServices {
  let saved = fictionalPublicScores;
  const denied = () => Promise.reject(new PrivateRequestError(403, 'Organizer management only.'));
  const purse = fictionalEventPurse();
  return {
    events: { list: vi.fn<PublicServices['events']['list']>().mockResolvedValue({ events: [fictionalPublicWorkspace.event] }) },
    setup: {
      load: vi.fn<PublicServices['setup']['load']>().mockResolvedValue(fictionalPublicWorkspace),
      save: vi.fn().mockImplementation(denied), refreshIndices: vi.fn().mockImplementation(denied),
    },
    scores: {
      load: vi.fn<PublicServices['scores']['load']>().mockImplementation(() => Promise.resolve(saved)),
      save: vi.fn<PublicServices['scores']['save']>().mockImplementation((_event, _round, playerId, holeNumber, score, etag, id) => {
        const result = scoreResult({ ...fictionalChange, playerId, holeNumber, after: score, expectedEtag: etag, id,
          before: saved.cards.find((card) => card.playerId === playerId)?.holes.find((hole) => hole.number === holeNumber)?.score ?? { kind: 'unplayed' },
          recordedBy: { kind: 'public-score', eventId: fictionalEvent.id },
        }, saved);
        saved = result.round;
        return Promise.resolve(result);
      }),
      history: vi.fn().mockImplementation(denied), saveGames: vi.fn().mockImplementation(denied),
    },
    leaderboard: { load: vi.fn<PublicServices['leaderboard']['load']>().mockResolvedValue({
      workspace: fictionalPublicWorkspace, roundScores: [], standings: { status: 'disabled', rounds: [], players: [], staleRoundIds: [] },
    }) },
    purse: { load: vi.fn<PublicServices['purse']['load']>().mockResolvedValue({ ...purse,
      workspace: fictionalPublicWorkspace, roundScores: [fictionalPublicScores] }), save: vi.fn().mockImplementation(denied) },
  };
}
