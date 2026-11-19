import { describe, expect, it } from 'vitest';
import { calculatePurse } from './purse.js';
import { calculateEventStandings } from './event-leaderboard.js';
import { strokeGameCards, strokeGameFixture, strokeGamesRound } from './stroke-games.test-support.js';
import { purseTestContext } from './purse.test-support.js';
import type { EventWorkspace } from './setup.js';
import type { StrokePlayGameDefinition } from './games.js';
import { calculateGameResults } from './stableford.js';
import { matchGamesFixture } from './match-games.test-support.js';
import type { DotsGameDefinition } from './dots.js';

describe('stroke-game place awards and overall boundaries', () => {
  it('recalculates String-funded place prizes and invalidates a manual resolution whose tied set changed', () => {
    const f = matchGamesFixture();
    const game: DotsGameDefinition = { id: f.wolf.id, name: 'Fictional String', kind: 'dots', version: 1,
      mode: 'individual', stakeMinor: null, groupNumber: 1, playerIds: f.ids, specials: [{ kind: 'string', units: 1 }] };
    const cards = f.cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => ({ ...hole,
      score: { kind: 'strokes' as const, strokes: index === 0 && hole.number === 2 ? 3 : 4 },
    })) }));
    const current = { ...f.round(cards, [game]), stringRulesVersion: 2 as const };
    const legacy = { ...current, games: { configuration: current.games?.configuration ?? {
      eventId: current.eventId, roundId: current.roundId, games: [game], etag: null },
      results: calculateGameResults([game], f.snapshot, cards, 1) } };
    const base = purseTestContext();
    const workspace: EventWorkspace = { ...base.workspace, event: { ...base.workspace.event, id: current.eventId },
      rounds: [f.snapshot], roster: f.snapshot.players };
    const pool = { ...base.pool, source: { kind: 'round-game' as const, roundId: current.roundId, gameId: game.id },
      awardUnit: 'per-golfer' as const, tiePolicy: 'organizer' as const, prizes: [{ place: 1, amountMinor: 100 }] };
    const plan = { ...base.plan, eventId: current.eventId, pools: [pool] };
    const resolutions = [{ poolId: pool.id, rank: 1, orderedEntrantIds: f.ids.slice(1) }];
    expect(calculatePurse(plan, workspace, [legacy], resolutions).issues).toEqual([]);
    const changed = calculatePurse(plan, workspace, [current], resolutions);
    expect(changed.issues).toContainEqual({ code: 'invalid-resolution', poolId: pool.id });
    expect(changed.pools[0]?.shares).toEqual([]);
    const pooled = calculatePurse({ ...plan, pools: [{ ...pool, tiePolicy: 'pooled' }] }, workspace, [current]);
    expect(pooled.pools[0]?.shares.map((share) => share.amountMinor)).toEqual([25, 25, 25, 25]);
  });
  it('uses only the selected Wolf foursome for explicit place prizes, never dot-difference cash settlement or Nassau bets', () => {
    const f = matchGamesFixture(8);
    const cards = f.cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => index === 0 && hole.number === 1
      ? { ...hole, score: { ...hole.score, wolf: [{ number: 1, choice: {
        gameId: f.wolf.id, gameEtag: 'fictional-game-revision', mode: 'blind' as const }, outcome: 'wolf' as const }] } } : hole) }));
    const round = f.round(cards);
    const base = purseTestContext();
    const workspace: EventWorkspace = { ...base.workspace, event: { ...base.workspace.event, id: round.eventId },
      rounds: [f.snapshot], roster: f.snapshot.players };
    const pool = { ...base.pool, source: { kind: 'round-game' as const, roundId: round.roundId, gameId: f.wolf.id },
      awardUnit: 'per-golfer' as const, prizes: [{ place: 1, amountMinor: 100 }] };
    const result = calculatePurse({ ...base.plan, eventId: round.eventId, pools: [pool] }, workspace, [round]).pools[0];
    expect(result?.status).toBe('projected');
    expect(result?.shares.map((share) => [share.playerId, share.amountMinor])).toEqual([[f.wolf.playerIds[0], 100]]);
    const blocked = calculatePurse({ ...base.plan, eventId: round.eventId,
      pools: [{ ...pool, source: { ...pool.source, gameId: f.nassau.id } }] }, workspace, [round]).pools[0];
    expect(blocked?.status).toBe('unavailable');
    expect(blocked?.shares).toEqual([]);
    const match = { ...f.nassau, kind: 'match-play' as const, name: 'Fictional Match Play',
      stakes: { ...f.nassau.stakes, frontMinor: 0, backMinor: 0 } };
    const matchRound = f.round(cards, [match]);
    const matchPool = calculatePurse({ ...base.plan, eventId: round.eventId,
      pools: [{ ...pool, source: { ...pool.source, gameId: match.id } }] }, workspace, [matchRound]).pools[0];
    expect(matchPool?.status).toBe('unavailable');
    expect(matchPool?.shares).toEqual([]);
  });
  it('awards Stroke Play places by personal relative-to-par, preserves ties, and blocks invalid stroke cards', () => {
    const f = strokeGameFixture();
    const game: StrokePlayGameDefinition = {
      id: f.skins.id, name: 'Fictional Stroke Play', kind: 'stroke-play', version: 1, basis: 'gross',
    };
    const snapshot = { ...f.snapshot, playerTees: [{ playerId: f.cards[0]?.playerId ?? '', profile: {
      ...f.snapshot.teeProfile, totalPar: 45, holes: f.snapshot.teeProfile.holes.map((hole) => ({ ...hole, par: 5 })),
    } }] };
    const cards = f.cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: { kind: 'strokes' as const, strokes: index === 0 ? 5 : 4 },
    })) }));
    const baseRound = strokeGamesRound({ ...f, snapshot, cards });
    if (!baseRound.games) throw new Error('Missing fictional games');
    const round = { ...baseRound, games: { configuration: { ...baseRound.games.configuration, games: [game] },
      results: calculateGameResults([game], snapshot, cards) } };
    const base = purseTestContext();
    const workspace: EventWorkspace = { ...base.workspace, event: { ...base.workspace.event, id: round.eventId },
      overallCompetition: { kind: 'stableford', credit: 'individual', roundGames: [{ roundId: round.roundId, gameId: game.id }] },
      rounds: [snapshot], roster: snapshot.players };
    const plan = { ...base.plan, eventId: round.eventId, pools: [{ ...base.pool,
      source: { kind: 'round-game' as const, roundId: round.roundId, gameId: game.id },
      prizes: [{ place: 1, amountMinor: 100 }] }] };
    const result = calculatePurse(plan, workspace, [round]);
    expect(result.pools[0]?.status).toBe('calculated');
    expect(result.pools[0]?.shares.map((share) => share.amountMinor)).toEqual([25, 25, 25, 25]);
    expect(calculateEventStandings(workspace, [round]).players.every((player) => player.reason === 'missing-game')).toBe(true);
    const invalidCards = strokeGameCards(cards, 1, [{ kind: 'picked-up', reportedStrokes: 7 }]);
    const invalid = { ...round, cards: invalidCards, games: { ...round.games,
      results: calculateGameResults([game], snapshot, invalidCards) } };
    const blocked = calculatePurse(plan, workspace, [invalid]).pools[0];
    expect(blocked?.status).toBe('unavailable');
    expect(blocked?.shares).toEqual([]);
  });
  it.each(['ball-drop', 'skins'] as const)('ranks %s metrics without fictitious points and attributes foursome prizes to members', (kind) => {
    const f = strokeGameFixture(9, 8);
    const cards = f.cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: { kind: 'strokes' as const, strokes: index < 4 ? 5 : index === 4 ? 3 : 4 },
    })) }));
    const round = strokeGamesRound({ ...f, cards });
    const base = purseTestContext();
    const workspace: EventWorkspace = { ...base.workspace, event: { ...base.workspace.event, id: round.eventId },
      rounds: [f.snapshot], roster: f.snapshot.players };
    const game = kind === 'ball-drop' ? f.ballDrop : f.skins;
    const pool = { ...base.pool, source: { kind: 'round-game' as const, roundId: round.roundId, gameId: game.id },
      awardUnit: kind === 'ball-drop' ? 'per-team' as const : 'per-golfer' as const,
      prizes: [{ place: 1, amountMinor: 100 }] };
    const result = calculatePurse({ ...base.plan, eventId: round.eventId, pools: [pool] }, workspace, [round]);
    expect(result.pools[0]?.status).toBe('calculated');
    const shares = result.pools[0]?.shares ?? [];
    expect(shares.map((share) => share.playerId)).toEqual(kind === 'ball-drop'
      ? f.cards.slice(4).map((card) => card.playerId) : [f.cards[4]?.playerId]);
    expect(shares.every((share) => share.amountMinor === (kind === 'ball-drop' ? 25 : 100))).toBe(true);
    const pending = strokeGamesRound({ ...f, cards: strokeGameCards(cards, 1, [{ kind: 'unplayed' }]) });
    expect(calculatePurse({ ...base.plan, eventId: round.eventId, pools: [pool] }, workspace, [pending]).pools[0]?.status).toBe('projected');
    const overall = calculateEventStandings({ ...workspace, overallCompetition: {
      kind: 'stableford', credit: 'team', roundGames: [{ roundId: round.roundId, gameId: game.id }],
    } }, [round]);
    expect(overall.players.every((player) => player.rank === null && player.reason === 'missing-game')).toBe(true);
  });
});
