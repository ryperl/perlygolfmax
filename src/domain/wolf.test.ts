import { describe, expect, it } from 'vitest';
import { calculateWolf, wolfForHole } from './wolf.js';
import type { WolfGameDefinition, WolfHoleChoice, WolfHoleRecord, WolfRoundInput } from './wolf.js';
import { strokeGameFixture, strokeGameId } from './stroke-games.test-support.js';
import type { HoleScore } from './scoring.js';
import { isWolfResults } from '../contracts/wolf.js';

function fixture() {
  const f = strokeGameFixture(18);
  const game: WolfGameDefinition = { id: strokeGameId(950), name: 'Fictional Wolf', kind: 'wolf', version: 1,
    basis: 'gross', groupNumber: 1, playerIds: f.cards.map((card) => card.playerId), allowPig: true };
  const input: WolfRoundInput = { layout: f.snapshot.teeProfile.holes, groups: f.snapshot.groups,
    players: f.snapshot.players.map((player) => ({ playerId: player.playerId, displayName: player.displayName,
      layout: f.snapshot.teeProfile.holes, strokeAllocation: true, handicap: 0 })) };
  function records(mode: WolfHoleChoice['mode'] = 'partner'): readonly WolfHoleRecord[] {
    return [{ number: 1, choice: mode === 'partner'
      ? { gameId: game.id, gameEtag: 'fictional-game-v1', mode, partnerId: game.playerIds[1] ?? '' }
      : { gameId: game.id, gameEtag: 'fictional-game-v1', mode } }];
  }
  const cards = (values: readonly HoleScore[]) => f.cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => ({
    ...hole, score: hole.number === 1 ? values[index] ?? { kind: 'unplayed' as const } : { kind: 'unplayed' as const },
  })) }));
  const strokes = (values: readonly number[]) => cards(values.map((value) => ({ kind: 'strokes', strokes: value })));
  return { ...f, game, input, records, cards, strokes };
}

describe('Wolf and PIG transfer ledger', () => {
  it.each([
    ['partner', [3, 4, 5, 6], [2, 2, -2, -2]],
    ['partner', [5, 6, 3, 4], [-2, -2, 2, 2]],
    ['blind', [3, 4, 5, 6], [6, -2, -2, -2]],
    ['blind', [6, 3, 4, 5], [-6, 2, 2, 2]],
    ['pig', [3, 4, 5, 6], [9, -3, -3, -3]],
    ['pig', [6, 3, 4, 5], [-9, 3, 3, 3]],
  ] as const)('transfers exactly the agreed dots for %s and sums to zero', (mode, scores, expected) => {
    const f = fixture(), cards = f.strokes(scores), records = f.records(mode);
    const before = structuredClone({ game: f.game, input: f.input, cards, records });
    const result = calculateWolf(f.game, f.input, cards, records);
    expect(result.players.map((player) => player.balance)).toEqual(expected);
    expect(result.players.reduce((sum, player) => sum + (player.balance ?? 0), 0)).toBe(0);
    expect(result.players.every((player) => player.holesScored === 1)).toBe(true);
    expect(result.status).toBe('in-progress');
    expect(isWolfResults(result, f.game, { round: f.input, cards, records })).toBe(true);
    expect({ game: f.game, input: f.input, cards, records }).toEqual(before);
  });

  it('rotates from the saved starting hole and wraps without changing the saved order', () => {
    const f = fixture(), input = { ...f.input, groups: f.input.groups.map((group) => ({ ...group, startingHole: 10 })) };
    expect(wolfForHole(f.game, input, 10)).toBe(f.game.playerIds[0]);
    expect(wolfForHole(f.game, input, 11)).toBe(f.game.playerIds[1]);
    expect(wolfForHole(f.game, input, 18)).toBe(f.game.playerIds[0]);
    expect(wolfForHole(f.game, input, 1)).toBe(f.game.playerIds[1]);
  });

  it('pushes tied holes without a carry and distinguishes played zero from pending/no choice', () => {
    const f = fixture();
    const tied = calculateWolf(f.game, f.input, f.strokes([3, 4, 3, 6]), f.records());
    expect(tied.holes[0]?.status).toBe('tied');
    expect(tied.players.map((player) => player.balance)).toEqual([0, 0, 0, 0]);
    const pending = calculateWolf(f.game, f.input, f.strokes([3, 4, 3, 6]), []);
    expect(pending.players.map((player) => player.balance)).toEqual([null, null, null, null]);
    expect(pending.holes[1]?.transfers).toEqual([]);
  });

  it('requires every saved disposition but excludes pickup/X7/DNF from best balls instead of inventing penalties', () => {
    const f = fixture();
    const partial = calculateWolf(f.game, f.input, f.cards([{ kind: 'strokes', strokes: 3 },
      { kind: 'unplayed' }, { kind: 'strokes', strokes: 6 }, { kind: 'strokes', strokes: 7 }]), f.records());
    expect(partial.holes[0]?.status).toBe('pending');
    const result = calculateWolf(f.game, f.input, f.cards([{ kind: 'picked-up', reportedStrokes: 7 },
      { kind: 'strokes', strokes: 3 }, { kind: 'strokes', strokes: 5 }, { kind: 'did-not-finish' }]), f.records());
    expect(result.players.map((player) => player.balance)).toEqual([2, 2, -2, -2]);
    const unavailable = calculateWolf(f.game, f.input, f.cards([{ kind: 'picked-up', reportedStrokes: 7 },
      { kind: 'did-not-finish' }, { kind: 'strokes', strokes: 5 }, { kind: 'strokes', strokes: 6 }]), f.records());
    expect(unavailable.holes[0]).toMatchObject({ status: 'unavailable', reason: 'missing-numeric-ball', transfers: [] });
  });

  it('compares net best balls using captured CH off the lowest and personal tee stroke indexes', () => {
    const f = fixture();
    const handicaps = [9, 20, -2, 0];
    const input = { ...f.input, players: f.input.players.map((player, index) => ({ ...player,
      handicap: handicaps[index] ?? 0,
      layout: index === 1 ? player.layout.map((hole) => ({ ...hole, allocation: 19 - hole.number })) : player.layout,
    })) };
    const result = calculateWolf({ ...f.game, basis: 'net' }, input, f.strokes([8, 4, 4, 6]), f.records());
    expect(result.players.map((player) => player.playingHandicap)).toEqual([11, 22, 0, 2]);
    expect(result.holes[0]).toMatchObject({ status: 'won', winner: 'wolf', wolfScore: 3, opponentScore: 4 });
    const missing = { ...input, players: input.players.map((player, index) => index === 2 ? { ...player, handicap: null } : player) };
    expect(calculateWolf({ ...f.game, basis: 'net' }, missing, f.strokes([8, 4, 4, 6]), f.records()).holes[0])
      .toMatchObject({ status: 'unavailable', reason: 'missing-handicap-index', transfers: [] });
  });

  it('keeps explicit concessions separate from raw scores and preserves unknown net inputs', () => {
    const f = fixture(), cards = f.cards([{ kind: 'picked-up' }, { kind: 'picked-up' }, { kind: 'picked-up' }, { kind: 'picked-up' }]);
    const input = { ...f.input, players: f.input.players.map((player) => ({ ...player, handicap: null })) };
    const before = structuredClone(cards);
    const records = f.records('pig').map((record) => ({ ...record, outcome: 'opponents' as const }));
    const result = calculateWolf({ ...f.game, basis: 'net' }, input, cards, records);
    expect(result.holes[0]).toMatchObject({ source: 'explicit', winner: 'opponents', wolfScore: null, opponentScore: null });
    expect(result.players.map((player) => player.balance)).toEqual([-9, 3, 3, 3]);
    expect(cards).toEqual(before);
  });

  it('never awards invalid partner/PIG/duplicate declarations or stale group assignments', () => {
    const f = fixture(), cards = f.strokes([3, 4, 5, 6]);
    expect(calculateWolf({ ...f.game, allowPig: false }, f.input, cards, f.records('pig')).holes[0]?.reason).toBe('invalid-wolf-choice');
    const invalid = f.records().map((record) => ({ ...record, choice: {
      gameId: f.game.id, gameEtag: 'v1', mode: 'partner' as const, partnerId: f.game.playerIds[0] ?? '',
    } }));
    expect(calculateWolf(f.game, f.input, cards, invalid).holes[0]?.status).toBe('unavailable');
    expect(calculateWolf(f.game, f.input, cards, [...f.records(), ...f.records()]).holes[0]?.reason).toBe('invalid-wolf-choice');
    expect(calculateWolf(f.game, { ...f.input, groups: [] }, cards, f.records()))
      .toMatchObject({ status: 'unavailable', reason: 'invalid-wolf-group', players: [] });
  });
});
