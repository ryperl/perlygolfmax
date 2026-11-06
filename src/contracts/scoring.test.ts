import { describe, expect, it } from 'vitest';
import type { RoundScores, Scorecard, ScoreChange } from '../domain/scoring';
import { maximumExactHoleStrokes, sameScoreActor, scoreActor } from '../domain/scoring';
import { isHoleScore, isRoundScores, isScorecard, isScoreChange, isScoreHistoryPage, isScoreWriteResult, isScoreActor, parseScoreEntry, scoreEntryText } from './scoring';
import type { GamePlayerResult, TeamGameDefinition, TeamGameFormat } from '../domain/games.js';
import { teamSize } from '../domain/games.js';
import { aggregateTeamGameResults } from '../domain/team-games.js';
import { stablefordPoints } from '../domain/stableford.js';
import { isRoundGamesView } from './games.js';

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
function round(): RoundScores {
  const layout = Array.from({ length: 9 }, (_, index) => ({
    number: index + 1, sourceId: 301 + index, length: 350, par: 4, allocation: index + 1,
  }));
  const cards: Scorecard[] = [1, 2, 3, 4].map((number) => ({
    playerId: id(number), displayName: `Fictional golfer ${String(number)}`, etag: null, updatedAt: null,
    holes: layout.map((hole) => ({ number: hole.number, score: { kind: 'unplayed' } })),
  }));
  return {
    eventId: id(100), eventName: 'Fictional Open', eventStatus: 'active', roundId: id(200), roundName: 'Fictional Round',
    courseName: 'Fictional Course', teeName: 'Fictional Teal', teeCategory: 'Fictional rating',
    layout, groups: [{ number: 1, playerIds: cards.map((card) => card.playerId) }], cards, setupLocked: false, lastUpdatedAt: null,
  };
}
const change: ScoreChange = {
  id: id(300), eventId: id(100), roundId: id(200), playerId: id(1), holeNumber: 1,
  before: { kind: 'unplayed' }, after: { kind: 'strokes', strokes: 4 }, expectedEtag: null,
  recordedAt: '2026-01-01T00:00:00Z', recordedBy: { tenantId: id(500), objectId: id(501) },
};

describe('owner gross scoring network contracts', () => {
  it('validates explicit group starts against captured layout while preserving legacy groups', () => {
    const base = round();
    expect(isRoundScores(base)).toBe(true);
    for (const startingHole of [1, 5, 9]) {
      expect(isRoundScores({ ...base, groups: base.groups.map((group) => ({ ...group, startingHole })) })).toBe(true);
    }
    for (const startingHole of [0, -1, 10, 18, 19, 1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null]) {
      expect(isRoundScores({ ...base, groups: base.groups.map((group) => ({ ...group, startingHole })) })).toBe(false);
    }
  });

  it('requires exact event-scoped public score attribution and all-card non-admin permissions', () => {
    const base = round();
    const actor = { kind: 'public-score', eventId: base.eventId };
    expect(isScoreChange({ ...change, recordedBy: actor })).toBe(true);
    expect(isScoreChange({ ...change, recordedBy: { ...actor, eventId: id(999) } })).toBe(false);
    expect(isScoreChange({ ...change, recordedBy: { ...actor, objectId: id(999) } })).toBe(false);
    const permissions = { role: 'public', writePlayerIds: base.cards.map((card) => card.playerId), canManageGames: false };
    expect(isRoundScores({ ...base, permissions })).toBe(true);
    expect(isRoundScores({ ...base, permissions: { ...permissions, writePlayerIds: [...permissions.writePlayerIds].reverse() } })).toBe(true);
    for (const invalid of [
      { ...permissions, canManageGames: true }, { ...permissions, viewerPlayerId: id(1) },
      { ...permissions, writePlayerIds: [id(1)] }, { ...permissions, writePlayerIds: [...permissions.writePlayerIds, id(999)] },
      { ...permissions, writePlayerIds: [id(1), id(1), id(3), id(4)] },
    ]) expect(isRoundScores({ ...base, permissions: invalid })).toBe(false);
    expect(isRoundScores({ ...base, eventStatus: 'archived', permissions })).toBe(false);
  });
  it('validates distinct exact tester actors and preserves legacy account audit attribution', () => {
    const actor = { kind: 'tester-link' as const, eventId: change.eventId, linkId: id(999) };
    expect(isScoreActor(actor)).toBe(true);
    expect(isScoreChange({ ...change, recordedBy: actor })).toBe(true);
    expect(isScoreChange(change)).toBe(true);
    expect(isScoreChange({ ...change, recordedBy: { ...actor, eventId: id(998) } })).toBe(false);
    expect(isScoreActor({ ...actor, tenantId: id(500), objectId: id(501) })).toBe(false);
    expect(isScoreActor({ tenantId: id(500), objectId: id(501), kind: 'owner' })).toBe(false);
    expect(sameScoreActor(actor, { ...actor })).toBe(true);
    expect(sameScoreActor(actor, { ...actor, linkId: id(998) })).toBe(false);
    expect(sameScoreActor(actor, change.recordedBy)).toBe(false);
    expect(scoreActor(actor)).toEqual(actor);
    expect(scoreActor(change.recordedBy)).toEqual(change.recordedBy);
  });

  it('requires tester scope to be active, non-admin and exactly every saved scorecard', () => {
    const base = round();
    const permissions = { role: 'tester', writePlayerIds: base.cards.map((card) => card.playerId), canManageGames: false };
    expect(isRoundScores({ ...base, permissions })).toBe(true);
    for (const invalid of [
      { ...permissions, canManageGames: true },
      { ...permissions, viewerPlayerId: id(1) },
      { ...permissions, writePlayerIds: [id(1)] },
      { ...permissions, writePlayerIds: [...permissions.writePlayerIds, id(999)] },
    ]) expect(isRoundScores({ ...base, permissions: invalid })).toBe(false);
    expect(isRoundScores({ ...base, eventStatus: 'archived', permissions })).toBe(false);
  });
  it.each([1, 2, 3])('accepts %i scorecards without placeholder players and rejects an empty or mismatched group', (count) => {
    const base = round();
    const cards = base.cards.slice(0, count);
    const value = { ...base, cards, groups: [{ number: 1, playerIds: cards.map((card) => card.playerId) }] };
    expect(isRoundScores(value)).toBe(true);
    expect(isRoundScores({ ...value, cards: [] })).toBe(false);
    expect(isRoundScores({ ...value, groups: base.groups })).toBe(false);
  });
  it.each([{ kind: 'unplayed' }, { kind: 'picked-up' }, { kind: 'did-not-finish' }, { kind: 'strokes', strokes: 1 }])('accepts explicit disposition %j', (score) => {
    expect(isHoleScore(score)).toBe(true);
  });

  function teamRound(format: TeamGameFormat = 'four-two-net', count = 4): RoundScores {
    const base = round();
    const cards = base.cards.slice(0, count).map((card): Scorecard => ({
      ...card, etag: 'fictional-card-v1', updatedAt: '2026-01-01T00:00:00Z',
      holes: card.holes.map((hole) => ({ ...hole, score: { kind: 'strokes', strokes: 4 } })),
    }));
    const players: readonly GamePlayerResult[] = cards.map((card) => ({
      playerId: card.playerId, displayName: card.displayName, playingHandicap: 0, status: 'complete',
      holes: card.holes.map((hole) => ({ number: hole.number, points: 2, strokesReceived: 0 })),
      totalHoles: 9, holesScored: 9, frontPoints: 18, backPoints: null, totalPoints: 18,
    }));
    const size = teamSize(format);
    const definition: TeamGameDefinition = {
      id: id(800), name: 'Fictional team competition', basis: 'net', format, preset: 'standard',
      handicapAllowancePercent: 100, points: stablefordPoints('standard'),
      teams: Array.from({ length: cards.length / size }, (_, index) => ({
        id: id(900 + index), name: `Fictional team ${String(index + 1)}`,
        playerIds: cards.slice(index * size, (index + 1) * size).map((card) => card.playerId),
      })),
    };
    return {
      ...base, cards, groups: [{ number: 1, playerIds: cards.map((card) => card.playerId) }],
      setupLocked: true, lastUpdatedAt: '2026-01-01T00:00:00Z',
      games: {
        configuration: { eventId: base.eventId, roundId: base.roundId, etag: 'fictional-game-v1', games: [definition] },
        results: [{ gameId: definition.id, players,
          teams: aggregateTeamGameResults(definition, players, base.layout.map((hole) => hole.number)) }],
      },
    };
  }

  describe('team projections retain raw-score consistency checks', () => {
    it.each(['two-net-better-ball', 'two-net-aggregate'] as const)('accepts one complete two-player %s team', (format) => {
      const value = teamRound(format, 2);
      expect(isRoundScores(value)).toBe(true);
      expect(value.games?.results[0]?.teams).toHaveLength(1);
    });
    it('accepts explicit non-scoring repair state for saved assignments mismatching current raw-card roster', () => {
      const value = teamRound();
      const view = value.games;
      if (!view) throw new Error('Missing fictional games');
      const configuration = { ...view.configuration, games: view.configuration.games.map((game) => ({
        ...game, teams: game.teams?.map((team) => ({
          ...team, playerIds: team.playerIds.map((playerId, index) => index !== 0 ? playerId : id(999)),
        })),
      })) };
      const results = view.results.map((result) => ({ ...result, teams: [], teamSetupRequired: true }));
      expect(isRoundScores({ ...value, games: { configuration, results } })).toBe(true);
      expect(isRoundScores({ ...value, games: { configuration, results: view.results } })).toBe(false);
      const cards = value.cards.map((card, index) => index !== 0 ? card : ({ ...card, displayName: 'Fictional changed name' }));
      expect(isRoundScores({ ...value, cards, games: { configuration, results } })).toBe(false);
    });

    it.each(['two-net-better-ball', 'two-net-aggregate', 'four-two-net'] as const)('accepts a saved %s without rewriting entered strokes or playing groups', (format) => {
      const value = teamRound(format);
      const before = structuredClone(value);
      expect(isRoundScores(value)).toBe(true);
      expect(value).toEqual(before);
      const cards = value.cards.map((card, index) => index !== 0 ? card : ({
        ...card, holes: card.holes.map((hole) => hole.number !== 1 ? hole : ({
          ...hole, score: { kind: 'strokes' as const, strokes: 5 },
        })),
      }));
      expect(isRoundScores({ ...value, cards })).toBe(false);
    });

    it('rejects tampered net components even when their team aggregate is recomputed consistently', () => {
      const value = teamRound();
      const view = value.games;
      const definition = view?.configuration.games[0];
      const result = view?.results[0];
      if (!view || !definition || definition.format === undefined || !result) throw new Error('Missing fictional game');
      const players = result.players.map((player, index) => index !== 0 ? player : ({
        ...player, frontPoints: 19, totalPoints: 19,
        holes: player.holes.map((hole) => hole.number !== 1 ? hole : ({ ...hole, points: 3 })),
      }));
      const games = {
        ...view, results: [{ ...result, players, teams: aggregateTeamGameResults(definition, players, value.layout.map((hole) => hole.number)) }],
      };
      expect(isRoundGamesView(games)).toBe(true);
      expect(isRoundScores({ ...value, games })).toBe(false);
    });

    it('requires every saved teammate hole; accepts pickup/DNF minimums and keeps blank holes pending', () => {
      const value = teamRound();
      const view = value.games;
      const definition = view?.configuration.games[0];
      const result = view?.results[0];
      if (!view || !definition || definition.format === undefined || !result) throw new Error('Missing fictional game');
      const cards = value.cards.map((card, index): Scorecard => ({
        ...card, holes: card.holes.map((hole) => hole.number !== 1 ? hole : ({
          ...hole, score: index === 0 ? { kind: 'picked-up', reportedStrokes: 7 }
            : index === 1 ? { kind: 'did-not-finish' } : index === 3 ? { kind: 'unplayed' } : hole.score,
        })),
      }));
      const players = result.players.map((player, index): GamePlayerResult => ({
        ...player, status: index === 3 ? 'in-progress' : 'complete', holesScored: index === 3 ? 8 : 9,
        frontPoints: index === 2 ? 18 : 16, totalPoints: index === 2 ? 18 : 16,
        holes: player.holes.map((hole) => hole.number !== 1 ? hole : ({
          ...hole, points: index === 3 ? null : index === 2 ? 2 : 0,
        })),
      }));
      const teams = aggregateTeamGameResults(definition, players, value.layout.map((hole) => hole.number));
      const games = { ...view, results: [{ ...result, players, teams }] };
      expect(teams[0]).toMatchObject({ status: 'in-progress', holesScored: 8, totalPoints: 32 });
      expect(isRoundScores({ ...value, cards, games })).toBe(true);
      expect(isRoundScores({ ...value, cards, games: { ...games, results: [{
        ...result, players, teams: teams.map((team) => ({ ...team, status: 'complete', holesScored: 9, frontPoints: 34,
          totalPoints: 34, holes: team.holes.map((hole) => hole.number !== 1 ? hole : ({ ...hole, points: 2 })) })),
      }] } })).toBe(false);
    });
  });
  it.each([
    null, {}, { kind: 'complete' }, { kind: 'strokes', strokes: 0 }, { kind: 'strokes', strokes: -1 },
    { kind: 'strokes', strokes: 1.5 }, { kind: 'strokes', strokes: '4' },
    { kind: 'unplayed', strokes: 0 }, { kind: 'picked-up', strokes: 5 },
    { kind: 'strokes', strokes: maximumExactHoleStrokes + 1 }, { kind: 'strokes', strokes: Number.NaN },
  ])('rejects ambiguous/unsafe score %j', (score) => { expect(isHoleScore(score)).toBe(false); });

  it('parses the organizer score shorthand without a separate disposition selector', () => {
    expect(parseScoreEntry('')).toEqual({ kind: 'unplayed' });
    expect(parseScoreEntry('   ')).toEqual({ kind: 'unplayed' });
    expect(parseScoreEntry('7')).toEqual({ kind: 'strokes', strokes: 7 });
    expect(parseScoreEntry('X')).toEqual({ kind: 'picked-up' });
    expect(parseScoreEntry(' x7 ')).toEqual({ kind: 'picked-up', reportedStrokes: 7 });
    expect(parseScoreEntry('DNF')).toEqual({ kind: 'did-not-finish' });
    for (const text of ['0', 'X0', '-1', '4.5', 'X4.5', '7X', 'NaN', 'Xfoo']) expect(parseScoreEntry(text)).toBeNull();
    expect(scoreEntryText({ kind: 'picked-up', reportedStrokes: 7 })).toBe('X7');
    expect(scoreEntryText({ kind: 'picked-up' })).toBe('X');
    expect(scoreEntryText({ kind: 'unplayed' })).toBe('');
    expect(scoreEntryText({ kind: 'strokes', strokes: 7 })).toBe('7');
    expect(isHoleScore({ kind: 'picked-up', reportedStrokes: 7 })).toBe(true);
    expect(isHoleScore({ kind: 'picked-up', reportedStrokes: 0 })).toBe(false);
    expect(isHoleScore({ kind: 'picked-up', reportedStrokes: 1.5 })).toBe(false);
    expect(isHoleScore({ kind: 'picked-up', reportedStrokes: '7' })).toBe(false);
  });

  it('accepts an unsaved virtual round but never calls numeric data an unversioned card', () => {
    const value = round();
    expect(isRoundScores(value)).toBe(true);
    expect(isRoundScores({ ...value, setupLocked: true })).toBe(false);
    expect(isRoundScores({ ...value, lastUpdatedAt: '2026-01-01T00:00:00Z' })).toBe(false);
    const first = value.cards[0];
    if (!first) throw new Error('Missing fictional card.');
    expect(isScorecard({ ...first, holes: first.holes.map((hole) => ({ ...hole, score: { kind: 'strokes', strokes: 4 } })) })).toBe(false);
    const persisted = { ...first, etag: 'card-v1', updatedAt: '2026-01-01T00:00:00Z' };
    expect(isScorecard(persisted)).toBe(true);
    expect(isScorecard({ ...persisted, etag: '*' })).toBe(false);
    expect(isScorecard({ ...persisted, updatedAt: null })).toBe(false);
    expect(isRoundScores({ ...value, cards: [persisted, ...value.cards.slice(1)] })).toBe(false);
    expect(isRoundScores({ ...value, setupLocked: true, lastUpdatedAt: persisted.updatedAt, cards: [persisted, ...value.cards.slice(1)] })).toBe(true);
  });

  it('requires complete source layout, unique cards and exactly one group assignment per golfer', () => {
    const empty = round();
    const value = {
      ...empty, setupLocked: true, lastUpdatedAt: '2026-01-01T00:00:00Z',
      cards: empty.cards.map((card, index) => index === 0 ? { ...card, etag: 'card-v2', updatedAt: '2026-01-01T00:00:00Z' } : card),
    };
    expect(isRoundScores({ ...value, cards: [...value.cards, value.cards[0]] })).toBe(false);
    expect(isRoundScores({ ...value, layout: [null, ...value.layout.slice(1)] })).toBe(false);
    expect(isRoundScores({ ...value, layout: value.layout.map((hole) => ({ ...hole, number: 1 })) })).toBe(false);
    expect(isRoundScores({ ...value, layout: value.layout.map((hole) => ({ ...hole, allocation: 1 })) })).toBe(false);
    expect(isRoundScores({ ...value, layout: value.layout.map((hole) => ({ ...hole, sourceId: 1 })) })).toBe(false);
    expect(isRoundScores({ ...value, groups: [{ number: 1, playerIds: [id(1), id(1), id(2), id(3)] }] })).toBe(false);
    expect(isRoundScores({ ...value, cards: value.cards.map((card) => ({ ...card, holes: card.holes.slice(1) })) })).toBe(false);
  });

  it('acknowledges exact audited operations independently of the current projected score', () => {
    const empty = round();
    const value = {
      ...empty, setupLocked: true, lastUpdatedAt: '2026-01-01T00:00:00Z',
      cards: empty.cards.map((card, index) => index === 0 ? { ...card, etag: 'card-v2', updatedAt: '2026-01-01T00:00:00Z' } : card),
    };
    expect(isScoreChange(change)).toBe(true);
    expect(isScoreWriteResult({ round: value, change })).toBe(true);
    expect(isScoreWriteResult({ round: value, change: { ...change, roundId: id(999) } })).toBe(false);
    expect(isScoreWriteResult({ round: value, change: { ...change, playerId: id(999) } })).toBe(false);
    expect(isScoreWriteResult({ round: value, change: { ...change, holeNumber: 18 } })).toBe(false);
    expect(isScoreChange({ ...change, after: { kind: 'strokes', strokes: 0 } })).toBe(false);
    expect(isScoreHistoryPage({ changes: [change] })).toBe(true);
    expect(isScoreHistoryPage({ changes: [change], continuationToken: 'x'.repeat(2049) })).toBe(false);
  });
});
