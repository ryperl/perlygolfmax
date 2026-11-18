import { describe, expect, it } from 'vitest';
import { calculateDots, dotsFirstPlayedHole, dotsRecordsMatchGame, dotsRotationContext } from './dots.js';
import type { DotsGameDefinition, DotsHoleRecord } from './dots.js';
import type { DotRoundInput } from './dot-context.js';
import { sameGameDefinitions } from './games.js';

const ids = ['A', 'B', 'C', 'D'];
function fixture(rotationHoles: 3 | 6 = 3, startingHole = 1) {
  const game: DotsGameDefinition = { id: 'dots-A', name: 'Fictional rotating Dots', kind: 'dots', version: 2,
    mode: 'rotating', rotationHoles, playerIds: ['D', 'C', 'B', 'A'], groupNumber: 1,
    specials: [{ kind: 'sandy', units: 1 }], stakeMinor: 100 };
  const layout = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, sourceId: i + 1, allocation: i + 1, length: 300 }));
  const round: DotRoundInput = { layout, groups: [{ number: 1, playerIds: ids, startingHole }],
    cards: ids.map((playerId) => ({ playerId, displayName: playerId, etag: null, updatedAt: null,
      holes: layout.map(({ number }) => ({ number, score: { kind: 'strokes', strokes: 4 } })) })) };
  const record: DotsHoleRecord = { number: startingHole, gameId: game.id, gameEtag: 'fictional-revision',
    players: [], contests: [], rotation: { playerIds: ids } };
  return { game, round, record };
}
const pairs = [[['A', 'B'], ['C', 'D']], [['A', 'C'], ['B', 'D']], [['A', 'D'], ['B', 'C']]];

describe('saved rotating Dots contexts', () => {
  it.each([3, 6] as const)('uses explicit P1–P4, %i-hole blocks and x1, never participant-set order', (size) => {
    const { game, round, record } = fixture(size);
    const rotation = dotsRotationContext(game, round, [record]);
    expect(rotation.firstHole).toBe(1);
    expect(rotation.rotation).toEqual({ playerIds: ids });
    expect(rotation.contexts).toHaveLength(18);
    for (const [index, context] of rotation.contexts.entries()) {
      expect(context).toMatchObject({ number: index + 1, status: 'ready', multiplier: 1,
        sides: pairs[Math.floor(index / size) % 3] });
    }
  });

  it('wraps the actual shotgun circuit and shares new awards without reassigning earlier teammates', () => {
    const { game, round, record } = fixture(3, 16);
    const records = [record, ...[16, 1, 4, 7].map((number): DotsHoleRecord => ({
      number, gameId: game.id, gameEtag: record.gameEtag, contests: [],
      players: [{ playerId: 'A', counts: { sandy: 1 }, calls: [] }],
      ...(number === 16 ? { rotation: { playerIds: ids } } : {}),
    }))].slice(1);
    const result = calculateDots(game, round, records);
    expect(result.status).toBe('complete');
    expect(result.holes.map((hole) => hole.number)).toEqual([16, 17, 18, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(result.awards.map((award) => [award.number, award.recipientIds])).toEqual([
      [16, ['A', 'B']], [1, ['A', 'C']], [4, ['A', 'D']], [7, ['A', 'B']],
    ]);
    expect(result.players.map((player) => [player.playerId, player.totalPoints])).toEqual([['D', 1], ['C', 1], ['B', 2], ['A', 4]]);
  });

  it('keeps absent order pending with no fixed fallback or invented zero awards', () => {
    const { game, round } = fixture();
    const records: readonly DotsHoleRecord[] = [{ number: 1, gameId: game.id, gameEtag: 'fictional-revision',
      players: [{ playerId: 'A', counts: { sandy: 1 }, calls: [] }], contests: [] }];
    const result = calculateDots(game, round, records);
    expect(result.status).toBe('in-progress');
    expect(result.awards).toEqual([]);
    expect(result.players.every((player) => player.totalPoints === null)).toBe(true);
    expect(result.rotation?.contexts.every((context) => context.status === 'pending' && context.sides.length === 0)).toBe(true);
  });

  it('finds the first actually played circuit hole, previews a draft origin, and freezes acknowledged origins', () => {
    const { game, round, record } = fixture(3, 16);
    const empty: DotRoundInput = { ...round, cards: round.cards.map((card) => ({ ...card,
      holes: card.holes.map((hole) => ({ ...hole, score: { kind: 'unplayed' } })) })) };
    expect(dotsFirstPlayedHole(empty, 1)).toBeNull();
    expect(dotsRotationContext(game, empty, []).firstHole).toBeNull();
    const staged = { ...record, number: 18 };
    expect(dotsRotationContext(game, empty, [staged])).toMatchObject({ firstHole: 18,
      contexts: [{ number: 18, sides: pairs[0] }, ...Array.from({ length: 17 }, () => ({}))] });
    const played: DotRoundInput = { ...empty, cards: empty.cards.map((card) => ({ ...card,
      holes: card.holes.map((hole) => hole.number === 18 || hole.number === 2
        ? { ...hole, score: { kind: 'picked-up' } } : hole) })) };
    expect(dotsFirstPlayedHole(played, 1)).toBe(18);
    expect(dotsRotationContext(game, played, []).firstHole).toBe(18);
    expect(dotsRotationContext(game, round, [staged]).firstHole).toBe(18);
    expect(dotsRotationContext(game, empty, [{ ...staged, rotation: { playerIds: ids, recordedLate: true } }]).rotation?.recordedLate).toBe(true);
  });

  it('rejects duplicate, outside-layout and mismatched receipts rather than guessing partners', () => {
    const { game, round, record } = fixture();
    for (const records of [
      [record, { ...record, number: 2 }],
      [{ ...record, number: 19 }],
      [{ ...record, rotation: { playerIds: ['A', 'A', 'C', 'D'] } }],
      [{ ...record, rotation: { playerIds: ['A', 'B', 'C', 'other-group'] } }],
    ]) {
      expect(dotsRecordsMatchGame(records, game, round)).toBe(false);
      expect(calculateDots(game, round, records).status).toBe('unavailable');
    }
    const legacy: DotsGameDefinition = { id: game.id, name: game.name, kind: 'dots', version: 1, mode: 'individual',
      playerIds: ids, groupNumber: 1, specials: [], stakeMinor: null };
    expect(dotsRecordsMatchGame([record], legacy, round)).toBe(false);
    expect(sameGameDefinitions([game], [{ ...game, rotationHoles: 6 as const }])).toBe(false);
    expect(sameGameDefinitions([game], [legacy])).toBe(false);
  });

  it('keeps strict v2 source exclusions, legal teammate sharing, Assassin and exact overflow handling', () => {
    const { game, round, record } = fixture();
    const specials: DotsGameDefinition = { ...game, specials: [{ kind: 'hogan', units: 1 }, { kind: 'seve', units: 1 }] };
    const shared = { ...record, players: [
      { playerId: 'A', counts: { hogan: 1 }, calls: [] },
      { playerId: 'B', counts: { seve: 1 }, calls: [] },
    ] };
    expect(calculateDots(specials, round, [shared]).players.find((player) => player.playerId === 'A')?.totalPoints).toBe(2);
    expect(calculateDots(specials, round, [{ ...record, players: [{ playerId: 'A', counts: { hogan: 1, seve: 1 }, calls: [] }] }]).status).toBe('unavailable');
    const par3: DotRoundInput = { ...round, layout: round.layout.map((hole) => ({ ...hole, par: 3 })),
      cards: round.cards.map((card) => ({ ...card, holes: card.holes.map((hole) => ({ ...hole, score: { kind: 'strokes', strokes: 3 } })) })) };
    const assassin = calculateDots({ ...game, specials: [{ kind: 'assassin', units: 1 }] }, par3,
      par3.layout.map((hole): DotsHoleRecord => ({ number: hole.number, gameId: game.id, gameEtag: record.gameEtag,
        players: [], ...(hole.number === 1 ? { rotation: { playerIds: ids } } : {}),
        contests: [{ kind: 'kp', status: 'awarded', winnerId: 'A', secondId: 'B' }] })));
    expect(assassin.awards.filter((award) => award.kind === 'assassin').map((award) => award.number)).toEqual([1, 2, 3, 10, 11, 12]);
    const overflow = calculateDots({ ...game, specials: [{ kind: 'sandy', units: Number.MAX_SAFE_INTEGER }] }, round,
      [{ ...record, players: [{ playerId: 'A', counts: { sandy: 2 }, calls: [] }] }]);
    expect(overflow.status).toBe('unavailable');
    expect(overflow.issues).toContain('arithmetic-range');
    expect(overflow.awards).toEqual([]);
  });

  it('allows the selected Walk warnings while preserving pending numeric inputs and exact saved awards', () => {
    const { game, round, record } = fixture();
    const warningGame: DotsGameDefinition = { ...game, specials: [{ kind: 'hogan', units: 1 }, { kind: 'walk', units: 1 }] };
    const warningRecord = { ...record, players: [{ playerId: 'A', counts: { hogan: 1, walk: 1 }, calls: [] }] };
    expect(dotsRecordsMatchGame([warningRecord], warningGame, round)).toBe(true);
    expect(calculateDots(warningGame, round, [warningRecord]).players.map((player) => player.totalPoints)).toEqual([1, 1, 1, 1]);
    const pending: DotRoundInput = { ...round, cards: round.cards.map((card) => ({ ...card, holes: card.holes.map((hole) =>
      hole.number === 1 ? { ...hole, score: { kind: 'unplayed' } } : hole) })) };
    const result = calculateDots(warningGame, pending, [warningRecord]);
    expect(result.status).toBe('in-progress');
    expect(result.holes.find((hole) => hole.number === 1)?.status).toBe('pending');
    expect(result.awards.some((award) => award.kind === 'hogan')).toBe(false);
    expect(result.rotation?.contexts[0]?.sides).toEqual(pairs[0]);
  });
});
