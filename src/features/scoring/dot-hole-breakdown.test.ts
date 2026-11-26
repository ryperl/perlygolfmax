import { describe, expect, it } from 'vitest';
import { calculateGameResults } from '../../domain/stableford';
import { matchGamesFixture } from '../../domain/match-games.test-support';
import { churchyFixture } from '../../domain/churchy.test-support';
import { churchyV3Fixture } from '../../domain/churchy-v3.test-support';
import { calculateInternalGameResults } from '../../domain/internal-games';
import type { RoundGameScoringContext } from '../../domain/game-declarations';
import type { DotsGameDefinition } from '../../domain/dots';
import type { Scorecard } from '../../domain/scoring';
import { scorecardGame } from './scorecard-presentation';
import { dotHoleBreakdown } from './dot-hole-breakdown';

function requireIds(ids: readonly string[]) {
  const [a, b] = ids;
  if (!a || !b) throw new Error('Missing fictional players');
  return { a, b };
}

/**
 * Fictional Modified Sixes v3 with net High/Low over 18 par-4 holes and zero handicaps. On hole 1 the first
 * pair (3, 3) beats the second (4, 4) in both lanes, so each winner earns High, Low and the High/Low Sweep.
 * The first golfer also claims one Sandy there.
 */
function rotatingHighLowFixture() {
  const f = matchGamesFixture();
  const { a } = requireIds(f.ids);
  const game: DotsGameDefinition = { id: f.wolf.id, name: 'Fictional Modified Sixes', kind: 'dots', version: 3,
    mode: 'rotating', rotationHoles: 3, orderMode: 'tee-flip', groupNumber: 1, playerIds: f.ids,
    specials: [{ kind: 'sandy', units: 1 }], stakeMinor: null, highLow: { version: 2, handicapRule: 'full-course-v1' } };
  const layout = f.snapshot.teeProfile.holes.map((hole, index) => ({ ...hole, par: 4, allocation: index + 1 }));
  const cards: readonly Scorecard[] = f.cards.map((card, index) => ({ ...card, holes: layout.map((hole) => {
    const firstHole = card.playerId === a && hole.number === 1;
    const dots = [{ number: 1, gameId: game.id, gameEtag: 'fictional-game-revision', rotation: { playerIds: f.ids },
      contests: [], players: [{ playerId: a, counts: { sandy: 1 }, calls: [] }] }];
    return { number: hole.number, score: { kind: 'strokes' as const, strokes: index < 2 ? 3 : 4,
      ...(firstHole ? { dots } : {}) } };
  }) }));
  const context: RoundGameScoringContext = { ...f.round(cards, [game]), layout, cards, teeStrokeAllocation: true,
    groups: [{ number: 1, playerIds: f.ids, startingHole: 1 }],
    courseHandicaps: f.ids.map((playerId) => ({ playerId, courseHandicap: 0 })) };
  const result = calculateInternalGameResults([game], context).get(game.id);
  return { ...f, game, cards, result };
}

describe('saved per-hole dot breakdown', () => {
  it('separates earned Wolf base from explicitly linked Dots and attributes shared source awards', () => {
    const f = matchGamesFixture();
    const { a, b } = requireIds(f.ids);
    const wolf = { ...f.wolf, version: 2 as const, stakeMinor: null };
    const dots: DotsGameDefinition = { id: f.nassau.id, name: 'Fictional Dots', kind: 'dots', version: 1,
      mode: 'linked', linkedGameId: wolf.id, groupNumber: 1, playerIds: f.ids, specials: [{ kind: 'sandy', units: 1 }] };
    // The first golfer partners the second on hole 1 and claims two Sandys; the pair wins the hole.
    const cards = f.cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => ({ ...hole,
      score: { kind: 'strokes' as const, strokes: index < 2 ? 3 : 4, ...(card.playerId === a && hole.number === 1 ? {
        wolf: [{ number: 1, choice: { gameId: wolf.id, gameEtag: 'fictional-game-revision', mode: 'partner' as const, partnerId: b } }],
        dots: [{ number: 1, gameId: dots.id, gameEtag: 'fictional-game-revision', contests: [],
          players: [{ playerId: a, counts: { sandy: 2 }, calls: [] }] }],
      } : {}) },
    })) }));
    const round = f.round(cards, [wolf, dots]);
    const linked = scorecardGame(round, dots.id);
    if (!linked) throw new Error('Missing fictional linked game');
    const detail = dotHoleBreakdown(linked, b, 1, cards);
    expect(detail).toMatchObject({ status: 'complete', base: 2, specials: 2, total: 4 });
    expect(detail.entries).toContainEqual({ label: 'Sandy', dots: 2, source: cards[0]?.displayName, lane: 'specials' });

    const standalone: DotsGameDefinition = { id: dots.id, name: dots.name, kind: 'dots', version: 1, mode: 'individual',
      groupNumber: 1, playerIds: f.ids, specials: dots.specials, stakeMinor: null };
    const result = calculateGameResults([standalone], f.snapshot, cards)[0];
    expect(dotHoleBreakdown({ definition: standalone, result }, a, 1, cards)).toMatchObject({ base: 0, specials: 2, total: 2 });

    const withoutBase = { definition: dots, result: linked.result };
    expect(dotHoleBreakdown(withoutBase, b, 1, cards)).toMatchObject({ status: 'unavailable', total: null });
  });

  it('counts rotating net High/Low and its Sweep as base so the breakdown matches the combined cell', () => {
    const f = rotatingHighLowFixture();
    const { a, b } = requireIds(f.ids);
    const cell = f.result?.players.find((player) => player.playerId === a)?.holes.find((hole) => hole.number === 1);
    const detail = dotHoleBreakdown({ definition: f.game, result: f.result }, a, 1, f.cards);
    expect(detail).toMatchObject({ status: 'complete', base: 3, specials: 1, total: 4 });
    expect(detail.total).toBe(cell?.points);
    expect(detail.context).toContain('Net High/Low + specials');
    expect(detail.entries.filter((entry) => entry.lane === 'base').map((entry) => entry.label))
      .toEqual(['Net High', 'Net Low', 'High/Low Sweep']);

    // The partner shares the Sandy with its named source but not as their own claim.
    const partner = dotHoleBreakdown({ definition: f.game, result: f.result }, b, 1, f.cards);
    expect(partner).toMatchObject({ status: 'complete', base: 3, specials: 1, total: 4 });
    expect(partner.entries).toContainEqual({ label: 'Sandy', dots: 1, source: f.cards[0]?.displayName, lane: 'specials' });
  });

  it('names manual and automatic Sweep awards apart', () => {
    const f = rotatingHighLowFixture();
    const { a } = requireIds(f.ids);
    const saved = f.result;
    const dots = saved?.dots;
    const sandy = dots?.holes.find((hole) => hole.number === 1)?.awards[0];
    if (!saved || !dots || !sandy) throw new Error('Missing fictional Sandy award');
    // Reuse the saved Sandy as a template for one scorer-declared and one derived Sweep on the same hole.
    const sweeps = [{ ...sandy, kind: 'sweep' as const, source: 'manual' as const },
      { ...sandy, kind: 'sweep' as const, source: 'derived' as const }];
    const holes = dots.holes.map((hole) => hole.number === 1 ? { ...hole, awards: [...hole.awards, ...sweeps] } : hole);
    const result = { ...saved, dots: { ...dots, holes } };
    const detail = dotHoleBreakdown({ definition: f.game, result }, a, 1, f.cards);
    expect(detail.entries.filter((entry) => entry.lane === 'specials').map((entry) => entry.label))
      .toEqual(['Sandy', 'Manual Sweep', 'High/Low Sweep']);
  });

  it('refuses a rotating High/Low breakdown when the High/Low results are missing', () => {
    const f = rotatingHighLowFixture();
    const { a } = requireIds(f.ids);
    if (!f.result) throw new Error('Missing fictional result');
    const { dotsHighLow, ...specialsOnly } = f.result;
    expect(dotsHighLow).toBeDefined();
    expect(dotHoleBreakdown({ definition: f.game, result: specialsOnly }, a, 1, f.cards))
      .toMatchObject({ status: 'unavailable', base: null, specials: null, total: null });
  });

  it.each([1, 2, 3] as const)('supports Churchie v%i without exposing private audit identity', (version) => {
    const f = churchyFixture();
    const modern = churchyV3Fixture(18, 1, 'tee');
    const game = version === 3 ? modern.game : version === 2 ? { ...f.game, version: 2 as const,
      enabledSpecials: ['sandy', 'birdie', 'sweep'] as const } : f.game;
    const snapshot = version === 3 ? modern.snapshot : f.snapshot;
    const cards = version === 3 ? modern.cards : f.cards;
    const result = calculateGameResults([game], snapshot, cards)[0];
    const id = game.playerIds[0];
    if (!id) throw new Error('Missing fictional golfer');
    const detail = dotHoleBreakdown({ definition: game, result }, id, 1, cards);
    expect(detail.status).toBe('complete');
    expect(detail.base).not.toBeNull();
    expect(detail.specials).not.toBeNull();
    expect(detail.total).toBe((detail.base ?? 0) + (detail.specials ?? 0));
    expect(JSON.stringify(detail)).not.toMatch(/recordedBy|tenantId|objectId|gameEtag/);
  });

  it('marks a failed Churchie v3 call that awarded the opponents, but not their own calls or a Walk', () => {
    const modern = churchyV3Fixture(18, 1, 'tee');
    const result = calculateGameResults([modern.game], modern.snapshot, modern.cards)[0];
    const [a, b, c] = modern.game.playerIds;
    if (!result?.churchy || !a || !b || !c) throw new Error('Missing fictional Churchie results');
    // Churchie v3 saves every award as made; the opposing caller's failed Murphy went to a and b.
    const specials = [
      { special: 'Murphy', playerId: c, outcome: 'made' as const, winners: [a, b], dots: 1 },
      { special: 'Paree', playerId: a, outcome: 'made' as const, winners: [a, b], dots: 1 },
      { special: 'Walk', playerId: c, outcome: 'made' as const, winners: [a, b], dots: 1 },
    ];
    const holes = result.churchy.holes.map((hole) => hole.number === 1 ? { ...hole, specials } : hole);
    const game = { definition: modern.game, result: { ...result, churchy: { ...result.churchy, holes } } };
    const detail = dotHoleBreakdown(game, a, 1, modern.cards);
    expect(detail.entries.filter((entry) => entry.lane === 'specials').map((entry) => entry.label))
      .toEqual(['Murphy · missed call', 'Paree', 'Walk']);
  });

  it('preserves legacy signed Wolf transfers, known zero and pending or missing results', () => {
    const f = matchGamesFixture();
    const { a, b } = requireIds(f.ids);
    const cards = f.cards.map((card) => ({ ...card, holes: card.holes.map((hole) => ({ ...hole,
      score: { ...hole.score, ...(card.playerId === a && hole.number === 1 ? { wolf: [{
        number: 1, choice: { gameId: f.wolf.id, gameEtag: 'fictional-game-revision', mode: 'partner' as const, partnerId: b },
        outcome: 'opponents' as const,
      }] } : {}) },
    })) }));
    const round = f.round(cards, [f.wolf]);
    const game = { definition: f.wolf, result: round.games?.results[0] };
    expect(dotHoleBreakdown(game, a, 1, cards)).toMatchObject({ base: -2, specials: 0, total: -2 });
    expect(dotHoleBreakdown(game, a, 2, cards)).toMatchObject({ status: 'pending', base: null, total: null });
    expect(dotHoleBreakdown({ definition: f.wolf, result: undefined }, a, 1, cards))
      .toMatchObject({ status: 'unavailable', total: null });
  });

  it.each(['blind', 'pig'] as const)('names %s Wolf awards and refuses mismatched saved totals', (mode) => {
    const f = matchGamesFixture();
    const { a } = requireIds(f.ids);
    const wolf = { ...f.wolf, version: 2 as const, stakeMinor: null, allowPig: true };
    const cards = f.cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => ({ ...hole,
      score: { kind: 'strokes' as const, strokes: index === 0 ? 3 : 5,
        ...(card.playerId === a && hole.number === 1 ? { wolf: [{
          number: 1, choice: { gameId: wolf.id, gameEtag: 'fictional-game-revision', mode },
        }] } : {}),
      },
    })) }));
    const result = calculateGameResults([wolf], f.snapshot, cards)[0];
    if (!result?.wolf) throw new Error('Missing fictional Wolf results');
    const detail = dotHoleBreakdown({ definition: wolf, result }, a, 1, cards);
    expect(detail).toMatchObject({ status: 'complete', base: mode === 'pig' ? 3 : 2, specials: 0 });
    expect(detail.entries.map((entry) => entry.label)).toEqual([mode === 'pig' ? 'PIG' : 'Blind Wolf']);
    // Bump every saved transfer by one so the listed awards no longer add up to the saved total.
    const inconsistent = { ...result, wolf: { ...result.wolf, holes: result.wolf.holes.map((hole) => ({
      ...hole, transfers: hole.transfers.map((entry) => ({ ...entry, dots: entry.dots + 1 })),
    })) } };
    expect(dotHoleBreakdown({ definition: wolf, result: inconsistent }, a, 1, cards))
      .toMatchObject({ status: 'unavailable', base: null, specials: null, total: null });
  });
});
