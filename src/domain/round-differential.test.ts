import { describe, expect, it } from 'vitest';
import type { TeeProfile } from './catalog.js';
import { calculateRoundDifferentials } from './round-differential.js';
import type { HoleScore, Scorecard } from './scoring.js';
import { maximumExactHoleStrokes } from './scoring.js';
import type { RoundSnapshot } from './setup.js';
import { strokeGameFixture } from './stroke-games.test-support.js';

function fixture() {
  return strokeGameFixture(18, 1);
}

function withIndex(snapshot: RoundSnapshot, index: string | null): RoundSnapshot {
  return { ...snapshot, players: snapshot.players.map((player) => ({
    ...player, handicapIndex: index === null ? null : player.handicapIndex ? { ...player.handicapIndex, value: index } : null,
  })) };
}

function withRatings(snapshot: RoundSnapshot, course: number, slope = 113): RoundSnapshot {
  return { ...snapshot, teeProfile: { ...snapshot.teeProfile, ratings: [{ type: 'Total', course, slope, bogey: 90 }] } };
}

function scores(cards: readonly Scorecard[], score: (number: number) => HoleScore): readonly Scorecard[] {
  return cards.map((card) => ({ ...card, holes: card.holes.map((hole) => ({ ...hole, score: score(hole.number) })) }));
}

function result(snapshot: RoundSnapshot, cards: readonly Scorecard[]) {
  const row = calculateRoundDifferentials(snapshot, cards)[0];
  if (!row) throw new Error('Missing fictional differential');
  return row;
}

describe('estimated 18-hole round differentials', () => {
  it('corrects the screenshot: AGS 88, rating 72, slope 130, PCC 0 is 13.9, never 14.1', () => {
    const f = fixture();
    const snapshot = withRatings(f.snapshot, 72, 130);
    const cards = scores(f.cards, (number) => ({ kind: 'strokes', strokes: number <= 16 ? 5 : 4 }));
    expect(result(snapshot, cards)).toEqual({
      playerId: f.snapshot.players[0]?.playerId, method: 'estimated-18-hole', pcc: 0,
      status: 'available', differentialTenths: 139, adjustedGross: 88,
    });
  });

  it.each([
    [70.46, 15], [70.45, 16], [70.44, 16],
    [73.54, -15], [73.55, -15], [73.56, -16],
    [72.05, 0], [72.049, 0], [72.051, -1],
  ])('rounds rating %s exactly to %s tenths, including negative USGA boundaries', (rating, expected) => {
    const f = fixture();
    const row = result(withRatings(f.snapshot, rating), f.cards);
    expect(row.status).toBe('available');
    expect(row.differentialTenths).toBe(expected);
    expect(Object.is(row.differentialTenths, -0)).toBe(false);
  });

  it('caps at net double bogey using full captured CH 20, not a game allowance', () => {
    const f = fixture();
    const snapshot = withIndex(f.snapshot, '20.0');
    const cards = scores(f.cards, () => ({ kind: 'strokes', strokes: 12 }));
    expect(result(snapshot, cards)).toMatchObject({ status: 'available', adjustedGross: 128, differentialTenths: 560 });
    const allowanceBasedGross = 127; // A 95% Playing Handicap of 19 would incorrectly cap one more stroke.
    expect(result(snapshot, cards).adjustedGross).not.toBe(allowanceBasedGross);
  });

  it.each([['0', 108], ['+2.0', 106], ['54.0', 162]])(
    'keeps scratch/plus/high index %s distinct and applies the correct caps', (index, expected) => {
      const f = fixture();
      const row = result(withIndex(f.snapshot, index), scores(f.cards, () => ({ kind: 'strokes', strokes: 20 })));
      expect(row).toMatchObject({ status: 'available', adjustedGross: expected });
    },
  );

  it('applies the modern par-plus-five ceiling when full CH exceeds 54', () => {
    const f = fixture();
    const snapshot = withRatings(withIndex(f.snapshot, '54.0'), 72, 155);
    expect(result(snapshot, scores(f.cards, () => ({ kind: 'strokes', strokes: 20 }))))
      .toMatchObject({ status: 'available', adjustedGross: 162, differentialTenths: 656 });
  });

  it('uses each captured personal tee rating, par and allocation and leaves raw inputs untouched', () => {
    const f = fixture();
    const playerId = f.snapshot.players[0]?.playerId;
    if (!playerId) throw new Error('Missing fictional player');
    const personal: TeeProfile = { ...f.snapshot.teeProfile, id: 301, totalPar: 73,
      ratings: [{ type: 'Total', course: 74, slope: 120, bogey: 93 }],
      holes: f.snapshot.teeProfile.holes.map((hole) => ({
        ...hole, par: hole.number === 1 ? 5 : 4, allocation: 19 - hole.number,
      })) };
    const snapshot = { ...withIndex(f.snapshot, '18.0'), playerTees: [{ playerId, profile: personal }] };
    const cards = scores(f.cards, (number) => ({ kind: 'strokes', strokes: number === 1 || number === 17 ? 20 : 4 }));
    const before = structuredClone({ snapshot, cards });
    expect(result(snapshot, cards)).toMatchObject({ status: 'available', adjustedGross: 80, differentialTenths: 57 });
    expect({ snapshot, cards }).toEqual(before);
  });

  it('prefers the captured observation over a different scalar and supports scalar-only captured projections', () => {
    const f = fixture();
    const cards = scores(f.cards, () => ({ kind: 'strokes', strokes: 20 }));
    const snapshot = { ...f.snapshot, players: f.snapshot.players.map((player) => ({ ...player, handicapIndexValue: '20' })) };
    expect(result(snapshot, cards).adjustedGross).toBe(108);
    const projected = { ...snapshot, players: snapshot.players.map((player) => ({
      playerId: player.playerId, displayName: player.displayName, handicapIndexValue: player.handicapIndexValue,
    })) };
    expect(result(projected, cards).adjustedGross).toBe(128);
  });

  it.each(['missing', 'blank', 'absent-card'] as const)('leaves %s scores pending, without a partial adjusted gross', (kind) => {
    const f = fixture();
    const cards = kind === 'absent-card' ? [] : kind === 'blank'
      ? scores(f.cards, (number) => number === 18 ? { kind: 'unplayed' } : { kind: 'strokes', strokes: 4 })
      : f.cards.map((card) => ({ ...card, holes: card.holes.filter((hole) => hole.number !== 18) }));
    expect(result(f.snapshot, cards)).toMatchObject({
      status: 'pending', reason: 'incomplete-card', adjustedGross: null, differentialTenths: null,
    });
  });

  it.each<HoleScore>([{ kind: 'picked-up' }, { kind: 'picked-up', reportedStrokes: 7 }, { kind: 'did-not-finish' }])(
    'never converts disposition %j into a numeric differential, even alongside missing scores', (score) => {
      const f = fixture();
      const cards = scores(f.cards, (number) => number === 1 ? score : number === 2 ? { kind: 'unplayed' } : { kind: 'strokes', strokes: 4 });
      expect(result(f.snapshot, cards)).toMatchObject({
        status: 'unavailable', reason: 'non-numeric-score', differentialTenths: null, adjustedGross: null,
      });
    },
  );

  it('does not double a nine-hole score or invent a WHS expected component', () => {
    const f = strokeGameFixture(9, 1);
    expect(result(f.snapshot, f.cards)).toMatchObject({ status: 'unavailable', reason: 'unsupported-hole-count' });
  });

  it.each([null, 'invalid'] as const)('does not treat index %s as scratch', (index) => {
    const f = fixture();
    expect(result(withIndex(f.snapshot, index), f.cards)).toMatchObject({
      status: 'unavailable', reason: index === null ? 'missing-handicap-index' : 'invalid-handicap-index',
    });
  });

  it('distinguishes an uncaptured index from explicit NH', () => {
    const f = fixture();
    const snapshot = { ...f.snapshot, players: f.snapshot.players.map((player) => ({
      playerId: player.playerId, displayName: player.displayName,
    })) };
    expect(result(snapshot, f.cards)).toMatchObject({ status: 'unavailable', reason: 'uncaptured-handicap-index' });
  });

  it.each([0, NaN, Infinity, 301])('rejects invalid slope %s instead of using 113', (slope) => {
    const f = fixture();
    expect(result(withRatings(f.snapshot, 72, slope), f.cards)).toMatchObject({
      status: 'unavailable', reason: 'missing-tee-ratings',
    });
  });

  it('does not fall back to common ratings or allocations when the personal tee lacks them', () => {
    const f = fixture();
    const playerId = f.snapshot.players[0]?.playerId;
    if (!playerId) throw new Error('Missing fictional player');
    const snapshot = { ...f.snapshot, playerTees: [{ playerId, profile: { ...f.snapshot.teeProfile, ratings: [] } }] };
    expect(result(snapshot, f.cards)).toMatchObject({ reason: 'missing-tee-ratings', status: 'unavailable' });
    const unallocated = { ...snapshot, playerTees: [{ playerId, profile: { ...f.snapshot.teeProfile, strokeAllocation: false } }] };
    expect(result(unallocated, f.cards)).toMatchObject({ reason: 'missing-stroke-index', status: 'unavailable' });
  });

  it('rejects duplicate allocations, layouts, ratings and personal tee assignments', () => {
    const f = fixture();
    const duplicateAllocations = { ...f.snapshot, teeProfile: { ...f.snapshot.teeProfile,
      holes: f.snapshot.teeProfile.holes.map((hole) => ({ ...hole, allocation: 1 })) } };
    expect(result(duplicateAllocations, f.cards)).toMatchObject({ reason: 'missing-stroke-index' });
    const duplicateHoles = { ...f.snapshot, teeProfile: { ...f.snapshot.teeProfile,
      holes: f.snapshot.teeProfile.holes.map((hole) => ({ ...hole, number: 1 })) } };
    expect(result(duplicateHoles, f.cards)).toMatchObject({ reason: 'invalid-tee-layout' });
    const duplicateRatings = { ...f.snapshot, teeProfile: { ...f.snapshot.teeProfile,
      ratings: [...f.snapshot.teeProfile.ratings, ...f.snapshot.teeProfile.ratings] } };
    expect(result(duplicateRatings, f.cards)).toMatchObject({ reason: 'missing-tee-ratings' });
    const playerId = f.snapshot.players[0]?.playerId;
    if (!playerId) throw new Error('Missing fictional player');
    const assignment = { playerId, profile: f.snapshot.teeProfile };
    expect(result({ ...f.snapshot, playerTees: [assignment, assignment] }, f.cards)).toMatchObject({ reason: 'invalid-tee-layout' });
  });

  it('rejects duplicate cards and duplicate/foreign score holes instead of selecting an arbitrary input', () => {
    const f = fixture();
    expect(result(f.snapshot, [...f.cards, ...f.cards])).toMatchObject({ reason: 'invalid-score-data' });
    expect(result(f.snapshot, f.cards.map((card) => ({ ...card, holes: [...card.holes, ...card.holes] }))))
      .toMatchObject({ reason: 'invalid-score-data' });
    expect(result(f.snapshot, f.cards.map((card) => ({ ...card, holes: [...card.holes, { number: 19, score: { kind: 'unplayed' } }] }))))
      .toMatchObject({ reason: 'invalid-score-data' });
  });

  it.each([0, -1, 4.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, maximumExactHoleStrokes + 1])(
    'does not silently cap unsafe or invalid raw strokes %s into a valid estimate', (strokes) => {
      const f = fixture();
      expect(result(f.snapshot, scores(f.cards, () => ({ kind: 'strokes', strokes }))))
        .toMatchObject({ status: 'unavailable', reason: 'arithmetic-range' });
    },
  );

  it('handles the largest supported raw strokes exactly before adjustment and never invents a nonpositive plus cap', () => {
    const f = fixture();
    expect(result(f.snapshot, scores(f.cards, () => ({ kind: 'strokes', strokes: maximumExactHoleStrokes }))))
      .toMatchObject({ status: 'available', adjustedGross: 108 });
    expect(result(withIndex(f.snapshot, '+99.9'), f.cards))
      .toMatchObject({ status: 'unavailable', reason: 'arithmetic-range' });
  });

  it('returns every roster golfer in saved order, including pending and NH, with an allowlisted result only', () => {
    const f = strokeGameFixture(18, 3);
    const snapshot = { ...f.snapshot, players: f.snapshot.players.map((player, index) => ({
      ...player, handicapIndex: index === 2 ? null : player.handicapIndex,
    })) };
    const cards = f.cards.filter((_, index) => index !== 1);
    const rows = calculateRoundDifferentials(snapshot, cards);
    expect(rows.map((row) => row.playerId)).toEqual(snapshot.players.map((player) => player.playerId));
    expect(rows.map((row) => row.status)).toEqual(['available', 'pending', 'unavailable']);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual([
      'adjustedGross', 'differentialTenths', 'method', 'pcc', 'playerId', 'status',
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/recordedBy|observation|tenantId|objectId|displayName|etag|updatedAt/);
  });
});
