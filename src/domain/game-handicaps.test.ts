import { describe, expect, it } from 'vitest';
import { gameHandicap } from './game-handicaps.js';
import type { GameHandicapRule } from './game-handicaps.js';
import type { RoundGameDefinition } from './games.js';
import type { RoundSnapshot } from './setup.js';
import type { Scorecard } from './scoring.js';
import { calculateGameResults, stablefordPoints } from './stableford.js';
import { publishedCourseHandicaps } from './playing-handicaps.js';
import { strokeGameFixture, strokeGameId } from './stroke-games.test-support.js';
import { matchGamesFixture } from './match-games.test-support.js';
import { churchyV3Fixture } from './churchy-v3.test-support.js';
import { playingCircuit, skinsCarryCircuit } from './round-navigation.js';
import { nassauRecordsFor } from './game-declarations.js';

function indexedRound(count: 9 | 18 = 18, values: readonly (string | null)[] = ['11', '4', '8', '3']): RoundSnapshot {
  const f = strokeGameFixture(count);
  return { ...f.snapshot, players: f.snapshot.players.map((player, index) => ({
    ...player, handicapIndex: values[index] === null ? null : { ...player.handicapIndex, value: values[index] ?? '0' },
  })) };
}

function inputs(round: RoundSnapshot) {
  return publishedCourseHandicaps(round).map((entry) => ({ playerId: entry.playerId,
    handicap: entry.courseHandicap ?? entry.unavailableReason ?? null }));
}

describe('explicit captured game handicaps', () => {
  it('uses the entire saved group for the 11/4/8/3 example, never the match or competition team', () => {
    const round = indexedRound();
    expect(round.players.map((player) => gameHandicap('group-low-v1', player.playerId, inputs(round), round.groups)))
      .toEqual([8, 1, 5, 0]);
    expect(round.players.map((player) => gameHandicap('full-course-v1', player.playerId, inputs(round), round.groups)))
      .toEqual([11, 4, 8, 3]);
  });

  it('keeps plus, zero, missing, ambiguous and unsafe inputs explicit', () => {
    const round = indexedRound(18, ['+2', '0', '4', '3']);
    expect(round.players.map((player) => gameHandicap('group-low-v1', player.playerId, inputs(round), round.groups)))
      .toEqual([0, 2, 6, 5]);
    const source = round.players[0];
    if (!source) throw new Error('Missing fictional golfer');
    expect(gameHandicap('full-course-v1', source.playerId, inputs(round), round.groups)).toBe(-2);
    const missing = indexedRound(18, ['11', null, '8', '3']);
    expect(gameHandicap('group-low-v1', source.playerId, inputs(missing), missing.groups)).toBe('missing-handicap-index');
    expect(gameHandicap('full-course-v1', source.playerId, inputs(missing), missing.groups)).toBe(11);
    expect(gameHandicap('group-low-v1', source.playerId, inputs(round), [])).toBe('missing-score-data');
    expect(gameHandicap('group-low-v1', source.playerId, inputs(round), [...round.groups, ...round.groups])).toBe('missing-score-data');
    const unsafe = inputs(round).map((entry, index) => ({ ...entry, handicap: index ? Number.MAX_SAFE_INTEGER : Number.MIN_SAFE_INTEGER }));
    expect(gameHandicap('group-low-v1', round.players[1]?.playerId ?? '', unsafe, round.groups)).toBe('invalid-handicap-index');
  });

  it('calculates nine-hole CH once and uses captured personal ratings and allocation', () => {
    const round = indexedRound(9, ['22', '8', '16', '6']);
    expect(inputs(round).map((entry) => entry.handicap)).toEqual([11, 4, 8, 3]);
    expect(round.players.map((player) => gameHandicap('group-low-v1', player.playerId, inputs(round), round.groups)))
      .toEqual([8, 1, 5, 0]);
    const playerId = round.players[1]?.playerId ?? '';
    const personal = { ...round.teeProfile, id: 301,
      ratings: round.teeProfile.ratings.map((rating) => ({ ...rating, course: rating.course + 2 })),
      holes: round.teeProfile.holes.map((hole) => ({ ...hole, allocation: 10 - hole.allocation })) };
    const captured = { ...round, playerTees: [{ playerId, profile: personal }] };
    expect(gameHandicap('group-low-v1', playerId, inputs(captured), captured.groups)).toBe(3);
    const cards = strokeGameFixture(9).cards;
    const game = { ...strokeGameFixture(9).ballDrop, handicapRule: 'group-low-v1' as const };
    const result = calculateGameResults([game], captured, cards)[0]?.players[1];
    expect(result?.holes.map((hole) => hole.strokesReceived)).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 1]);
  });

  it.each(['full-course-v1', 'group-low-v1'] as const)('applies %s across every supported round net calculator', (handicapRule) => {
    const f = strokeGameFixture(18), m = matchGamesFixture(), c = churchyV3Fixture(18, 1, 'tee');
    const round = indexedRound();
    const stableford = { id: strokeGameId(910), name: 'Fictional Stableford', preset: 'standard' as const,
      basis: 'net' as const, handicapAllowancePercent: 95, points: stablefordPoints('standard'), handicapRule };
    const games: readonly RoundGameDefinition[] = [
      stableford,
      { ...stableford, id: strokeGameId(911), handicapAllowancePercent: 100, format: 'four-two-net', teams: f.ballDrop.teams },
      { ...f.ballDrop, handicapRule },
      { ...f.skins, basis: 'net', handicapRule, carryovers: false },
      { id: strokeGameId(912), name: 'Fictional Stroke', kind: 'stroke-play', version: 1, basis: 'net', handicapRule },
      { ...c.game, handicapRule, specials: [] },
      { ...m.wolf, basis: 'net', handicapRule },
      { ...m.wolf, id: strokeGameId(913), version: 2 as const, stakeMinor: null, basis: 'net', handicapRule },
    ];
    const expected = handicapRule === 'group-low-v1' ? [8, 1, 5, 0] : [11, 4, 8, 3];
    for (const result of calculateGameResults(games, round, f.cards)) {
      // Legacy/full Stableford keeps its configured allowance rather than rounding captured CH again.
      expect(result.players.map((player) => player.playingHandicap))
        .toEqual(result.gameId === stableford.id && handicapRule === 'full-course-v1' ? [10, 4, 8, 3] : expected);
    }
  });

  it('keeps full and legacy match handicaps separate from explicit whole-group SO', () => {
    const f = matchGamesFixture(), round = indexedRound();
    const cards = f.cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: { kind: 'strokes' as const, strokes: index === 0 ? 5 : 4 },
    })) }));
    const game = { ...f.nassau, basis: 'net' as const };
    const first = (handicapRule?: GameHandicapRule) => calculateGameResults(
      [{ ...game, ...(handicapRule ? { handicapRule } : {}) }], round, cards)[0]?.nassau?.matches[0]?.holes[7];
    expect(first()).toMatchObject({ sideAScore: 5, sideBScore: 4, outcome: 'side-b' });
    expect(first('group-low-v1')).toMatchObject({ sideAScore: 4, sideBScore: 4, outcome: 'halved' });
    expect(first('full-course-v1')).toMatchObject({ sideAScore: 4, sideBScore: 4, outcome: 'halved' });
    const unavailable = indexedRound(18, ['11', '4', '8', null]);
    expect(calculateGameResults([{ ...game, handicapRule: 'group-low-v1' }], unavailable, cards)[0]?.nassau?.matches[0]?.holes[0]?.status)
      .toBe('unavailable');
    expect(calculateGameResults([game], unavailable, cards)[0]?.nassau?.matches[0]?.holes[0]?.status).toBe('complete');
  });

  it('uses each Ball Drop member’s playing group, never their cross-group competition team', () => {
    const f = strokeGameFixture(18, 8);
    const values = ['11', '4', '8', '3', '20', '10', '15', '12'];
    const round = { ...f.snapshot, players: f.snapshot.players.map((player, index) => ({
      ...player, handicapIndex: { ...player.handicapIndex, value: values[index] ?? '0' },
    })) };
    const game = { ...f.ballDrop, handicapRule: 'group-low-v1' as const, teams: f.ballDrop.teams.map((team, index) => ({
      ...team, playerIds: index === 0 ? [1, 2, 5, 6].map(strokeGameId) : [3, 4, 7, 8].map(strokeGameId),
    })) };
    const result = calculateGameResults([game], round, f.cards)[0];
    expect(result?.players.map((player) => player.playingHandicap)).toEqual([8, 1, 5, 0, 10, 0, 5, 2]);
    expect(result?.teams).toHaveLength(2);
  });

  it('never net-qualifies Churchie or linked Dots specials/calls under SO', () => {
    const f = churchyV3Fixture(18, 1, 'tee'), m = matchGamesFixture(), round = indexedRound();
    const wolf = { ...m.wolf, version: 2 as const, basis: 'net' as const, handicapRule: 'group-low-v1' as const, stakeMinor: null };
    const specials = ['string', 'birdy-string', 'birdie', 'eagle', 'paree', 'murphy', 'pully-murphy'] as const;
    const churchie = { ...f.game, handicapRule: 'group-low-v1' as const,
      specials: specials.map((kind) => ({ kind, units: 1 })) };
    const dots = { id: strokeGameId(940), name: 'Fictional linked Dots', kind: 'dots' as const, version: 1 as const,
      groupNumber: 1, playerIds: f.ids, mode: 'linked' as const, linkedGameId: wolf.id, specials: churchie.specials };
    const cards = f.cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: { kind: 'strokes' as const, strokes: index === 0 && hole.number <= 3 ? 5 : 4,
        ...(index === 0 ? { wolf: [{ number: hole.number, choice: { gameId: wolf.id, gameEtag: 'fictional-games',
          mode: 'partner' as const, partnerId: f.ids[1] ?? '' } }] } : {}) },
    })) }));
    const linked = calculateGameResults([wolf, dots], round, cards);
    const churchy = calculateGameResults([churchie], round, cards)[0]?.churchy;
    const awards = [...linked[1]?.dots?.awards ?? [], ...churchy?.awards ?? []];
    expect(awards.filter((award) => award.earnedBy === f.ids[0] && award.number !== null && award.number <= 3)).toEqual([]);
    expect(awards.filter((award) => award.kind === 'birdie' || award.kind === 'eagle' || award.kind === 'birdy-string')).toEqual([]);
    const first = linked[0]?.wolf?.holes[0];
    expect(first?.contests?.find((contest) => contest.kind === 'high')?.wolfScore).toBe(4);
    expect(cards[0]?.holes[0]?.score).toMatchObject({ kind: 'strokes', strokes: 5 });
    const calls = [
      { id: strokeGameId(941), kind: 'paree' as const, result: 'pending' as const, pareeTarget: 'par' as const },
      { id: strokeGameId(942), kind: 'murphy' as const, result: 'pending' as const, murphyTarget: 'par' as const, murphyPresses: 2 as const },
    ];
    const called = cards.map((card, index) => index ? card : { ...card, holes: card.holes.map((hole) => hole.number !== 1 ? hole : {
      ...hole, score: { ...hole.score,
        dots: [{ gameId: dots.id, gameEtag: 'fictional-games', number: 1, contests: [], players: [{ playerId: card.playerId, counts: {}, calls }] }],
        churchy: { version: 3 as const, gameId: churchie.id, gameEtag: 'fictional-games', number: 1,
          contests: [], players: [{ playerId: card.playerId, counts: {}, calls }] } },
    }) });
    const callAwards = [
      ...calculateGameResults([wolf, dots], round, called)[1]?.dots?.awards ?? [],
      ...calculateGameResults([churchie], round, called)[0]?.churchy?.awards ?? [],
    ].filter((award) => award.number === 1 && (award.kind === 'paree' || award.kind === 'murphy'));
    expect(callAwards).toHaveLength(4);
    expect(callAwards.every((award) => award.reason.endsWith('failure.'))).toBe(true);
    expect(callAwards.every((award) => !award.recipientIds.includes(f.ids[0] ?? ''))).toBe(true);
  });
});

describe('shared game starting-hole circuits', () => {
  it('wraps mid-round and back-nine starts and refuses an ambiguous round-wide circuit', () => {
    const numbers = Array.from({ length: 18 }, (_, index) => index + 1);
    expect(playingCircuit(numbers, 16)).toEqual([16, 17, 18, ...numbers.slice(0, 15)]);
    expect(playingCircuit(numbers.slice(9), 14)).toEqual([14, 15, 16, 17, 18, 10, 11, 12, 13]);
    expect(skinsCarryCircuit(numbers, [{ number: 1, playerIds: ['A'], startingHole: 10 },
      { number: 2, playerIds: ['B'], startingHole: 1 }], ['A', 'B'])).toBeNull();
    const ids = ['A', 'B', 'C', 'D'];
    expect(skinsCarryCircuit(numbers, [{ number: 1, playerIds: ids, startingHole: 10 }], ids))
      .toEqual([...numbers.slice(9), ...numbers.slice(0, 9)]);
    expect(skinsCarryCircuit(numbers, [{ number: 1, playerIds: ids.slice(0, 3) }], ids.slice(0, 3))).toBeNull();
    expect(skinsCarryCircuit(numbers, [{ number: 1, playerIds: ids, startingHole: 10 },
      { number: 2, playerIds: ['E', 'F', 'G', 'H'], startingHole: 10 }], [...ids, 'E', 'F', 'G', 'H'])).toBeNull();
  });

  it.each([10, 5])('new Nassau follows start %s while retaining printed Front/Back bets and legacy order', (startingHole) => {
    const f = matchGamesFixture();
    const round = { ...f.snapshot, groups: f.snapshot.groups.map((group) => ({ ...group, startingHole })) };
    const game = { ...f.nassau, playOrder: 'shared-group-v1' as const, handicapRule: 'full-course-v1' as const };
    const result = calculateGameResults([game], round, f.cards)[0]?.nassau?.matches[0];
    const expected = playingCircuit(f.snapshot.teeProfile.holes.map((hole) => hole.number), startingHole) ?? [];
    expect(result?.holes.map((hole) => hole.number)).toEqual(expected);
    for (const segment of ['front', 'back', 'overall'] as const) {
      const numbers = expected.filter((number) => segment === 'front' ? number <= 9 : segment === 'back' ? number > 9 : true);
      expect(result?.bets.find((bet) => bet.segment === segment && bet.origin === 'primary'))
        .toMatchObject({ startHole: numbers[0], endHole: numbers.at(-1), status: 'push', holesResolved: numbers.length });
    }
    expect(calculateGameResults([f.nassau], round, f.cards)[0]?.nassau?.matches[0]?.holes[0]?.number).toBe(1);
  });

  it('keeps a Nassau front press within its played segment across the turn and binds outside-match group-low inputs', () => {
    const f = matchGamesFixture();
    const round = { ...f.snapshot, groups: f.snapshot.groups.map((group) => ({ ...group, startingHole: 5 })) };
    const game = { ...f.nassau, automaticPresses: false, basis: 'net' as const,
      handicapRule: 'group-low-v1' as const, playOrder: 'shared-group-v1' as const };
    const cards = f.cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: hole.number >= 5 && hole.number <= 9
        ? { kind: 'strokes' as const, strokes: index ? 4 : 3 } : { kind: 'unplayed' as const },
    })) }));
    const initial = calculateGameResults([game], round, cards)[0]?.nassau;
    const front = initial?.matches[0]?.bets.find((bet) => bet.segment === 'front');
    const option = initial?.pressOptions.find((entry) => entry.parentBetId === front?.id);
    expect(option).toMatchObject({ declaredAfterHole: 9, startHole: 1 });
    if (!option) throw new Error('Missing fictional saved front-press opportunity');
    const updated = { ...round, players: round.players.map((player, index) => index === 3
      ? { ...player, handicapIndex: { ...player.handicapIndex, value: '+2' } } : player) };
    const newOption = calculateGameResults([game], updated, cards)[0]?.nassau?.pressOptions.find((entry) => entry.parentBetId === front?.id);
    expect(newOption?.startHole).toBe(1);
    expect(newOption?.proof).not.toBe(option.proof);
    const press = { ...option, id: strokeGameId(990) };
    const declared = cards.map((card, index) => index ? card : { ...card, holes: card.holes.map((hole) => hole.number !== 1 ? hole : {
      ...hole, score: { ...hole.score, nassau: [{ gameId: game.id, gameEtag: 'fictional-games', number: 1, outcomes: [], presses: [press] }] },
    }) });
    const accepted = calculateGameResults([game], round, declared)[0]?.nassau;
    expect(accepted?.stalePresses).toEqual([]);
    expect(accepted?.matches[0]?.bets.find((bet) => bet.origin === 'manual')).toMatchObject({ startHole: 1, endHole: 4, remainingHoles: 4 });
    expect(calculateGameResults([game], updated, declared)[0]?.nassau?.stalePresses).toEqual([press]);
    expect(nassauRecordsFor(game, round.groups, declared)[0]?.presses).toEqual([press]);
    const automatic = calculateGameResults([{ ...game, automaticPresses: true }], round, cards)[0]?.nassau;
    expect(automatic?.matches[0]?.bets.filter((bet) => bet.segment === 'front' && bet.origin === 'automatic')
      .map((bet) => bet.startHole)).toEqual([7, 9]);
  });

  it('preserves a marked Wolf final-hole selection and original receipt after earlier score correction', () => {
    const f = strokeGameFixture(9), m = matchGamesFixture();
    const round = { ...indexedRound(9, ['22', '8', '16', '6']),
      groups: f.snapshot.groups.map((group) => ({ ...group, startingHole: 7 })) };
    const wolf = { ...m.wolf, version: 2 as const, basis: 'net' as const, handicapRule: 'group-low-v1' as const, stakeMinor: null };
    const circuit = playingCircuit(f.snapshot.teeProfile.holes.map((hole) => hole.number), 7) ?? [];
    const prefix = circuit.slice(0, -2), final = circuit.at(-2);
    const cards = f.cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: prefix.includes(hole.number) ? { kind: 'strokes' as const, strokes: 4,
        ...(index === 0 ? { wolf: [{ number: hole.number, choice: { gameId: wolf.id, gameEtag: 'fictional-games',
          mode: 'partner' as const, partnerId: wolf.playerIds.find((id) => id !== wolf.playerIds[prefix.indexOf(hole.number) % 4]) ?? '' } }] } : {}) }
        : { kind: 'unplayed' as const },
    })) }));
    const receipt = calculateGameResults([wolf], round, cards)[0]?.wolf?.comeback?.receipt;
    if (!receipt || final === undefined) throw new Error('Missing fictional comeback receipt');
    const saved: readonly Scorecard[] = cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => hole.number !== final ? hole : {
      ...hole, score: { kind: 'strokes' as const, strokes: 4, ...(index === 0 ? { wolf: [{ number: final, comeback: receipt,
        choice: { gameId: wolf.id, gameEtag: 'fictional-games', mode: 'partner' as const,
          partnerId: wolf.playerIds.find((id) => id !== receipt.wolfId) ?? '' } }] } : {}) },
    }) }));
    const corrected = saved.map((card, index) => index ? card : { ...card, holes: card.holes.map((hole) => hole.number !== 7 ? hole : {
      ...hole, score: { ...hole.score, kind: 'strokes' as const, strokes: 9 },
    }) });
    const result = calculateGameResults([wolf], round, corrected)[0]?.wolf;
    expect(result?.comeback).toMatchObject({ status: 'saved', receipt });
    expect(result?.holes.find((hole) => hole.number === final)?.wolfId).toBe(receipt.wolfId);
    expect(saved[0]?.holes.find((hole) => hole.number === final)?.score.wolf?.[0]?.comeback).toEqual(receipt);
  });

  it('carries new round Skins in actual group order, but never silently migrates saved printed-order Skins', () => {
    const f = strokeGameFixture(9);
    const round = { ...f.snapshot, groups: f.snapshot.groups.map((group) => ({ ...group, startingHole: 7 })) };
    const cards = f.cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: { kind: 'strokes' as const, strokes: hole.number === 9 && index === 0 ? 3 : 4 },
    })) }));
    const result = calculateGameResults([{ ...f.skins, carryOrder: 'shared-group-v1' as const }], round, cards)[0];
    expect(result?.players[0]?.strokeGame?.holes.find((hole) => hole.number === 9)?.value).toBe(3);
    expect(result?.unawardedSkins).toBe(6);
    expect(calculateGameResults([f.skins], round, cards)[0]?.players[0]?.strokeGame?.holes[8]?.value).toBe(9);
    const capturedDefault = { ...f.snapshot, teeProfile: { ...f.snapshot.teeProfile,
      holes: [...f.snapshot.teeProfile.holes.slice(6), ...f.snapshot.teeProfile.holes.slice(0, 6)] } };
    expect(calculateGameResults([{ ...f.skins, carryOrder: 'shared-group-v1' as const }], capturedDefault, cards)[0]
      ?.players[0]?.strokeGame?.holes[8]?.value).toBe(3);
    const multi = { ...round, groups: [{ number: 1, startingHole: 7, playerIds: round.players.slice(0, 2).map((player) => player.playerId) },
      { number: 2, startingHole: 1, playerIds: round.players.slice(2).map((player) => player.playerId) }] };
    const unknown = calculateGameResults([{ ...f.skins, carryOrder: 'shared-group-v1' as const }], multi, cards)[0];
    expect(unknown?.players.every((player) => player.status === 'unavailable' && player.strokeGame?.total === null)).toBe(true);
    expect(calculateGameResults([{ ...f.skins, carryOrder: 'shared-group-v1' as const, carryovers: false }], multi, cards)[0]?.players[0]?.strokeGame?.total).toBe(1);
  });
});
