import { describe, expect, it } from 'vitest';
import type { HoleScore } from './scoring.js';
import { strokeGameFixture, strokeGameId } from './stroke-games.test-support.js';
import { calculateWolf, wolfForHole } from './wolf.js';
import type { WolfGameDefinition, WolfHoleChoice, WolfHoleRecord, WolfRoundInput } from './wolf.js';
import { isWolfResults } from '../contracts/wolf.js';

function fixture(count: 9 | 18 = 9, startingHole = 1) {
  const f = strokeGameFixture(count);
  const game: WolfGameDefinition = { id: strokeGameId(950), name: 'Fictional earned Wolf', kind: 'wolf', version: 2,
    stakeMinor: null, basis: 'gross', groupNumber: 1, playerIds: f.cards.map((card) => card.playerId), allowPig: true };
  const round: WolfRoundInput = { layout: f.snapshot.teeProfile.holes,
    groups: f.snapshot.groups.map((group) => ({ ...group, startingHole })),
    players: f.snapshot.players.map((player) => ({ playerId: player.playerId, displayName: player.displayName,
      layout: f.snapshot.teeProfile.holes, strokeAllocation: true, handicap: 0 })) };
  const choice = (number = startingHole, mode: WolfHoleChoice['mode'] = 'partner'): WolfHoleRecord => {
    const wolf = wolfForHole(game, round, number);
    const partnerId = game.playerIds.find((id) => id !== wolf) ?? '';
    return { number, choice: mode === 'partner' ? { gameId: game.id, gameEtag: 'fictional-v2', mode, partnerId }
      : { gameId: game.id, gameEtag: 'fictional-v2', mode } };
  };
  const cards = (scores: readonly HoleScore[], number = startingHole) => f.cards.map((card, index) => ({
    ...card, holes: card.holes.map((hole) => ({ ...hole, score: hole.number === number ? scores[index] ?? { kind: 'unplayed' as const }
      : { kind: 'unplayed' as const } })),
  }));
  const strokes = (scores: readonly number[]) => cards(scores.map((strokes) => ({ kind: 'strokes', strokes })));
  const prefix = [...round.layout.filter((hole) => hole.number >= startingHole), ...round.layout.filter((hole) => hole.number < startingHole)]
    .slice(0, -2).map((hole) => hole.number);
  const prefixRecords = prefix.map((number) => choice(number));
  return { ...f, game, round, choice, cards, strokes, prefix, prefixRecords };
}

describe('version 2 Wolf earned dots', () => {
  it.each([9, 18] as const)('gives a full plus CH stroke back on the personal allocation %i rather than inventing a solo win', (count) => {
    const f = fixture(count);
    const game = { ...f.game, basis: 'net' as const, handicapRule: 'full-course-v1' as const, stakeMinor: 100 };
    const round = { ...f.round, players: f.round.players.map((player, index) => ({
      ...player, handicap: index === 0 ? -1 : 0,
      layout: index === 0 ? player.layout.map((hole) => ({ ...hole, allocation: count + 1 - hole.allocation })) : player.layout,
    })) };
    const cards = f.strokes([3, 4, 4, 4]), records = [f.choice(1, 'blind')];
    const result = calculateWolf(game, round, cards, records);
    expect(result.holes[0]).toMatchObject({ status: 'tied', contests: [{
      kind: 'low', status: 'tied', winner: null, wolfScore: 4, opponentScore: 4,
    }] });
    expect(result.players.map((player) => player.balance)).toEqual([0, 0, 0, 0]);
    expect(result.awards).toEqual([]);
    expect(isWolfResults(result, game, { round, cards, records })).toBe(true);
  });
  it.each([
    [[3, 4, 5, 6], [3, 3, 0, 0]],
    [[5, 6, 3, 4], [0, 0, 3, 3]],
    [[3, 6, 4, 5], [1, 1, 1, 1]],
    [[3, 5, 3, 6], [1, 1, 0, 0]],
    [[4, 4, 4, 4], [0, 0, 0, 0]],
  ] as const)('adds one optional Sweep per partnered winner only when both actual contests win: %j', (scores, balances) => {
    const f = fixture(), game = { ...f.game, highLowSweep: true as const }, cards = f.strokes(scores), records = [f.choice()];
    const result = calculateWolf(game, f.round, cards, records);
    expect(result.players.map((player) => player.balance)).toEqual(balances);
    expect(result.holes[0]?.contests).toEqual(calculateWolf(f.game, f.round, cards, records).holes[0]?.contests);
    for (const player of result.players) {
      expect(result.awards?.reduce((sum, award) => sum + (award.recipientIds.includes(player.playerId) ? award.dots : 0), 0))
        .toBe(player.balance);
    }
    expect(isWolfResults(result, game, { round: f.round, cards, records })).toBe(true);
    for (const mode of ['blind', 'pig'] as const) {
      expect(calculateWolf(game, f.round, cards, [f.choice(1, mode)]))
        .toEqual(calculateWolf(f.game, f.round, cards, [f.choice(1, mode)]));
    }
  });

  it('includes the optional bonus in comeback totals/proof but preserves the saved final choice after corrections', () => {
    const f = fixture(), game = { ...f.game, highLowSweep: true as const };
    const cards = f.cards([{ kind: 'unplayed' }]).map((card, index) => ({ ...card,
      holes: card.holes.map((hole) => ({ ...hole, score: { kind: 'strokes' as const, strokes: index < 2 ? 3 : 5 } })) }));
    const candidate = calculateWolf(game, f.round, cards, f.prefixRecords).comeback?.receipt;
    if (!candidate) throw new Error('Missing fictional sweep comeback receipt');
    expect(JSON.parse(candidate.proof)).toMatchObject({ game: { highLowSweep: true } });
    expect(candidate.totals.map((entry) => entry.dots)).not.toEqual(
      calculateWolf(f.game, f.round, cards, f.prefixRecords).comeback?.receipt?.totals.map((entry) => entry.dots));
    const final = { ...f.choice(8), choice: { gameId: game.id, gameEtag: 'fictional-v2',
      mode: 'partner' as const, partnerId: f.game.playerIds.find((id) => id !== candidate.wolfId) ?? '' }, comeback: candidate };
    const changed = cards.map((card) => ({ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: { kind: 'strokes' as const, strokes: 4 },
    })) }));
    const corrected = calculateWolf(game, f.round, changed, [...f.prefixRecords, final]);
    expect(corrected.comeback).toMatchObject({ status: 'saved', receipt: candidate, changed: true });
    expect(corrected.holes.slice(-2).map((hole) => hole.wolfId)).toEqual([candidate.wolfId, candidate.wolfId]);
  });

  it.each([
    [[3, 6, 4, 5], [1, 1, 1, 1], ['opponents', 'wolf']],
    [[3, 4, 5, 6], [2, 2, 0, 0], ['wolf', 'wolf']],
    [[5, 6, 3, 4], [0, 0, 2, 2], ['opponents', 'opponents']],
    [[3, 6, 3, 6], [0, 0, 0, 0], [null, null]],
    [[3, 5, 3, 6], [1, 1, 0, 0], ['wolf', null]],
  ] as const)('compares High and Low separately for %j', (scores, expected, winners) => {
    const f = fixture(), cards = f.strokes(scores), records = [f.choice()];
    const before = structuredClone({ game: f.game, round: f.round, cards, records });
    const result = calculateWolf(f.game, f.round, cards, records);
    expect(result.rulesVersion).toBe(2);
    expect(result.players.map((player) => player.balance)).toEqual(expected);
    expect(result.players.map((player) => player.dotsLost)).toEqual([0, 0, 0, 0]);
    expect(result.holes[0]?.contests?.map((contest) => contest.winner)).toEqual(winners);
    expect(result.contexts?.[0]).toMatchObject({ status: 'ready', multiplier: 1, sides: [f.game.playerIds.slice(0, 2), f.game.playerIds.slice(2)] });
    for (const player of result.players) {
      expect(result.awards?.reduce((sum, award) => sum + (award.recipientIds.includes(player.playerId) ? award.dots : 0), 0)).toBe(player.balance);
    }
    expect(isWolfResults(result, f.game, { round: f.round, cards, records })).toBe(true);
    expect(isWolfResults(result, f.game)).toBe(false);
    expect({ game: f.game, round: f.round, cards, records }).toEqual(before);
  });

  it.each([
    ['blind', [3, 4, 5, 6], [2, 0, 0, 0]],
    ['blind', [6, 3, 4, 5], [0, 2, 2, 2]],
    ['pig', [3, 4, 5, 6], [3, 0, 0, 0]],
    ['pig', [6, 3, 4, 5], [0, 3, 3, 3]],
    ['pig', [3, 3, 4, 5], [0, 0, 0, 0]],
  ] as const)('uses one positive solo award in %s, never opponent-count transfers', (mode, scores, expected) => {
    const f = fixture(), result = calculateWolf(f.game, f.round, f.strokes(scores), [f.choice(1, mode)]);
    expect(result.players.map((player) => player.balance)).toEqual(expected);
    expect(result.holes[0]?.contests).toHaveLength(1);
    expect(result.holes[0]?.contests?.[0]?.kind).toBe('low');
    expect(result.contexts?.[0]?.multiplier).toBe(mode === 'pig' ? 3 : 2);
    expect(result.contexts?.[0]?.highWinnerIds).toBeUndefined();
  });

  it('distinguishes known zero from pending and never carries tied base awards', () => {
    const f = fixture();
    const result = calculateWolf(f.game, f.round, f.strokes([4, 4, 4, 4]), [f.choice()]);
    expect(result.players.map((player) => player.balance)).toEqual([0, 0, 0, 0]);
    expect(result.holes[1]?.transfers).toEqual([]);
    expect(calculateWolf(f.game, f.round, f.strokes([4, 4, 4, 4]), []).players.map((player) => player.balance))
      .toEqual([null, null, null, null]);
    expect(result.contexts?.[0]).toMatchObject({ highWinnerIds: [], lowWinnerIds: [] });
  });

  it('awards pickup High only against an all-numeric side and keeps remaining Low numeric', () => {
    const f = fixture();
    const result = calculateWolf(f.game, f.round, f.cards([{ kind: 'picked-up', reportedStrokes: 7 },
      { kind: 'strokes', strokes: 3 }, { kind: 'strokes', strokes: 4 }, { kind: 'strokes', strokes: 5 }]), [f.choice()]);
    expect(result.holes[0]?.contests).toEqual([
      { kind: 'high', status: 'won', winner: 'opponents', wolfScore: null, opponentScore: 5 },
      { kind: 'low', status: 'won', winner: 'wolf', wolfScore: 3, opponentScore: 4 },
    ]);
    expect(result.players.map((player) => player.balance)).toEqual([1, 1, 1, 1]);
    const ambiguous = calculateWolf(f.game, f.round, f.cards([{ kind: 'did-not-finish' }, { kind: 'strokes', strokes: 3 },
      { kind: 'picked-up', reportedStrokes: 7 }, { kind: 'strokes', strokes: 4 }]), [f.choice()]);
    expect(ambiguous.holes[0]?.contests?.[0]?.status).toBe('unavailable');
    expect(ambiguous.holes[0]?.contests?.[1]?.winner).toBe('wolf');
    expect(ambiguous.holes[0]?.status).toBe('unavailable');
    expect(ambiguous.contexts?.[0]).toMatchObject({ status: 'ready', lowWinnerIds: f.game.playerIds.slice(0, 2) });
    expect(ambiguous.contexts?.[0]?.highWinnerIds).toBeUndefined();
    const solo = calculateWolf(f.game, f.round, f.cards([{ kind: 'picked-up', reportedStrokes: 7 },
      { kind: 'strokes', strokes: 3 }, { kind: 'strokes', strokes: 4 }, { kind: 'strokes', strokes: 5 }]), [f.choice(1, 'pig')]);
    expect(solo.holes[0]?.status).toBe('unavailable');
    expect(solo.awards).toEqual([]);
  });

  it('does not convert unplayed, missing data or ambiguous old concessions into awards', () => {
    const f = fixture();
    const pending = calculateWolf(f.game, f.round, f.cards([{ kind: 'unplayed' }, { kind: 'strokes', strokes: 3 },
      { kind: 'strokes', strokes: 4 }, { kind: 'strokes', strokes: 5 }]), [f.choice()]);
    expect(pending.holes[0]?.status).toBe('pending');
    expect(pending.awards).toEqual([]);
    expect(calculateWolf(f.game, f.round, [], [f.choice()]).holes[0]?.reason).toBe('missing-score-data');
    expect(calculateWolf(f.game, f.round, f.strokes([3, 4, 5, 6]), [{ ...f.choice(), outcome: 'wolf' }]).holes[0]?.reason)
      .toBe('invalid-wolf-choice');
  });

  it.each([9, 18] as const)('uses full captured %i-hole CH off lowest and each personal allocation', (count) => {
    const f = fixture(count), handicaps = [count, count + 1, 0, 0];
    const round = { ...f.round, players: f.round.players.map((player, index) => ({ ...player,
      handicap: handicaps[index] ?? 0,
      layout: index === 1 ? player.layout.map((hole) => ({ ...hole, allocation: count + 1 - hole.number })) : player.layout,
    })) };
    const result = calculateWolf({ ...f.game, basis: 'net' }, round, f.strokes([4, 4, 4, 4]), [f.choice()]);
    expect(result.players.map((player) => player.playingHandicap)).toEqual(handicaps);
    expect(result.holes[0]?.contests?.map((contest) => [contest.wolfScore, contest.opponentScore])).toEqual([[3, 4], [3, 4]]);
    expect(result.players.map((player) => player.balance)).toEqual([2, 2, 0, 0]);
  });

  it('fails closed on unknown/full-layout net inputs, invalid scores and arithmetic overflow', () => {
    const f = fixture(), game = { ...f.game, basis: 'net' as const };
    const run = (round: WolfRoundInput) => calculateWolf(game, round, f.strokes([4, 4, 4, 4]), [f.choice()]);
    expect(run({ ...f.round, players: f.round.players.map((player) => ({ ...player, handicap: null })) }).holes[0]?.reason)
      .toBe('missing-handicap-index');
    expect(run({ ...f.round, players: f.round.players.map((player) => ({ ...player,
      layout: player.layout.map((hole) => ({ ...hole, allocation: 1 })) })) }).holes[0]?.reason).toBe('missing-stroke-index');
    expect(run({ ...f.round, players: f.round.players.map((player, index) => ({ ...player,
      handicap: index === 0 ? Number.MIN_SAFE_INTEGER : Number.MAX_SAFE_INTEGER })) }).holes[0]?.reason).toBe('arithmetic-range');
    expect(calculateWolf(f.game, f.round, f.strokes([0, 4, 4, 4]), [f.choice()]).holes[0]?.reason).toBe('invalid-stroke-score');
  });

  it('keeps saved sides usable for independent gross specials when net inputs are unavailable', () => {
    const f = fixture();
    const round = { ...f.round, players: f.round.players.map((player) => ({ ...player, handicap: null })) };
    const result = calculateWolf({ ...f.game, basis: 'net' }, round, f.strokes([3, 4, 5, 6]), [f.choice()]);
    expect(result.holes[0]).toMatchObject({ status: 'unavailable', reason: 'missing-handicap-index' });
    expect(result.contexts?.[0]).toEqual({
      number: 1, status: 'ready', sides: [f.game.playerIds.slice(0, 2), f.game.playerIds.slice(2)],
      multiplier: 1, sourceGameId: f.game.id,
    });
    expect(result.awards).toEqual([]);
    expect(result.contexts?.[1]).toMatchObject({ status: 'pending', sides: [] });
  });

  it('keeps a valid solo multiplier available while raw peer scores leave the contest pending', () => {
    const f = fixture();
    const cards = f.cards([{ kind: 'strokes', strokes: 3 }, { kind: 'unplayed' },
      { kind: 'strokes', strokes: 5 }, { kind: 'strokes', strokes: 6 }]);
    const result = calculateWolf(f.game, f.round, cards, [f.choice(1, 'pig')]);
    expect(result.holes[0]?.contests).toEqual([
      { kind: 'low', status: 'pending', winner: null, wolfScore: null, opponentScore: null },
    ]);
    expect(result.contexts?.[0]).toEqual({
      number: 1, status: 'ready', sides: [f.game.playerIds.slice(0, 1), f.game.playerIds.slice(1)],
      multiplier: 3, sourceGameId: f.game.id,
    });
    expect(result.awards).toEqual([]);
    const invalid = calculateWolf({ ...f.game, allowPig: false }, f.round, cards, [f.choice(1, 'pig')]);
    expect(invalid.contexts?.[0]).toMatchObject({ status: 'unavailable', sides: [], reason: 'invalid-wolf-choice' });
  });

  it('rejects invalid groups, duplicate/orphan records and disabled PIG without producing awards', () => {
    const f = fixture(), cards = f.strokes([3, 4, 5, 6]), record = f.choice();
    expect(calculateWolf(f.game, { ...f.round, groups: [] }, cards, [record]))
      .toMatchObject({ status: 'unavailable', reason: 'invalid-wolf-group', players: [], rulesVersion: 2 });
    expect(calculateWolf(f.game, { ...f.round, players: f.round.players.map((player) => ({
      ...player, layout: player.layout.slice(1),
    })) }, cards, [record]).reason).toBe('invalid-wolf-group');
    expect(calculateWolf(f.game, f.round, cards, [record, record]).holes[0]?.reason).toBe('invalid-wolf-choice');
    expect(calculateWolf(f.game, f.round, cards, [{ ...record, number: 18 }]).awards).toEqual([]);
    expect(calculateWolf({ ...f.game, allowPig: false }, f.round, cards, [f.choice(1, 'pig')]).holes[0]?.reason)
      .toBe('invalid-wolf-choice');
  });
});

describe('version 2 saved final-two comeback', () => {
  it.each([[9, 1, [8, 9]], [18, 1, [17, 18]], [18, 10, [8, 9]]] as const)(
    'uses the actual %i-hole circuit starting at %i and printed-order tied-lowest selection', (count, start, finals) => {
      const f = fixture(count, start);
      const result = calculateWolf(f.game, f.round, [], []);
      expect(result.comeback?.status).toBe('pending');
      const ready = calculateWolf(f.game, f.round, strokeGameFixture(count).cards, f.prefixRecords);
      const candidate = ready.comeback?.receipt;
      expect(ready.comeback?.status).toBe('available');
      expect(candidate?.afterHoles).toEqual(f.prefix);
      expect(candidate?.wolfId).toBe(f.game.playerIds[f.prefix.length % 4]);
      expect(finals.map((number) => ready.holes.find((hole) => hole.number === number)?.wolfId))
        .toEqual([candidate?.wolfId, candidate?.wolfId]);
    });

  it('waits for complete required linked points without guessing zero; combined points change the trailer', () => {
    const f = fixture(), cards = strokeGameFixture(9).cards, round = { ...f.round, comebackRequired: true };
    const missing = calculateWolf(f.game, round, cards, f.prefixRecords);
    expect(missing.comeback?.status).toBe('pending');
    expect(missing.holes[0]?.status).toBe('tied');
    expect(missing.holes.slice(-2).map((hole) => hole.wolfId)).toEqual([null, null]);
    const points = f.game.playerIds.map((playerId, index) => ({ playerId, dots: index === 1 ? 0 : 5 }));
    const complete = calculateWolf(f.game, { ...round, comebackPoints: points }, cards, f.prefixRecords);
    expect(complete.comeback?.receipt?.wolfId).toBe(f.game.playerIds[1]);
    expect(calculateWolf(f.game, { ...round, comebackPoints: points.map((point, index) => ({ ...point, dots: index === 1 ? null : point.dots })) },
      cards, f.prefixRecords).comeback?.status).toBe('pending');
    expect(calculateWolf(f.game, { ...round, comebackPoints: [...points.slice(0, 3), points[0] ?? { playerId: '', dots: 0 }] },
      cards, f.prefixRecords).comeback?.status).toBe('unavailable');
  });

  it('uses exact combined totals and refuses overflow rather than rounding', () => {
    const f = fixture(), cards = strokeGameFixture(9).cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: { kind: 'strokes' as const, strokes: index < 2 ? 3 : 5 },
    })) }));
    const points = f.game.playerIds.map((playerId) => ({ playerId, dots: Number.MAX_SAFE_INTEGER }));
    const result = calculateWolf(f.game, { ...f.round, comebackPoints: points }, cards, f.prefixRecords);
    expect(result.comeback).toMatchObject({ status: 'unavailable', reason: 'arithmetic-range' });
  });

  it('freezes both final roles after an earlier correction and flags changed public-input proofs', () => {
    const f = fixture(), cards = strokeGameFixture(9).cards;
    const candidate = calculateWolf(f.game, f.round, cards, f.prefixRecords).comeback?.receipt;
    if (!candidate) throw new Error('Missing fictional comeback');
    const records = [...f.prefixRecords, { ...f.choice(8, 'pig'), comeback: candidate }, f.choice(9, 'pig')];
    const frozen = calculateWolf(f.game, f.round, cards, records);
    expect(frozen.comeback).toMatchObject({ status: 'saved', changed: false });
    expect(frozen.holes.slice(-2).map((hole) => hole.wolfId)).toEqual([candidate.wolfId, candidate.wolfId]);
    const corrected = cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: hole.number === 1 ? { kind: 'strokes' as const, strokes: index < 2 ? 3 : 5 } : hole.score,
    })) }));
    const result = calculateWolf(f.game, f.round, corrected, records);
    expect(result.comeback).toMatchObject({ status: 'saved', changed: true, receipt: candidate });
    expect(result.holes.slice(-2).map((hole) => hole.wolfId)).toEqual([candidate.wolfId, candidate.wolfId]);
    expect(candidate.proof).not.toContain('recordedBy');
    expect(candidate.proof).not.toContain('handicapIndex');
    expect(candidate.proof).not.toContain('Fictional golfer');
    const linked = calculateWolf(f.game, { ...f.round,
      comebackPoints: f.game.playerIds.map((playerId) => ({ playerId, dots: 1 })) }, cards, records);
    expect(linked.comeback).toMatchObject({ status: 'saved', changed: true, receipt: candidate });
    expect(linked.holes.slice(-2).map((hole) => hole.wolfId)).toEqual([candidate.wolfId, candidate.wolfId]);
  });

  it('rejects conflicting receipts and receipts outside final holes', () => {
    const f = fixture(), cards = strokeGameFixture(9).cards;
    const receipt = calculateWolf(f.game, f.round, cards, f.prefixRecords).comeback?.receipt;
    if (!receipt) throw new Error('Missing fictional comeback');
    const conflict = calculateWolf(f.game, f.round, cards, [...f.prefixRecords, { ...f.choice(8, 'pig'), comeback: receipt },
      { ...f.choice(9, 'pig'), comeback: { ...receipt, proof: `${receipt.proof}changed` } }]);
    expect(conflict.comeback?.status).toBe('unavailable');
    expect(conflict.holes.slice(-2).every((hole) => hole.status === 'unavailable' && hole.wolfId === null)).toBe(true);
    const misplaced = calculateWolf(f.game, f.round, cards, f.prefixRecords.map((record, index) => index === 0 ? { ...record, comeback: receipt } : record));
    expect(misplaced.comeback?.status).toBe('unavailable');
    const missing = calculateWolf(f.game, f.round, cards, [...f.prefixRecords, f.choice(8, 'pig')]);
    expect(missing.comeback).toMatchObject({ status: 'unavailable', reason: 'missing-comeback-receipt' });
    expect(missing.holes.slice(-2).map((hole) => hole.wolfId)).toEqual([null, null]);
  });
});
