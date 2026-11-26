import { describe, expect, it } from 'vitest';
import type { DotsGameDefinition } from './dots.js';
import type { RoundGameDefinition } from './games.js';
import { calculateInternalSettlements } from './internal-games.js';
import { linkedNinesGame, ninesLinkSpecialsSupported } from './linked-dots.js';
import { matchGamesFixture } from './match-games.test-support.js';
import type { NinesGameDefinition } from './nines.js';
import type { HoleScore, Scorecard } from './scoring.js';
import { strokeGameId } from './stroke-games.test-support.js';

/**
 * Three golfers shooting par (4) on every hole, so Nines splits every hole 3/3/3 (54 points each
 * over 18 holes). Golfer A declares 2 Sandies on hole 1 and a Walk on hole 2, recorded on the
 * group's first card as score entry does.
 */
function fixture(specials: DotsGameDefinition['specials'] = [{ kind: 'sandy', units: 1 }, { kind: 'walk', units: 1 }]) {
  const f = matchGamesFixture(3);
  const [a = '', b = '', c = ''] = f.ids;
  const nines: NinesGameDefinition = { id: strokeGameId(1500), name: 'Nines', kind: 'nines', version: 1,
    basis: 'gross', groupNumber: 1, playerIds: [a, b, c], stakeMinor: 100 };
  const dots: DotsGameDefinition = { id: strokeGameId(1600), name: 'Dots', kind: 'dots', version: 1,
    groupNumber: 1, playerIds: [a, b, c], mode: 'linked', linkedGameId: nines.id, specials };
  const declaration = (number: number, counts: Record<string, number>) => [{ number, gameId: dots.id,
    gameEtag: 'fictional-game-revision', players: [{ playerId: a, counts, calls: [] }], contests: [] }];
  const cards = f.cards.map((card): Scorecard => ({ ...card, holes: card.holes.map((hole) => {
    if (card.playerId !== a || hole.number > 2) return hole;
    const counts = hole.number === 1 ? { sandy: 2 } : { walk: 1 };
    return { ...hole, score: { ...hole.score, dots: declaration(hole.number, counts) } as HoleScore };
  }) }));
  function settle(games: readonly RoundGameDefinition[]) {
    const round = f.round(cards, games);
    return { round, settlements: calculateInternalSettlements(games, round.games?.results ?? [], round) };
  }
  return { ...f, a, b, c, nines, dots, cards, settle };
}

describe('Dots linked to Nines', () => {
  it('plays every golfer alone: a Walk pays both opponents, and each special pays only its earner', () => {
    const f = fixture();
    const { round } = f.settle([f.nines, f.dots]);
    const result = round.games?.results.find((entry) => entry.gameId === f.dots.id);
    const walk = result?.dots?.awards.find((award) => award.kind === 'walk');
    expect(walk?.recipientIds).toEqual([f.b, f.c]);
    const sandy = result?.dots?.awards.find((award) => award.kind === 'sandy');
    expect(sandy?.recipientIds).toEqual([f.a]);
    expect(result?.dots?.players.map((player) => player.totalPoints)).toEqual([2, 1, 1]);
  });

  it('settles once at the Nines stake: Nines points plus Dots specials', () => {
    const f = fixture();
    const { settlements } = f.settle([f.nines, f.dots]);
    expect(settlements).toHaveLength(1);
    const settlement = settlements[0];
    expect(settlement?.gameIds).toEqual([f.nines.id, f.dots.id]);
    expect(settlement?.stakeMinor).toBe(100);
    // Totals 54+2, 54+1, 54+1 = 56 / 55 / 55; each nets (3 x total - 166) x $1.
    expect(settlement?.players.map((player) => [player.baseDots, player.specialDots, player.totalDots]))
      .toEqual([[54, 2, 56], [54, 1, 55], [54, 1, 55]]);
    expect(settlement?.players.map((player) => player.netMinor)).toEqual([200, -100, -100]);
    expect(settlement?.status).toBe('complete');
  });

  it('Nines without a linked Dots game settles exactly as before', () => {
    const f = fixture();
    const settlement = f.settle([f.nines]).settlements[0];
    expect(settlement?.gameIds).toEqual([f.nines.id]);
    expect(settlement?.players.map((player) => player.specialDots)).toEqual([0, 0, 0]);
  });

  it('refuses specials that need partners or Wolf, and never settles an invalid link', () => {
    const f = fixture();
    expect(ninesLinkSpecialsSupported(f.dots)).toBe(true);
    expect(ninesLinkSpecialsSupported({ ...f.dots, specials: [{ kind: 'assassin', units: 1 }] })).toBe(false);
    expect(ninesLinkSpecialsSupported({ ...f.dots, specials: [{ kind: 'sweep', units: 1 }] })).toBe(false);
    expect(ninesLinkSpecialsSupported({ ...f.dots, specials: [{ kind: 'sweep', units: 1 }], sweepRule: 'manual-v1' })).toBe(true);
    const assassin = { ...f.dots, specials: [{ kind: 'assassin' as const, units: 1 }] };
    expect(linkedNinesGame(assassin, [f.nines, assassin], f.snapshot.groups)).toBeUndefined();
    expect(f.settle([f.nines, assassin]).settlements[0]?.status).toBe('unavailable');
  });

  it('a duplicated link or a changed group leaves the combined settlement unavailable', () => {
    const f = fixture();
    const second = { ...f.dots, id: strokeGameId(1601), name: 'Second Dots' };
    expect(f.settle([f.nines, f.dots, second]).settlements.find((entry) => entry.gameIds[0] === f.nines.id)?.status)
      .toBe('unavailable');
    const otherGroup = [{ number: 1, playerIds: [f.a, f.b] }, { number: 2, playerIds: [f.c] }];
    expect(linkedNinesGame(f.dots, [f.nines, f.dots], otherGroup)).toBeUndefined();
  });
});
