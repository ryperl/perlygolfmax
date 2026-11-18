import { describe, expect, it } from 'vitest';
import { calculateGameResults } from './stableford.js';
import { churchyV3Context, churchyV3RecordsMatchGame } from './churchy.js';
import { churchyV3CategoryFixture, churchyV3Fixture } from './churchy-v3.test-support.js';
import { preserveScoreExtras, supportsDotsSpecials } from './scoring.js';
import { strokeGameCards, strokeGameId } from './stroke-games.test-support.js';

describe('Churchie v3 actual playing circuit and canonical shared specials', () => {
  it('carries KP and Blue Plate independently to their next eligible holes and credits both current teammates in full', () => {
    const f = churchyV3Fixture(9), [a, b, c, d] = f.ids;
    if (!a || !b || !c || !d) throw new Error('Missing fictional foursome');
    const par3s = [1, 4, 7], par5s = [2, 5, 8];
    const snapshot = { ...f.snapshot, teeProfile: { ...f.snapshot.teeProfile,
      holes: f.snapshot.teeProfile.holes.map((hole) => ({ ...hole, par: par3s.includes(hole.number) ? 3 : par5s.includes(hole.number) ? 5 : 4 })) } };
    const cards = f.cards.map((card, index) => index ? card : { ...card,
      holes: card.holes.map((hole) => ({ ...hole, score: { kind: 'strokes' as const, strokes: 4,
        ...(par3s.includes(hole.number) || par5s.includes(hole.number) ? {
          churchy: { ...f.declaration(hole.number, hole.number === 1 ? f.ids : undefined), contests: [
            hole.number === 4 ? { kind: 'kp' as const, status: 'awarded' as const, winnerId: a }
              : hole.number === 8 ? { kind: 'blue-plate' as const, status: 'awarded' as const, winnerId: b }
                : { kind: par3s.includes(hole.number) ? 'kp' as const : 'blue-plate' as const, status: 'no-qualifier' as const },
          ] },
        } : {}) } })) });
    const game = { ...f.game, specials: [{ kind: 'kp' as const, units: 1 }, { kind: 'blue-plate' as const, units: 1 }] };
    const result = calculateGameResults([game], snapshot, cards)[0]?.churchy;
    expect(result?.status).toBe('complete');
    const categories = result?.awards?.filter((award) => award.kind === 'kp' || award.kind === 'blue-plate');
    expect(categories).toEqual([
      expect.objectContaining({ kind: 'kp', number: 4, earnedBy: a, count: 2, units: 1, dots: 2,
        sourceHoles: [1, 4], recipientIds: [a, c] }),
      expect.objectContaining({ kind: 'blue-plate', number: 8, earnedBy: b, count: 3, units: 1, dots: 3,
        sourceHoles: [2, 5, 8], recipientIds: [a, b] }),
    ]);
    expect(categories?.some((award) => award.number === 3 || award.number === 6 || award.number === 9)).toBe(false);
    expect(categories?.some((award) => award.kind === 'kp' && award.recipientIds.includes(d))).toBe(false);
    expect(result?.internalSettlement?.players.map((player) => player.specialDots)).toEqual([5, 3, 2, 0]);
    const missingDecision = cards.map((card, index) => index ? card : { ...card,
      holes: card.holes.map((hole) => hole.number === 1 && hole.score.churchy
        ? { ...hole, score: { ...hole.score, churchy: { ...hole.score.churchy, contests: [] } } } : hole) });
    const pending = calculateGameResults([game], snapshot, missingDecision)[0]?.churchy;
    expect(pending?.status).toBe('in-progress');
    expect(pending?.awards?.some((award) => award.kind === 'kp')).toBe(false);
    expect(pending?.awards?.filter((award) => award.kind === 'blue-plate')).toEqual([
      expect.objectContaining({ number: 8, dots: 3, recipientIds: [a, b] }),
    ]);
  });

  it.each([[3, 'kp'], [5, 'blue-plate'], [5, 'long-drive']] as const)(
    'uses captured default par %i for %s while keeping the first golfer’s personal par for Birdie', (par, category) => {
      const f = churchyV3CategoryFixture(par, 4, category);
      const result = f.view.games?.results[0]?.churchy;
      expect(result?.status).toBe('complete');
      expect(result?.awards).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: category, dots: 2, recipientIds: [f.ids[0], f.ids[3]] }),
        expect.objectContaining({ kind: 'birdie', dots: 3, earnedBy: f.ids[0] }),
      ]));
      expect(result?.awards?.find((award) => award.kind === 'birdie')?.scores)
        .toContainEqual({ playerId: f.ids[0], number: 1, par: 4, strokes: 3 });
    });

  it.each([[3, 'kp'], [5, 'blue-plate'], [5, 'long-drive']] as const)(
    'does not let the first golfer’s personal par %i open %s on a default par-4 hole', (par, category) => {
      const f = churchyV3CategoryFixture(4, par, category);
      expect(f.view.games?.results[0]?.churchy?.status).toBe('unavailable');
      expect(f.view.games?.results[0]?.churchy?.awards?.some((award) => award.kind === category)).toBe(false);
    });

  it('requires explicit Dots Other capability while retaining the legacy kind fallback and explicit allowlists', () => {
    expect(supportsDotsSpecials({}, [{ kind: 'dime', units: 1 }])).toBe(true);
    expect(supportsDotsSpecials({}, [{ kind: 'other', units: 1 }])).toBe(false);
    expect(supportsDotsSpecials({ dotsSpecialKinds: ['other'] }, [{ kind: 'other', units: 1 }])).toBe(true);
    expect(supportsDotsSpecials({ dotsSpecialKinds: ['other'] }, [{ kind: 'dime', units: 1 }])).toBe(false);
    expect(supportsDotsSpecials({ dotsSpecialKinds: [] }, [{ kind: 'other', units: 1 }])).toBe(false);
  });
  it.each([[18, 1], [18, 10], [18, 7], [9, 1], [9, 7]] as const)(
    'rotates rank order 14/23,13/24,12/34 in three-hole blocks on %i holes starting %i', (count, start) => {
      const f = churchyV3Fixture(count, start);
      const result = calculateGameResults([f.game], f.snapshot, f.cards)[0]?.churchy;
      const [a, b, c, d] = f.ids;
      expect(result?.holes.map((hole) => hole.number)).toEqual([
        ...Array.from({ length: count - start + 1 }, (_, index) => index + start),
        ...Array.from({ length: start - 1 }, (_, index) => index + 1),
      ]);
      for (let index = 0; index < count; index++) {
        expect(result?.holes[index]?.pairs).toEqual(Math.floor(index / 3) % 3 === 0
          ? [[a, d], [b, c]] : Math.floor(index / 3) % 3 === 1 ? [[a, c], [b, d]] : [[a, b], [c, d]]);
        expect(result?.holes[index]?.stake).toBe(index % 3 + 1);
      }
      expect(result?.status).toBe('complete');
    });

  it('keeps raw scores while rank order is missing, never inferring pairs, awards or money', () => {
    const f = churchyV3Fixture();
    const cards = f.cards.map((card) => ({ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: { kind: 'strokes' as const, strokes: 4 },
    })) }));
    const result = calculateGameResults([f.game], f.snapshot, cards)[0];
    expect(result?.churchy?.status).toBe('in-progress');
    expect(result?.churchy?.holes.every((hole) => hole.pairs.length === 0 && hole.awards.every((award) => award.dots === null))).toBe(true);
    expect(result?.churchy?.internalSettlement?.players.every((player) => player.netMinor === null)).toBe(true);
    expect(result?.players.every((player) => player.holesScored === 18)).toBe(true);
  });

  it('uses the explicit saved tee order immediately without a second order receipt', () => {
    const f = churchyV3Fixture(18, 10, 'tee');
    const record = f.declaration(10);
    const cards = strokeGameCards(f.cards, 10, [{ kind: 'strokes', strokes: 4, churchy: record }]);
    const result = calculateGameResults([f.game], f.snapshot, cards)[0]?.churchy;
    expect(result?.order).toEqual({ playerIds: f.ids });
    expect(result?.holes[0]?.pairs).toEqual([[f.ids[0], f.ids[3]], [f.ids[1], f.ids[2]]]);
    expect(result?.status).toBe('complete');
    expect(churchyV3RecordsMatchGame([f.declaration(10, [...f.ids].reverse())], f.game,
      { layout: f.snapshot.teeProfile.holes, groups: f.snapshot.groups, cards })).toBe(false);
  });

  it('accepts a manually tie-broken rank, rejects missing/duplicate/foreign IDs and nonstarting receipt holes', () => {
    const f = churchyV3Fixture(18, 10);
    const round = { layout: f.snapshot.teeProfile.holes, cards: f.cards, groups: f.snapshot.groups };
    const order = [...f.ids].reverse();
    expect(churchyV3RecordsMatchGame([f.declaration(10, order)], f.game, round)).toBe(true);
    expect(churchyV3Context(f.game, round, [f.declaration(10, order)]).contexts[0]?.sides)
      .toEqual([[order[0], order[3]], [order[1], order[2]]]);
    for (const invalid of [f.ids.slice(1), [f.ids[0] ?? '', f.ids[0] ?? '', ...f.ids.slice(2)],
      [...f.ids.slice(0, 3), strokeGameId(999)]]) {
      expect(churchyV3RecordsMatchGame([f.declaration(10, invalid)], f.game, round)).toBe(false);
    }
    expect(churchyV3RecordsMatchGame([f.declaration(11, f.ids)], f.game, round)).toBe(false);
    expect(churchyV3RecordsMatchGame([f.declaration(10, f.ids), f.declaration(11, f.ids)], f.game, round)).toBe(false);
  });

  it('uses shared units/exclusions, par-or-better Sandys, Sticky=Dime, current stake Sweep and Murphy stages', () => {
    const f = churchyV3Fixture(9);
    const first = f.ids[0] ?? '';
    const declaration = { ...f.declaration(2), players: [{ playerId: first, counts: { sandy: 2, other: 3 }, calls: [
      { id: strokeGameId(950), kind: 'murphy' as const, result: 'success' as const, murphyPresses: 2 as const },
    ] }] };
    const cards = strokeGameCards(f.cards, 2, [
      { kind: 'strokes', strokes: 3, churchy: declaration }, { kind: 'strokes', strokes: 5 },
      { kind: 'strokes', strokes: 6 }, { kind: 'strokes', strokes: 4 },
    ]);
    const game = { ...f.game, specials: [{ kind: 'sandy' as const, units: 2 }, { kind: 'murphy' as const, units: 4 },
      { kind: 'sweep' as const, units: 3 }, { kind: 'other' as const, units: 2 }] };
    const result = calculateGameResults([game], f.snapshot, cards)[0]?.churchy;
    expect(result?.holes[1]?.specials).toEqual(expect.arrayContaining([
      expect.objectContaining({ special: 'Sandy', dots: 4, winners: [first, f.ids[3]] }),
      expect.objectContaining({ special: 'Murphy', dots: 12 }),
      expect.objectContaining({ special: 'Other', dots: 6 }),
      expect.objectContaining({ special: 'Sweep', dots: 6 }),
    ]));
    const alias = strokeGameCards(f.cards, 1, [{ kind: 'strokes', strokes: 4, churchy: {
      ...f.declaration(1, f.ids), players: [{ playerId: first, counts: { dime: 1 }, calls: [] }],
    } }]);
    expect(calculateGameResults([f.game], f.snapshot, alias)[0]?.churchy?.holes[0]?.specials
      .filter((award) => award.special === 'Sticky')).toHaveLength(1);
    const conflict = { ...f.declaration(1, f.ids), players: [{ playerId: first, counts: { pully: 1, dime: 1 }, calls: [] }] };
    expect(churchyV3RecordsMatchGame([conflict], f.game, { layout: f.snapshot.teeProfile.holes,
      groups: f.snapshot.groups, cards: f.cards })).toBe(false);
  });

  it('keeps saved orders/origin immutable through raw-only edits and clears', () => {
    const f = churchyV3Fixture();
    const saved = { kind: 'strokes' as const, strokes: 4, churchy: {
      ...f.declaration(1, f.ids), rotation: { playerIds: f.ids, recordedLate: true as const },
    } };
    expect(preserveScoreExtras({ kind: 'unplayed' }, saved).churchy).toEqual(saved.churchy);
    expect(preserveScoreExtras({ kind: 'strokes', strokes: 5, churchy: f.declaration() }, saved).churchy?.version).toBe(3);
    expect(preserveScoreExtras({ kind: 'strokes', strokes: 5, churchy: f.declaration() }, saved).churchy)
      .toEqual(saved.churchy);
    expect(() => preserveScoreExtras({ kind: 'unplayed', churchy: f.declaration(1, [...f.ids].reverse()) }, saved))
      .toThrow('cannot be replaced');
  });

  it('keeps High/Low pickup comparisons and exact zero-sum settlement separate from earned source dots', () => {
    const f = churchyV3Fixture(9);
    const cards = strokeGameCards(f.cards, 1, [
      { kind: 'picked-up', churchy: f.declaration(1, f.ids) }, { kind: 'strokes', strokes: 5 },
      { kind: 'strokes', strokes: 6 }, { kind: 'strokes', strokes: 3 },
    ]);
    const result = calculateGameResults([{ ...f.game, specials: [] }], f.snapshot, cards)[0]?.churchy;
    expect(result?.holes[0]?.high.winners).toEqual([f.ids[1], f.ids[2]]);
    expect(result?.holes[0]?.low.winners).toEqual([f.ids[0], f.ids[3]]);
    expect(result?.internalSettlement?.players.reduce((total, player) => total + (player.netMinor ?? 0), 0)).toBe(0);
    expect(result?.internalSettlement?.players.every((player) => player.specialDots === 0)).toBe(true);
  });

  it('keeps missing personal inputs and overflowing shared awards unavailable instead of inventing scratch or money', () => {
    const f = churchyV3Fixture(9);
    const score = { kind: 'strokes' as const, strokes: 4, churchy: { ...f.declaration(1, f.ids),
      players: [{ playerId: f.ids[0] ?? '', counts: { dime: 1, other: 1 }, calls: [] }] } };
    const cards = strokeGameCards(f.cards, 1, [score]);
    const game = { ...f.game, specials: [{ kind: 'dime' as const, units: Number.MAX_SAFE_INTEGER },
      { kind: 'other' as const, units: 1 }] };
    const result = calculateGameResults([game], f.snapshot, cards)[0];
    expect(result?.churchy?.status).toBe('unavailable');
    expect(result?.players[0]?.totalPoints).toBeNull();
    expect(result?.churchy?.internalSettlement?.players.every((player) => player.netMinor === null)).toBe(true);
    const missing = { ...f.snapshot, players: f.snapshot.players.map((player, index) =>
      index ? player : { ...player, handicapIndex: null }) };
    const unavailable = calculateGameResults([f.game], missing, f.cards)[0];
    expect(unavailable?.churchy?.status).toBe('unavailable');
    expect(unavailable?.players[0]?.playingHandicap).toBeNull();
  });
});
