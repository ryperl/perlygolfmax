import type { TesterAccessClient } from '../../src/client/test-access';
import type { ScoresClient } from '../../src/client/scoring';
import { EventChangedError } from '../../src/client/events';
import type { RoundScores } from '../../src/domain/scoring';
import type { EventWorkspace } from '../../src/domain/setup';
import type { TesterAccessManagement, TesterCredential } from '../../src/domain/test-access';
import { testerLinkLifetimeMs } from '../../src/domain/test-access';
import { calculateGameResults } from '../../src/domain/stableford';
import { fictionalCapturedRound, fictionalGamesRound } from './games-fixture-data';

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
export const fictionalTesterCredential: TesterCredential = {
  eventId: fictionalGamesRound.eventId, linkId: id(800), token: 'A'.repeat(43),
};
const groups = [
  { number: 1, playerIds: fictionalGamesRound.cards.slice(0, 2).map((card) => card.playerId) },
  { number: 2, playerIds: fictionalGamesRound.cards.slice(2).map((card) => card.playerId) },
];
const snapshots = [fictionalCapturedRound, { ...fictionalCapturedRound, id: id(71), name: 'Fictional second round' }];
const workspace: EventWorkspace = {
  event: { id: fictionalGamesRound.eventId, name: 'Fictional tester event', role: 'viewer', status: 'active',
    etag: '"fictional-event-v1"', createdAt: '2026-01-01T00:00:00Z' },
  location: 'Fictional location', roster: fictionalCapturedRound.players.map(({ playerId, displayName }) => ({ playerId, displayName })),
  rounds: snapshots.map((round) => ({
    ...round, groups, players: round.players.map(({ playerId, displayName }) => ({ playerId, displayName })),
  })),
  etag: '"fictional-event-v1"', testerAccess: true, canViewScores: true,
};

export function fictionalTesterClient(): TesterAccessClient {
  let management: TesterAccessManagement = {
    eventId: fictionalTesterCredential.eventId, eventStatus: 'active', etag: '"fictional-links-v1"',
    scope: 'all-groups-in-event', links: [],
  };
  let revision = 1;
  const rounds = new Map<string, RoundScores>(snapshots.map((snapshot) => [snapshot.id, {
    ...fictionalGamesRound, roundId: snapshot.id, roundName: snapshot.name, groups,
    permissions: { role: 'tester', canManageGames: false, writePlayerIds: fictionalGamesRound.cards.map((card) => card.playerId) },
  }]));
  function load(eventId: string, roundId: string, signal: AbortSignal): RoundScores {
    signal.throwIfAborted();
    const round = rounds.get(roundId);
    if (eventId !== fictionalTesterCredential.eventId || !round) throw new Error('Unknown fictional tester round.');
    return round;
  }
  const unavailable = () => Promise.reject(new Error('Organizer and history operations are unavailable to this fictional tester.'));
  const scores: ScoresClient = {
    load: (eventId, roundId, signal) => Promise.resolve(load(eventId, roundId, signal)),
    history: unavailable, saveGames: unavailable,
    save: (eventId, roundId, playerId, holeNumber, score, etag, requestId, signal) => {
      const round = load(eventId, roundId, signal);
      const card = round.cards.find((item) => item.playerId === playerId);
      const hole = card?.holes.find((item) => item.number === holeNumber);
      const snapshot = snapshots.find((item) => item.id === roundId);
      if (!card || !hole || !snapshot || card.etag !== etag) return Promise.reject(new EventChangedError('Fictional card changed.'));
      const cards = round.cards.map((item) => item.playerId !== playerId ? item : {
        ...item, etag: `fictional-card-${String(++revision)}`, updatedAt: '2026-11-05T00:00:00Z',
        holes: item.holes.map((entry) => entry.number === holeNumber ? { ...entry, score } : entry),
      });
      const next: RoundScores = { ...round, cards, ...(round.games ? {
        games: { ...round.games, results: calculateGameResults(round.games.configuration.games, snapshot, cards) },
      } : {}) };
      rounds.set(roundId, next);
      return Promise.resolve({ round: next, change: {
        id: requestId, eventId, roundId, playerId, holeNumber, before: hole.score, after: score, expectedEtag: etag,
        recordedAt: '2026-11-05T00:00:00Z', recordedBy: { kind: 'tester-link', eventId, linkId: fictionalTesterCredential.linkId },
      } });
    },
  };
  return {
    list: (_eventId, signal) => { signal.throwIfAborted(); return Promise.resolve(management); },
    create: (_eventId, input, etag, operationId, signal) => {
      signal.throwIfAborted();
      if (etag !== management.etag) return Promise.reject(new EventChangedError('Fictional link list changed.'));
      const now = Date.now();
      management = { ...management, etag: `"fictional-links-v${String(++revision)}"`, links: [...management.links, {
        linkId: input.linkId, state: 'active', revision: crypto.randomUUID(),
        createdAt: new Date(now).toISOString(), expiresAt: new Date(now + testerLinkLifetimeMs).toISOString(),
      }] };
      return Promise.resolve({ operationId, linkId: input.linkId, state: 'active' });
    },
    revoke: (_eventId, input, etag, operationId, signal) => {
      signal.throwIfAborted();
      if (etag !== management.etag || !management.links.some((link) => link.linkId === input.linkId && link.revision === input.revision)) {
        return Promise.reject(new EventChangedError('Fictional link revision changed.'));
      }
      management = { ...management, etag: `"fictional-links-v${String(++revision)}"`,
        links: management.links.map((link) => link.linkId === input.linkId ? { ...link, state: 'revoked', revision: crypto.randomUUID() } : link) };
      return Promise.resolve({ operationId, linkId: input.linkId, state: 'revoked' });
    },
    renew: (_eventId, input, etag, operationId, signal) => {
      signal.throwIfAborted();
      if (etag !== management.etag || !management.links.some((link) => link.linkId === input.linkId
        && link.revision === input.revision && link.state === 'active')) {
        return Promise.reject(new EventChangedError('Fictional link revision changed.'));
      }
      const now = Date.now();
      management = { ...management, etag: `"fictional-links-v${String(++revision)}"`,
        links: management.links.map((link) => link.linkId === input.linkId ? { ...link, revision: operationId,
          renewedAt: new Date(now).toISOString(), expiresAt: new Date(now + testerLinkLifetimeMs).toISOString() } : link) };
      return Promise.resolve({ operationId, linkId: input.linkId, state: 'active' });
    },
    workspace: (_credential, signal) => { signal.throwIfAborted(); return Promise.resolve(workspace); },
    bindScores: () => scores,
  };
}
