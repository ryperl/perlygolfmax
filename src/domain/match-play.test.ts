import { describe, expect, it } from 'vitest';
import type { MatchPlayGameDefinition, NassauHoleRecord, NassauVariant } from './nassau.js';
import { calculateNassau, calculateNassauFromHandicaps, nassauConfigurationIssues, revalidateNassauManualPress, validateNassauManualPress } from './nassau.js';
import { publishedCourseHandicaps } from './playing-handicaps.js';
import { roundTee } from './round-tee.js';
import { strokeGameFixture, strokeGameId } from './stroke-games.test-support.js';
import { isMatchPlayDefinition, isNassauDefinition, isNassauManualPress, isNassauResults, nassauRecordsMatchGame } from '../contracts/nassau.js';

function fixture(layout: 'native' | 'front' | 'back' | 'eighteen' = 'back', variant: NassauVariant = 'singles') {
  const f = strokeGameFixture(layout === 'native' ? 9 : 18);
  const tee = roundTee(f.snapshot.teeProfile, layout === 'front' || layout === 'back' ? layout : 'full');
  if (!tee) throw new Error('Missing fictional Match Play tee.');
  const start = layout === 'back' ? 17 : layout === 'eighteen' ? 17 : 8;
  const snapshot = { ...f.snapshot, teeProfile: tee, groups: f.snapshot.groups.map((group) => ({ ...group, startingHole: start })) };
  const selections = variant === 'three-way' ? [[0], [1], [2]] : variant === 'one-v-two' ? [[0], [1, 2]]
    : variant === 'singles' ? [[0], [1]] : [[0, 1], [2, 3]];
  const game: MatchPlayGameDefinition = {
    id: strokeGameId(950), name: 'Fictional Match Play', kind: 'match-play', version: 1, basis: 'gross', groupNumber: 1, variant,
    sides: selections.map((selected, index) => ({ id: strokeGameId(960 + index), name: `Fictional side ${String(index + 1)}`,
      playerIds: selected.map((index) => snapshot.players[index]?.playerId ?? '') })),
    stakes: { currency: 'USD', frontMinor: 0, backMinor: 0, overallMinor: 101 }, automaticPresses: false,
  };
  const cards = f.cards.map((card, index) => ({ ...card, holes: tee.holes.map((hole) => ({
    number: hole.number, score: { kind: 'strokes' as const, strokes: index === 0 || variant.startsWith('two-v-two') && index === 1 ? 3 : 4 },
  })) }));
  return { snapshot, game, cards, start };
}

for (const layout of ['native', 'front', 'back', 'eighteen'] as const) {
  describe(`${layout} single-match circuit`, () => {
    it.each(['singles', 'three-way', 'one-v-two', 'two-v-two-best-ball', 'two-v-two-aggregate'] as const)(
      'settles one stake per %s pairing without front/back bets', (variant) => {
        const f = fixture(layout, variant);
        const before = JSON.stringify(f);
        const result = calculateNassau(f.game, f.snapshot, f.cards);
        expect(isMatchPlayDefinition(f.game)).toBe(true);
        expect(isNassauDefinition(f.game)).toBe(false);
        expect(result).toMatchObject({ kind: 'match-play', version: 1, status: 'complete' });
        expect(result.matches).toHaveLength(variant === 'three-way' ? 3 : 1);
        for (const match of result.matches) {
          expect(match.bets).toHaveLength(1);
          expect(match.holes).toHaveLength(f.snapshot.teeProfile.holes.length);
          expect(match.holes[0]?.number).toBe(f.start);
          expect(match.bets[0]).toMatchObject({ segment: 'overall', origin: 'primary', stakeMinor: 101, remainingHoles: 0 });
        }
        expect(result.settlement.players.reduce((sum, player) => sum + (player.netMinor ?? 0), 0)).toBe(0);
        expect(isNassauResults(result, f.game, f.snapshot, f.cards, [], { courseHandicaps: publishedCourseHandicaps(f.snapshot) })).toBe(true);
        expect(JSON.stringify(f)).toBe(before);
      },
    );
  });
}

describe('Match Play presses and captured inputs', () => {
  it.each(['native', 'front', 'back', 'eighteen'] as const)('binds a manual press across the %s circuit wrap and retains it after later holes', (layout) => {
    const f = fixture(layout);
    const numbers = calculateNassau(f.game, f.snapshot, f.cards).matches[0]?.holes.map((hole) => hole.number) ?? [];
    const prefix = new Set(numbers.slice(0, 2));
    const cards = f.cards.map((card) => ({ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: prefix.has(hole.number) ? hole.score : { kind: 'unplayed' as const },
    })) }));
    const result = calculateNassau(f.game, f.snapshot, cards);
    const option = result.pressOptions[0];
    if (!option) throw new Error('Missing fictional press option.');
    expect(option).toMatchObject({ startHole: numbers[2], declaredAfterHole: numbers[1], pressingSide: 'b' });
    expect(option.proof.startsWith('match-play-v1:')).toBe(true);
    const press = { ...option, id: strokeGameId(980) };
    expect(isNassauManualPress(press)).toBe(true);
    expect(validateNassauManualPress(f.game, f.snapshot, cards, [], press)).toEqual({ valid: true });
    const records: readonly NassauHoleRecord[] = [{ number: press.startHole, gameId: f.game.id, gameEtag: 'fictional-v1',
      outcomes: [], presses: [press] }];
    expect(nassauRecordsMatchGame(records, f.game)).toBe(true);
    expect(revalidateNassauManualPress(f.game, f.snapshot, f.cards, records, press)).toEqual({ valid: true });
    const saved = calculateNassau(f.game, f.snapshot, f.cards, records);
    expect(saved.matches[0]?.bets).toHaveLength(2);
    const changed = { ...f.snapshot, groups: f.snapshot.groups.map((group) => ({ ...group, startingHole: numbers[1] ?? f.start })) };
    expect(revalidateNassauManualPress(f.game, changed, f.cards, records, press).valid).toBe(false);
    expect(validateNassauManualPress(f.game, f.snapshot, cards, records, press)).toEqual({ valid: false, reason: 'duplicate-id' });
    const forged = { ...press, id: strokeGameId(981), proof: press.proof.replace('match-play-v1:', 'nassau-v1:') };
    expect(nassauRecordsMatchGame([{ ...records[0], number: forged.startHole, gameId: f.game.id,
      gameEtag: 'fictional-v1', outcomes: [], presses: [forged] }], f.game)).toBe(false);
    expect(validateNassauManualPress(f.game, f.snapshot, cards, [], forged).valid).toBe(false);
  });

  it('starts each automatic two-down child once in played order, including across printed wrap', () => {
    const f = fixture('back');
    const game = { ...f.game, automaticPresses: true };
    const result = calculateNassau(game, f.snapshot, f.cards);
    const bets = result.matches[0]?.bets ?? [];
    expect(bets.map((bet) => bet.startHole)).toEqual([17, 10, 12, 14, 16]);
    expect(bets.map((bet) => bet.endHole)).toEqual([16, 16, 16, 16, 16]);
    expect(new Set(bets.map((bet) => bet.parentBetId)).size).toBe(bets.length);
    expect(bets.every((bet) => bet.stakeMinor === 101)).toBe(true);
    const pending = f.cards.map((card) => ({ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: hole.number === 17 ? { kind: 'unplayed' as const } : hole.score,
    })) }));
    expect(calculateNassau(game, f.snapshot, pending).matches[0]?.bets).toHaveLength(1);
  });

  it('uses personal captured nine-hole CH and allocation off each pairing low, never divides CH again', () => {
    const f = fixture('back', 'three-way');
    const golfer = f.snapshot.players[1];
    if (!golfer) throw new Error('Missing fictional golfer.');
    const round = { ...f.snapshot, playerTees: [{ playerId: golfer.playerId, profile: { ...f.snapshot.teeProfile,
      id: 777, holes: f.snapshot.teeProfile.holes.map((hole) => ({ ...hole, allocation: 10 - hole.allocation })) } }] };
    const game = { ...f.game, basis: 'net' as const };
    const published = { courseHandicaps: round.players.map((player, index) => ({ playerId: player.playerId, courseHandicap: index === 0 ? -1 : index === 1 ? 8 : 0 })) };
    const cards = f.cards.map((card) => ({ ...card, holes: card.holes.map((hole) => ({ ...hole, score: { kind: 'strokes' as const, strokes: 4 } })) }));
    const result = calculateNassauFromHandicaps(game, round, cards, [], published);
    const first = result.matches[0]?.holes.find((hole) => hole.number === 10);
    expect(first).toMatchObject({ sideAScore: 4, sideBScore: 3, outcome: 'side-b' });
    expect(result.matches).toHaveLength(3);
    expect(calculateNassauFromHandicaps(game, round, cards, [], { courseHandicaps: [] }).status).toBe('unavailable');
  });

  it('keeps unsaved holes pending, distinguishes zero-stake pushes, and never invents pickup strokes', () => {
    const f = fixture('native');
    const game = { ...f.game, stakes: { ...f.game.stakes, overallMinor: 0 } };
    const cards = f.cards.map((card) => ({ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: { kind: 'unplayed' as const },
    })) }));
    const pending = calculateNassau(game, f.snapshot, cards);
    expect(pending.settlement).toMatchObject({ status: 'pending', resolvedBetCount: 0 });
    expect(pending.settlement.players.every((player) => player.netMinor === null)).toBe(true);
    const tied = cards.map((card) => ({ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: { kind: 'strokes' as const, strokes: 4 },
    })) }));
    const pushed = calculateNassau(game, f.snapshot, tied);
    expect(pushed.matches[0]?.bets).toMatchObject([{ status: 'push' }]);
    expect(pushed.settlement.players.map((player) => player.netMinor)).toEqual([0, 0]);
    const pickedUp = cards.map((card) => ({ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: { kind: 'picked-up' as const, reportedStrokes: 7 },
    })) }));
    const unavailable = calculateNassau(game, f.snapshot, pickedUp);
    expect(unavailable.status).toBe('unavailable');
    expect(unavailable.matches[0]?.holes.every((hole) => hole.sideAScore === null && hole.sideBScore === null)).toBe(true);
    expect(unavailable.settlement.players.every((player) => player.netMinor === null)).toBe(true);
  });

  it('rejects hidden front/back stakes and malformed layouts without changing legacy Nassau rules', () => {
    const f = fixture('front');
    const hidden = { ...f.game, stakes: { ...f.game.stakes, frontMinor: 100 } };
    expect(isMatchPlayDefinition(hidden)).toBe(false);
    expect(nassauConfigurationIssues(hidden, f.snapshot)).toContainEqual({ code: 'invalid-definition' });
    expect(nassauConfigurationIssues({ ...f.game, kind: 'nassau' }, f.snapshot)).toContainEqual({ code: 'invalid-layout' });
    const malformed = { ...f.snapshot, teeProfile: { ...f.snapshot.teeProfile, holes: f.snapshot.teeProfile.holes.slice(0, 8) } };
    expect(calculateNassau(f.game, malformed, f.cards).status).toBe('unavailable');
  });
});
