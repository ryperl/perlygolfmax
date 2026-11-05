import { describe, expect, it } from 'vitest';
import type { CourseRating } from '../domain/catalog.js';
import type { EventLeaderboardView } from '../domain/event-leaderboard.js';
import { calculateEventStandings } from '../domain/event-leaderboard.js';
import type { RoundGameDefinition, TeamGameDefinition } from '../domain/games.js';
import type { RoundScores, Scorecard } from '../domain/scoring.js';
import { maximumExactHoleStrokes } from '../domain/scoring.js';
import type { EventWorkspace, OverallCompetition, RoundSnapshot } from '../domain/setup.js';
import { calculateGameResults, stablefordPoints } from '../domain/stableford.js';
import { isRoundScores } from './scoring.js';
import { isEventWorkspace } from './setup.js';
import { isEventLeaderboardView, isEventStandings } from './event-leaderboard.js';
import { publishedPlayingHandicaps } from '../domain/playing-handicaps.js';

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
function fixture(
  count = 1, overallCompetition: OverallCompetition = { kind: 'stroke-play', basis: 'gross' },
): EventLeaderboardView {
  const players = [1, 2, 3, 4].map((number) => ({
    playerId: id(number), displayName: `Fictional golfer ${String(number)}`,
    handicapIndex: { id: id(500 + number), value: '0', effectiveDate: '2026-01-01', source: 'Fictional manual observation',
      recordedAt: '2026-01-01T00:00:00Z', recordedBy: { tenantId: id(600), objectId: id(601) }, previousObservationId: null },
  }));
  const holes = Array.from({ length: 9 }, (_, index) => ({
    number: index + 1, sourceId: 301 + index, length: 350, par: 4, allocation: index + 1,
  }));
  const ratings: readonly CourseRating[] = [
    { type: 'Total', course: 36, slope: 113, bogey: 45 },
    { type: 'Front', course: 18, slope: 113, bogey: 45 },
    { type: 'Back', course: 18, slope: 113, bogey: 45 },
  ];
  const rounds: readonly RoundSnapshot[] = Array.from({ length: count }, (_, index) => ({
    id: id(200 + index), name: `Fictional round ${String(index + 1)}`, courseId: 'ghin:801:802', courseVersionId: 'a'.repeat(64),
    course: {
      provider: 'usga-ghin', sourceId: 802, name: 'Fictional course', status: 'Active', number: null,
      city: 'Fictional city', state: 'Fictional state',
      facility: { id: 801, status: 'Active', name: 'Fictional facility', number: null, golfAssociationId: 803,
        address: 'Fictional address', longitude: 0, latitude: 0 },
      season: { name: 'All year', allYear: true, start: '01/01', end: '12/31' },
    },
    teeProfile: { id: 700, name: 'Fictional tee', category: 'Fictional category', holeCount: 9,
      totalYardage: 3150, totalMeters: 2880, totalPar: 36, strokeAllocation: true,
      shorter: null, eligibleSides: null, ratings, holes },
    groups: [{ number: 1, playerIds: players.map((player) => player.playerId) }], players,
  }));
  const workspace: EventWorkspace = {
    event: { id: id(100), name: 'Fictional Open', createdAt: '2026-01-01', role: 'owner', status: 'active', etag: 'current' },
    location: '', roster: players.map(({ playerId, displayName }) => ({ playerId, displayName })), rounds,
    etag: 'current', overallCompetition,
  };
  const roundScores = rounds.map((round): RoundScores => {
    const cards: readonly Scorecard[] = players.map((player) => ({
      playerId: player.playerId, displayName: player.displayName, etag: 'fictional-card', updatedAt: '2026-01-01T00:00:00Z',
      holes: holes.map((hole) => ({ number: hole.number, score: { kind: 'strokes', strokes: 4 } })),
    }));
    return {
      eventId: workspace.event.id, eventName: workspace.event.name, eventStatus: 'active', roundId: round.id, roundName: round.name,
      courseName: round.course.name, teeName: round.teeProfile.name, teeCategory: round.teeProfile.category, teeRatings: ratings,
      layout: holes, groups: round.groups, cards, setupLocked: true, lastUpdatedAt: '2026-01-01T00:00:00Z',
    };
  });
  return { workspace, roundScores, standings: calculateEventStandings(workspace, roundScores) };
}
function recompute(value: EventLeaderboardView): EventLeaderboardView {
  return { ...value, standings: calculateEventStandings(value.workspace, value.roundScores) };
}
function withGames(value: EventLeaderboardView, games: readonly RoundGameDefinition[]): EventLeaderboardView {
  return recompute({ ...value, roundScores: value.roundScores.map((round) => {
    const snapshot = value.workspace.rounds.find((entry) => entry.id === round.roundId);
    if (!snapshot) throw new Error('Missing fictional snapshot');
    return { ...round, games: {
      configuration: { eventId: round.eventId, roundId: round.roundId, etag: 'fictional-games', games },
      results: calculateGameResults(games, snapshot, round.cards),
    } };
  }) });
}
const game: RoundGameDefinition = {
  id: id(400), name: 'Fictional game', preset: 'standard', basis: 'net',
  handicapAllowancePercent: 95, points: stablefordPoints('standard'),
};
const stableford: OverallCompetition = { kind: 'stableford', credit: 'individual', roundGames: [{ roundId: id(200), gameId: game.id }] };

describe('authoritative event leaderboard runtime contract', () => {
  it('keeps net event results identical for an admitted reader without exposing index observations', () => {
    const f = fixture(1, { kind: 'stroke-play', basis: 'net', handicapAllowancePercent: 95 });
    const rounds = f.workspace.rounds.map((round) => ({
      ...round, players: round.players.map((player, index) => player.handicapIndex && index === 0
        ? { ...player, handicapIndex: { ...player.handicapIndex, value: '18.0' } } : player),
    }));
    const privateWorkspace = { ...f.workspace, rounds };
    const sources = f.roundScores.map((round) => {
      const snapshot = rounds.find((entry) => entry.id === round.roundId);
      if (!snapshot) throw new Error('Missing fictional round.');
      return { ...round, overallHandicaps: publishedPlayingHandicaps(snapshot, 95),
        permissions: { role: 'viewer' as const, writePlayerIds: [], canManageGames: false } };
    });
    const workspace: EventWorkspace = { ...privateWorkspace, event: { ...privateWorkspace.event, role: 'member' },
      canViewScores: true, rounds: rounds.map((round) => ({
        ...round, players: round.players.map(({ handicapIndex: omitted, ...player }) => {
          void omitted;
          return player;
        }),
      })) };
    const visible = { workspace, roundScores: sources, standings: calculateEventStandings(workspace, sources) };
    expect(visible.standings).toEqual(calculateEventStandings(privateWorkspace, sources));
    expect(visible.standings.players[0]).toMatchObject({ subtotal: 27, relativeToPar: -9, rank: 1 });
    expect(JSON.stringify(visible)).not.toContain('handicapIndex');
    expect(isEventLeaderboardView(visible)).toBe(true);
    expect(isEventLeaderboardView({ ...visible, workspace: { ...workspace, rounds } })).toBe(false);
    expect(isEventLeaderboardView({ ...visible, workspace: { ...workspace, canViewScores: false } })).toBe(false);
    expect(isEventLeaderboardView({ ...visible, roundScores: sources.map((round) => ({
      ...round, permissions: { role: 'owner', writePlayerIds: round.cards.map((card) => card.playerId), canManageGames: true },
    })) })).toBe(false);
  });
  it('does not trust an owner-projection playing-handicap map that contradicts captured inputs', () => {
    const f = fixture(1, { kind: 'stroke-play', basis: 'net', handicapAllowancePercent: 95 });
    const source = f.roundScores[0];
    if (!source) throw new Error('Missing fictional source.');
    const altered = { ...source, overallHandicaps: { allowancePercent: 95,
      players: source.cards.map((card) => ({ playerId: card.playerId, playingHandicap: 18 })) } };
    expect(isEventLeaderboardView({ ...f, roundScores: [altered] })).toBe(false);
  });
  it('accepts disabled legacy projections only with no score data and empty disabled standings', () => {
    const f = fixture();
    const { overallCompetition: omitted, ...workspace } = f.workspace;
    expect(omitted).toBeDefined();
    const disabled = { workspace, roundScores: [], standings: calculateEventStandings(workspace, []) };
    expect(isEventLeaderboardView(disabled)).toBe(true);
    expect(isEventLeaderboardView({ ...disabled, roundScores: f.roundScores })).toBe(false);
    expect(isEventLeaderboardView({ ...disabled, standings: f.standings })).toBe(false);
    expect(isEventLeaderboardView({ ...disabled, workspace: { ...workspace, overallCompetition: null } })).toBe(false);
  });

  it.each([0, 1, 3, 8])('validates every current round and roster without hardcoded round columns (%s)', (count) => {
    const f = fixture(count);
    const before = structuredClone(f);
    expect(isEventWorkspace(f.workspace)).toBe(true);
    expect(f.roundScores.every(isRoundScores)).toBe(true);
    expect(isEventLeaderboardView(f)).toBe(true);
    expect(isEventLeaderboardView({ ...f, roundScores: [...f.roundScores].reverse() })).toBe(true);
    expect(f).toEqual(before);
  });

  it('requires exactly one score projection per current round and rejects duplicate/foreign score rounds', () => {
    const f = fixture(3);
    expect(isEventLeaderboardView({ ...f, roundScores: [] })).toBe(false);
    expect(isEventLeaderboardView({ ...f, roundScores: f.roundScores.slice(1) })).toBe(false);
    expect(isEventLeaderboardView({ ...f, roundScores: [...f.roundScores, f.roundScores[0]] })).toBe(false);
    expect(isEventLeaderboardView({ ...f, roundScores: f.roundScores.map((round) =>
      ({ ...round, roundId: id(999) })) })).toBe(false);
  });

  it.each([
    ['eventId', id(999)], ['eventName', 'Fictional impostor'], ['eventStatus', 'archived'],
    ['roundName', 'Fictional impostor'], ['courseName', 'Fictional impostor'], ['teeName', 'Fictional impostor'],
    ['teeCategory', 'Fictional impostor'],
  ])('rejects a valid raw projection with a mismatched %s context', (field, changed) => {
    const f = fixture();
    const roundScores = f.roundScores.map((round) => ({ ...round, [field]: changed }));
    expect(roundScores.every(isRoundScores)).toBe(true);
    expect(isEventLeaderboardView({ ...f, roundScores })).toBe(false);
  });

  it('rejects tampered layouts, ratings, player identities/names and groups even with recalculated standings', () => {
    const f = fixture();
    const variants: readonly RoundScores[][] = [
      f.roundScores.map((round) => ({ ...round, layout: round.layout.map((hole) =>
        hole.number === 1 ? { ...hole, par: 3 } : hole) })),
      f.roundScores.map((round) => ({ ...round, layout: round.layout.map((hole) => ({ ...hole, length: 351 })) })),
      f.roundScores.map((round) => ({ ...round, layout: round.layout.map((hole) => ({ ...hole, sourceId: hole.sourceId + 100 })) })),
      f.roundScores.map((round) => {
        if (!round.teeRatings) throw new Error('Missing fictional ratings');
        return { ...round, teeRatings: round.teeRatings.map((rating) => ({ ...rating, slope: 114 })) };
      }),
      f.roundScores.map((round) => ({ ...round, cards: round.cards.map((card, index) =>
        index === 0 ? { ...card, displayName: 'Fictional impostor' } : card) })),
      f.roundScores.map((round) => ({ ...round,
        cards: round.cards.map((card, index) => index === 0 ? { ...card, playerId: id(999) } : card),
        groups: round.groups.map((group) => ({ ...group, playerIds: group.playerIds.map((playerId) => playerId === id(1) ? id(999) : playerId) })),
      })),
      f.roundScores.map((round) => ({ ...round, groups: [{ number: 2, playerIds: round.cards.map((card) => card.playerId) }] })),
    ];
    for (const roundScores of variants) {
      expect(roundScores.every(isRoundScores)).toBe(true);
      expect(isEventLeaderboardView(recompute({ ...f, roundScores }))).toBe(false);
    }
  });

  it('strictly verifies all new result keys, totals, progress, membership, shared ranks and ordering', () => {
    const f = fixture();
    expect(isEventStandings(f.standings, f.workspace, f.roundScores)).toBe(true);
    for (const standings of [
      { ...f.standings, extra: true }, { ...f.standings, status: 'disabled' },
      { ...f.standings, staleRoundIds: [id(999)] }, { ...f.standings, players: [] },
      { ...f.standings, players: [...f.standings.players].reverse() },
      ...[
        { subtotal: 0 }, { relativeToPar: 1 }, { holesScored: 0 }, { totalHoles: 18 },
        { rank: 2 }, { rankLabel: '1' }, { playerId: id(999) }, { displayName: 'Fictional impostor' },
        { status: 'unavailable' }, { reason: 'missing-game' }, { extra: true },
      ].map((patch) => ({ ...f.standings, players: f.standings.players.map((player, index) => index === 0 ? { ...player, ...patch } : player) })),
      { ...f.standings, rounds: f.standings.rounds.map((round) => ({ ...round, extra: true })) },
      { ...f.standings, players: f.standings.players.map((player) => ({
        ...player, cells: player.cells.map((cell) => ({ ...cell, subtotal: 999 })),
      })) },
    ]) expect(isEventLeaderboardView({ ...f, standings })).toBe(false);
    expect(isEventLeaderboardView({ ...f, extra: true })).toBe(false);
    for (const value of [null, [], {}, false, { workspace: null, roundScores: [], standings: {} }]) {
      expect(isEventLeaderboardView(value)).toBe(false);
    }
    const reordered = { roundScores: f.roundScores, standings: f.standings, workspace: f.workspace };
    expect(isEventLeaderboardView(reordered)).toBe(true);
  });

  it('allows optional no-games projections as explicitly unavailable, never as invented zero-point standings', () => {
    const f = fixture(1, stableford);
    expect(f.standings.players[0]).toMatchObject({ reason: 'missing-game', subtotal: null, rank: null });
    expect(isEventLeaderboardView(f)).toBe(true);
    const unbound = recompute({ ...f, workspace: { ...f.workspace,
      overallCompetition: { kind: 'stableford', credit: 'individual', roundGames: [] } } });
    expect(unbound.standings.players[0]).toMatchObject({ status: 'not-configured', rank: null });
    expect(isEventLeaderboardView(unbound)).toBe(true);
    const valid = withGames(f, [game]);
    expect(isEventLeaderboardView(valid)).toBe(true);
  });

  it('recomputes game results against captured handicap metadata, not just self-consistent forged game totals', () => {
    const f = withGames(fixture(1, stableford), [game]);
    const roundScores = f.roundScores.map((round) => {
      const snapshot = f.workspace.rounds.find((entry) => entry.id === round.roundId);
      if (!snapshot || !round.games) throw new Error('Missing fictional round');
      const forged = { ...snapshot, players: snapshot.players.map((player) => ({
        ...player, handicapIndex: player.handicapIndex == null ? null : { ...player.handicapIndex, value: '20' },
      })) };
      return { ...round, games: { ...round.games, results: calculateGameResults([game], forged, round.cards) } };
    });
    expect(roundScores.every(isRoundScores)).toBe(true);
    expect(isEventLeaderboardView(recompute({ ...f, roundScores }))).toBe(false);
  });

  it('accepts missing net metadata as unavailable, not zero, and keeps raw-card checks intact', () => {
    const f = fixture(1, { kind: 'stroke-play', basis: 'net', handicapAllowancePercent: 95 });
    const workspace: EventWorkspace = { ...f.workspace,
      rounds: f.workspace.rounds.map((round) => ({ ...round, players: round.players.map((player) => ({ ...player, handicapIndex: null })) })) };
    const missing = recompute({ ...f, workspace });
    expect(missing.standings.players[0]).toMatchObject({ reason: 'missing-handicap-index', rank: null, subtotal: null });
    expect(isEventLeaderboardView(missing)).toBe(true);
    expect(isEventLeaderboardView(recompute({ ...missing, roundScores: missing.roundScores.map((round) => ({
      ...round, cards: round.cards.map((card) => ({ ...card, holes: card.holes.slice(1) })),
    })) }))).toBe(false);
    const optionalRatings = recompute({ ...missing, roundScores: missing.roundScores.map((round) => {
      const { teeRatings: omitted, ...projection } = round;
      expect(omitted).toBeDefined();
      return projection;
    }) });
    expect(isEventLeaderboardView(optionalRatings)).toBe(true);
  });

  it('validates both credit policies including stale team setup without an individual competition fallback', () => {
    const team: TeamGameDefinition = { ...game, basis: 'net', handicapAllowancePercent: 100, format: 'two-net-aggregate',
      teams: [{ id: id(800), name: 'Fictional A', playerIds: [id(1), id(2)] },
        { id: id(801), name: 'Fictional B', playerIds: [id(3), id(4)] }] };
    for (const credit of ['individual', 'team'] as const) {
      const f = fixture(1, { kind: 'stableford', credit, roundGames: [{ roundId: id(200), gameId: game.id }] });
      const valid = withGames(f, [team]);
      expect(valid.standings.players[0]?.subtotal).toBe(credit === 'team' ? 36 : 18);
      expect(isEventLeaderboardView(valid)).toBe(true);
      const stale = withGames(f, [{ ...team, teams: team.teams.map((entry, index) => index === 0
        ? { ...entry, playerIds: [id(999), id(2)] } : entry) }]);
      expect(stale.standings.players[0]).toMatchObject({ reason: 'team-setup-required', rank: null });
      expect(isEventLeaderboardView(stale)).toBe(true);
    }
  });

  it('accepts explicit arithmetic-range results without accepting rounded, capped or tampered totals', () => {
    const f = fixture(8);
    const roundScores = f.roundScores.map((round) => ({ ...round, cards: round.cards.map((card) => ({
      ...card, holes: card.holes.map((hole) => ({ ...hole, score: { kind: 'strokes' as const, strokes: maximumExactHoleStrokes } })),
    })) }));
    const value = recompute({ ...f, roundScores });
    expect(value.standings.players[0]).toMatchObject({ reason: 'arithmetic-range', subtotal: null, rank: null });
    expect(isEventLeaderboardView(value)).toBe(true);
    expect(isEventLeaderboardView({ ...value, standings: { ...value.standings,
      players: value.standings.players.map((player) => ({ ...player, subtotal: Number.MAX_SAFE_INTEGER })) } })).toBe(false);
  });
});
