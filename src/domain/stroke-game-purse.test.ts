import { describe, expect, it } from 'vitest';
import { calculatePurse } from './purse.js';
import { calculateEventStandings } from './event-leaderboard.js';
import { strokeGameCards, strokeGameFixture, strokeGamesRound } from './stroke-games.test-support.js';
import { purseTestContext } from './purse.test-support.js';
import type { EventWorkspace } from './setup.js';

describe('stroke-game place awards and overall boundaries', () => {
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
