import { describe, expect, it } from 'vitest';
import type { NassauGameDefinition, NassauHandicapInputs, NassauHoleRecord, NassauManualPress, NassauRoundContext, NassauVariant } from './nassau.js';
import { calculateNassau, calculateNassauFromHandicaps, nassauConfigurationIssues, nassauManualBetId, nassauMatchId,
  revalidateNassauManualPress, validateNassauManualPress } from './nassau.js';
import type { HoleScore, Scorecard } from './scoring.js';
import { publishedCourseHandicaps } from './playing-handicaps.js';
import { strokeGameCards, strokeGameFixture, strokeGameId } from './stroke-games.test-support.js';

function fixture(variant: NassauVariant = 'singles') {
  const base = strokeGameFixture(18);
  const ids = base.snapshot.players.map((player) => player.playerId);
  const selections = variant === 'three-way' ? [[0], [1], [2]] : variant === 'one-v-two' ? [[0], [1, 2]]
    : variant === 'singles' ? [[0], [1]] : [[0, 1], [2, 3]];
  const game: NassauGameDefinition = {
    id: strokeGameId(950), name: 'Fictional Nassau', kind: 'nassau', version: 1, basis: 'gross', groupNumber: 1, variant,
    sides: selections.map((selected, index) => ({ id: strokeGameId(960 + index), name: `Fictional side ${String(index + 1)}`,
      playerIds: selected.map((index) => ids[index] ?? '') })),
    stakes: { currency: 'USD', frontMinor: 100, backMinor: 200, overallMinor: 300 }, automaticPresses: false,
  };
  return { ...base, game, matchId: nassauMatchId(game.id, 0, 1) };
}

function played(cards: readonly Scorecard[], through: number, strokes: (player: number, hole: number) => number = () => 4): readonly Scorecard[] {
  return cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => ({ number: hole.number,
    score: hole.number <= through ? { kind: 'strokes', strokes: strokes(index, hole.number) } : { kind: 'unplayed' } })) }));
}

function record(gameId: string, matchId: string, number: number, outcome: 'side-a' | 'side-b' | 'halved'): NassauHoleRecord {
  return { number, gameId, gameEtag: 'fictional-game-revision', outcomes: [{ matchId, outcome }], presses: [] };
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing fictional test receipt');
  return value;
}

function declaration(f: ReturnType<typeof fixture>, cards: readonly Scorecard[], records: readonly NassauHoleRecord[] = [],
  parentBetId = `${f.matchId}:front`, id = strokeGameId(980)): NassauManualPress {
  const option = required(calculateNassau(f.game, f.snapshot, cards, records).pressOptions.find((entry) => entry.parentBetId === parentBetId));
  return { id, ...option };
}

function pressRecord(gameId: string, press: NassauManualPress): NassauHoleRecord {
  return { number: press.startHole, gameId, gameEtag: 'fictional-old-shared-revision', outcomes: [], presses: [press] };
}

describe('pure Nassau match play', () => {
  it('retains a guaranteed clinched front-nine win when later numeric comparisons are unavailable', () => {
    const f = fixture();
    const cards = strokeGameCards(played(f.cards, 5, (player) => player === 0 ? 3 : 4), 6,
      [{ kind: 'picked-up' }, { kind: 'did-not-finish' }]);
    const result = calculateNassau(f.game, f.snapshot, cards);
    expect(result.matches[0]?.bets.find((bet) => bet.segment === 'front')).toMatchObject({
      status: 'won', winner: 'a', currentPosition: 5, remainingHoles: 4,
    });
    expect(result.matches[0]?.bets.find((bet) => bet.segment === 'overall')?.status).toBe('unavailable');
  });
  it('settles independent front/back/overall bets, pushes ties, and never rewrites raw cards', () => {
    const f = fixture();
    const cards = played(f.cards, 18, (player, hole) => player === (hole <= 9 ? 0 : 1) ? 3 : 4);
    const before = JSON.stringify(cards);
    const result = calculateNassau(f.game, f.snapshot, cards);
    expect(result.status).toBe('complete');
    expect(result.matches[0]?.bets.map((bet) => [bet.segment, bet.status, bet.winner]))
      .toEqual([['front', 'won', 'a'], ['back', 'won', 'b'], ['overall', 'push', null]]);
    expect(result.settlement.players.map((player) => player.netMinor)).toEqual([-100, 100]);
    expect(result.settlement.unallocatedMinor).toBe(0);
    expect(result.pressOptions).toEqual([]);
    expect(JSON.stringify(cards)).toBe(before);
  });

  it('distinguishes no resolved bets from known-zero pushes and explicit zero stakes', () => {
    const f = fixture();
    const pending = calculateNassau(f.game, f.snapshot, played(f.cards, 0));
    expect(pending.settlement).toMatchObject({ status: 'pending', resolvedBetCount: 0, unallocatedMinor: null });
    expect(pending.settlement.players[0]?.netMinor).toBeNull();
    const push = calculateNassau(f.game, f.snapshot, f.cards);
    expect(push.settlement).toMatchObject({ status: 'complete', resolvedBetCount: 3, unallocatedMinor: 0 });
    expect(push.settlement.players.map((player) => player.netMinor)).toEqual([0, 0]);
    const zero = calculateNassau({ ...f.game, stakes: { currency: 'USD', frontMinor: 0, backMinor: 0, overallMinor: 0 } },
      f.snapshot, played(f.cards, 18, (player) => player === 0 ? 3 : 4));
    expect(zero.matches[0]?.bets.every((bet) => bet.status === 'won')).toBe(true);
    expect(zero.settlement.players.map((player) => player.netMinor)).toEqual([0, 0]);
  });

  it('requires 18 captured holes and the selected saved group, not the entire round roster', () => {
    const f = fixture();
    expect(nassauConfigurationIssues(f.game, f.snapshot)).toEqual([]);
    expect(calculateNassau({ ...f.game, groupNumber: 2 }, f.snapshot, f.cards).status).toBe('unavailable');
    const nine = { ...f.snapshot, teeProfile: { ...f.snapshot.teeProfile, holeCount: 9 as const,
      holes: f.snapshot.teeProfile.holes.slice(0, 9) } };
    expect(calculateNassau(f.game, nine, f.cards).issues).toContainEqual({ code: 'invalid-layout' });
    const duplicate = { ...f.game, sides: f.game.sides.map((side) => ({ ...side, playerIds: [required(f.game.sides[0]?.playerIds[0])] })) };
    expect(calculateNassau(duplicate, f.snapshot, f.cards).status).toBe('unavailable');
  });

  it('creates three separate pairwise matches with their own net baseline and personal SI', () => {
    const f = fixture('three-way');
    const third = required(f.snapshot.players[2]);
    const tee = { ...f.snapshot.teeProfile, id: 700,
      holes: f.snapshot.teeProfile.holes.map((hole) => ({ ...hole, allocation: hole.number === 1 ? 11 : hole.number === 11 ? 1 : hole.allocation })) };
    const round = { ...f.snapshot, playerTees: [{ playerId: third.playerId, profile: tee }] };
    const published: NassauHandicapInputs = { courseHandicaps: f.snapshot.players.map((player, index) =>
      ({ playerId: player.playerId, courseHandicap: index * 10 })) };
    const result = calculateNassau({ ...f.game, basis: 'net' }, round, f.cards, [], published);
    expect(result.matches).toHaveLength(3);
    expect(result.matches.map((match) => match.bets.length)).toEqual([3, 3, 3]);
    expect(result.matches.map((match) => match.holes[0]?.outcome)).toEqual(['side-b', 'side-b', 'halved']);
  });

  it('shares exact captured CH math including plus handicaps and yields identical public/private proofs', () => {
    const f = fixture();
    const round = { ...f.snapshot, inputRevision: 'fictional-capture-1', players: f.snapshot.players.map((player, index) => ({
      ...player, handicapIndex: { ...player.handicapIndex, value: index === 0 ? '+2' : '0' },
    })) };
    const cards = played(f.cards, 2, (player) => player === 0 ? 3 : 5);
    const game = { ...f.game, basis: 'net' as const };
    const privateResult = calculateNassau(game, round, cards);
    expect(privateResult.matches[0]?.holes[0]).toMatchObject({ sideAScore: 3, sideBScore: 4, outcome: 'side-a' });
    const publicRound: NassauRoundContext = {
      id: round.id, inputRevision: round.inputRevision, courseVersionId: round.courseVersionId,
      teeProfile: { id: round.teeProfile.id, holeCount: round.teeProfile.holeCount,
        holes: round.teeProfile.holes, strokeAllocation: round.teeProfile.strokeAllocation },
      groups: round.groups, players: round.players.map(({ playerId, displayName }) => ({ playerId, displayName })),
    };
    const publicResult = calculateNassauFromHandicaps(game, publicRound, cards, [], { courseHandicaps: publishedCourseHandicaps(round) });
    expect(publicResult).toEqual(privateResult);
    expect(privateResult.pressOptions[0]?.proof).not.toContain('recordedBy');
  });

  it('recomputes personal-tee net results and press proofs from minimal context without course/tee metadata or HI', () => {
    const f = fixture();
    const golfer = required(f.snapshot.players[1]);
    const tee = { ...f.snapshot.teeProfile, id: 777,
      holes: f.snapshot.teeProfile.holes.map((hole) => ({ ...hole, allocation: 19 - hole.number })) };
    const round = { ...f.snapshot, players: f.snapshot.players.map((player, index) => ({
      ...player, handicapIndex: { ...player.handicapIndex, value: index === 1 ? '10' : '0' },
    })), playerTees: [{ playerId: golfer.playerId, profile: tee }] };
    const context: NassauRoundContext = {
      id: round.id, courseVersionId: round.courseVersionId,
      teeProfile: { id: round.teeProfile.id, holeCount: round.teeProfile.holeCount,
        holes: round.teeProfile.holes, strokeAllocation: round.teeProfile.strokeAllocation },
      playerTees: [{ playerId: golfer.playerId, profile: {
        id: tee.id, holeCount: tee.holeCount, holes: tee.holes, strokeAllocation: tee.strokeAllocation,
      } }],
      groups: round.groups, players: round.players.map(({ playerId, displayName }) => ({ playerId, displayName })),
    };
    const game = { ...f.game, basis: 'net' as const };
    const cards = played(f.cards, 2, (player) => player === 0 ? 3 : 4);
    const published = { courseHandicaps: publishedCourseHandicaps(round) };
    const result = calculateNassauFromHandicaps(game, context, cards, [], published);
    expect(result).toEqual(calculateNassau(game, round, cards));
    expect(result.matches[0]?.holes[0]).toMatchObject({ sideAScore: 3, sideBScore: 4, outcome: 'side-a' });
    const press = { ...required(result.pressOptions[0]), id: strokeGameId(983) };
    const records = [pressRecord(game.id, press)];
    expect(calculateNassauFromHandicaps(game, context, cards, records, published))
      .toEqual(calculateNassau(game, round, cards, records));
    expect(calculateNassauFromHandicaps(game, context, cards, [], { courseHandicaps: [] })
      .matches[0]?.holes[0]?.status).toBe('unavailable');
  });

  it('never falls back from supplied missing/unavailable/duplicate CH to private indices or zero', () => {
    const f = fixture();
    const game = { ...f.game, basis: 'net' as const };
    const first = required(f.snapshot.players[0]);
    for (const courseHandicaps of [
      [],
      [{ playerId: first.playerId, courseHandicap: null }],
      [...publishedCourseHandicaps(f.snapshot), { playerId: first.playerId, courseHandicap: 0 }],
      publishedCourseHandicaps(f.snapshot).map((player) => ({ ...player, unavailableReason: 'missing-handicap-index' as const })),
    ]) expect(calculateNassau(game, f.snapshot, f.cards, [], { courseHandicaps }).status).toBe('unavailable');
    const noAllocation = { ...f.snapshot, teeProfile: { ...f.snapshot.teeProfile, strokeAllocation: false } };
    expect(calculateNassau(game, noAllocation, f.cards).matches[0]?.holes[0]?.status).toBe('unavailable');
    const invalidSI = { ...f.snapshot, teeProfile: { ...f.snapshot.teeProfile,
      holes: f.snapshot.teeProfile.holes.map((hole) => ({ ...hole, allocation: 1 })) } };
    expect(calculateNassau(game, invalidSI, f.cards).status).toBe('unavailable');
  });

  it('waits for all best-ball dispositions, excludes pickups/X7/DNF, and never awards an automatic win', () => {
    const f = fixture('two-v-two-best-ball');
    const cases: readonly { readonly scores: readonly HoleScore[]; readonly status: string; readonly outcome: string | null }[] = [
      { scores: [{ kind: 'strokes', strokes: 3 }, { kind: 'unplayed' }, { kind: 'strokes', strokes: 4 }, { kind: 'strokes', strokes: 4 }], status: 'pending', outcome: null },
      { scores: [{ kind: 'strokes', strokes: 3 }, { kind: 'picked-up', reportedStrokes: 7 }, { kind: 'strokes', strokes: 4 }, { kind: 'did-not-finish' }], status: 'complete', outcome: 'side-a' },
      { scores: [{ kind: 'picked-up' }, { kind: 'did-not-finish' }, { kind: 'strokes', strokes: 4 }, { kind: 'strokes', strokes: 4 }], status: 'unavailable', outcome: null },
      { scores: [{ kind: 'strokes', strokes: 3 }, { kind: 'strokes', strokes: 0 }, { kind: 'strokes', strokes: 4 }, { kind: 'strokes', strokes: 4 }], status: 'unavailable', outcome: null },
    ];
    for (const entry of cases) expect(calculateNassau(f.game, f.snapshot, strokeGameCards(f.cards, 1, entry.scores)).matches[0]?.holes[0])
      .toMatchObject({ status: entry.status, outcome: entry.outcome });
  });

  it('supports 1v2 best-ball and selectable 2v2 aggregate using direct strokes, not relative par', () => {
    const f = fixture('one-v-two');
    const cards = played(f.cards, 18, (player) => [4, 3, 8, 4][player] ?? 4);
    expect(calculateNassau(f.game, f.snapshot, cards).matches[0]?.holes[0]).toMatchObject({ sideAScore: 4, sideBScore: 3 });
    const pair = fixture('two-v-two-aggregate');
    const pairCards = played(pair.cards, 18, (player) => [3, 8, 5, 5][player] ?? 4);
    expect(calculateNassau(pair.game, pair.snapshot, pairCards).matches[0]?.holes[0]).toMatchObject({ sideAScore: 11, sideBScore: 10, outcome: 'side-b' });
    expect(calculateNassau({ ...pair.game, variant: 'two-v-two-best-ball' }, pair.snapshot, pairCards).matches[0]?.holes[0]?.outcome).toBe('side-a');
    const pickup = strokeGameCards(pairCards, 1, [{ kind: 'strokes', strokes: 3 }, { kind: 'picked-up', reportedStrokes: 7 }]);
    expect(calculateNassau(pair.game, pair.snapshot, pickup).matches[0]?.holes[0]?.status).toBe('unavailable');
    const overflow = played(pair.cards, 18, () => Number.MAX_SAFE_INTEGER);
    expect(calculateNassau(pair.game, pair.snapshot, overflow).settlement.players[0]?.netMinor).toBeNull();
    const unsafeRelative = { courseHandicaps: pair.snapshot.players.map((player, index) => ({
      playerId: player.playerId, courseHandicap: index === 0 ? -Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER,
    })) };
    expect(calculateNassau({ ...pair.game, basis: 'net', variant: 'two-v-two-best-ball' },
      pair.snapshot, pair.cards, [], unsafeRelative).matches[0]?.holes[0]?.status).toBe('unavailable');
  });

  it('accepts explicit conceded/halved match outcomes without numeric scores or net inputs', () => {
    const f = fixture();
    const game = { ...f.game, basis: 'net' as const };
    const cards = played(f.cards, 0);
    const records = [record(game.id, f.matchId, 1, 'side-b'), record(game.id, f.matchId, 2, 'halved')];
    const result = calculateNassau(game, f.snapshot, cards, records, { courseHandicaps: [] });
    expect(result.matches[0]?.holes.slice(0, 3).map((hole) => [hole.status, hole.outcome]))
      .toEqual([['complete', 'side-b'], ['complete', 'halved'], ['pending', null]]);
    expect(cards[0]?.holes[0]?.score.kind).toBe('unplayed');
    expect(result.matches[0]?.holes[0]).toMatchObject({ source: 'override', sideAScore: null, sideBScore: null });
  });

  it('allocates one side-total stake in exact equal shares with one conserved remainder per bet', () => {
    const f = fixture('one-v-two');
    const game = { ...f.game, stakes: { currency: 'USD' as const, frontMinor: 101, backMinor: 101, overallMinor: 101 } };
    const result = calculateNassau(game, f.snapshot, played(f.cards, 18, (player) => player === 0 ? 3 : 4));
    expect(result.matches[0]?.bets[0]?.settlement.players.map((player) => player.netMinor)).toEqual([100, -50, -50]);
    expect(result.settlement.players.map((player) => player.netMinor)).toEqual([300, -150, -150]);
    expect(result.settlement.unallocatedMinor).toBe(3);
    expect(result.settlement.players.reduce((sum, player) => sum + (player.netMinor ?? 0), 0)).toBe(0);
    const reverse = calculateNassau(game, f.snapshot, played(f.cards, 18, (player) => player === 0 ? 5 : 4));
    expect(reverse.matches[0]?.bets[0]?.settlement.players.map((player) => player.netMinor)).toEqual([-100, 50, 50]);
  });

  it('uses the LCM for 2v2 stakes and reports aggregate money overflow as unavailable', () => {
    const f = fixture('two-v-two-best-ball');
    const cards = played(f.cards, 18, (player) => player < 2 ? 3 : 4);
    const game = { ...f.game, stakes: { currency: 'USD' as const, frontMinor: 3, backMinor: 3, overallMinor: 3 } };
    const result = calculateNassau(game, f.snapshot, cards);
    expect(result.matches[0]?.bets[0]?.settlement.players.map((player) => player.netMinor)).toEqual([1, 1, -1, -1]);
    expect(result.settlement.unallocatedMinor).toBe(3);
    const singles = fixture();
    const overflow = calculateNassau({ ...singles.game, stakes: { currency: 'USD', frontMinor: Number.MAX_SAFE_INTEGER,
      backMinor: Number.MAX_SAFE_INTEGER, overallMinor: Number.MAX_SAFE_INTEGER } },
    singles.snapshot, played(singles.cards, 18, (player) => player === 0 ? 3 : 4));
    expect(overflow.issues).toContainEqual({ code: 'arithmetic-range' });
    expect(overflow.settlement.players[0]?.netMinor).toBeNull();
  });
});

describe('Nassau presses and historical proofs', () => {
  it('presses each bet once at its first two-down position, with independently pressable children', () => {
    const base = fixture();
    const f = { ...base, game: { ...base.game, automaticPresses: true } };
    const cards = played(f.cards, 6, (player) => player === 0 ? 3 : 4);
    const result = calculateNassau(f.game, f.snapshot, cards);
    const front = result.matches[0]?.bets.filter((bet) => bet.segment === 'front') ?? [];
    expect(front.map((bet) => [bet.origin, bet.startHole, bet.endHole]))
      .toEqual([['primary', 1, 9], ['automatic', 3, 9], ['automatic', 5, 9], ['automatic', 7, 9]]);
    expect(front.every((bet) => bet.stakeMinor === 100)).toBe(true);
    expect(front[1]?.parentBetId).toBe(front[0]?.id);
    expect(front[0]?.status).toBe('won');
    expect(result.settlement.status).toBe('partial');
  });

  it('does not rearm on recovery and does not traverse a pending gap; back nine is independent', () => {
    const base = fixture();
    const f = { ...base, game: { ...base.game, automaticPresses: true } };
    const recovery = played(f.cards, 6, (player, hole) => player === (hole === 3 || hole === 4 ? 1 : 0) ? 3 : 4);
    const result = calculateNassau(f.game, f.snapshot, recovery);
    const primary = `${f.matchId}:front`;
    expect(result.matches[0]?.bets.filter((bet) => bet.parentBetId === primary)).toHaveLength(1);
    const gap = strokeGameCards(played(f.cards, 18, (player) => player === 0 ? 3 : 4), 2, [{ kind: 'unplayed' }]);
    const gaps = calculateNassau(f.game, f.snapshot, gap);
    expect(gaps.matches[0]?.bets.filter((bet) => bet.origin === 'automatic' && bet.segment !== 'back')).toEqual([]);
    expect(gaps.matches[0]?.bets.some((bet) => bet.origin === 'automatic' && bet.segment === 'back' && bet.startHole === 12)).toBe(true);
  });

  it('allows a next-hole press even after a mathematical clinch but never beyond the parent end', () => {
    const base = fixture();
    const f = { ...base, game: { ...base.game, automaticPresses: true } };
    const cards = played(f.cards, 8, (player, hole) => hole <= 6 ? 4 : player === 0 ? 3 : 4);
    const result = calculateNassau(f.game, f.snapshot, cards);
    expect(result.matches[0]?.bets.find((bet) => bet.id === `${f.matchId}:front`)?.status).toBe('won');
    expect(result.matches[0]?.bets.find((bet) => bet.parentBetId === `${f.matchId}:front`)).toMatchObject({ startHole: 9, endHole: 9 });
    expect(result.pressOptions.some((option) => option.parentBetId === `${f.matchId}:front` && option.startHole === 9)).toBe(true);
    const completed = calculateNassau(f.game, f.snapshot, played(f.cards, 18, (player, hole) => hole <= 6 ? 4 : player === 0 ? 3 : 4));
    expect(completed.pressOptions).toEqual([]);
    expect(completed.matches.flatMap((match) => match.bets).every((bet) => bet.startHole <= bet.endHole && bet.endHole <= 18)).toBe(true);
  });

  it('validates manual source proofs and keeps historical presses valid after more saved scores or peer-etag changes', () => {
    const f = fixture();
    const cards = played(f.cards, 2, (player) => player === 0 ? 3 : 4);
    const press = declaration(f, cards);
    expect(validateNassauManualPress(f.game, f.snapshot, cards, [], press)).toEqual({ valid: true });
    expect(validateNassauManualPress(f.game, f.snapshot, cards, [], { ...press, pressingSide: 'a' }).valid).toBe(false);
    const records = [pressRecord(f.game.id, press)];
    expect(validateNassauManualPress(f.game, f.snapshot, cards, records, press)).toEqual({ valid: false, reason: 'duplicate-id' });
    const later = played(f.cards, 18, (player) => player === 0 ? 3 : 4);
    const result = calculateNassau(f.game, f.snapshot, later, records);
    expect(result.matches[0]?.bets.find((bet) => bet.id === nassauManualBetId(f.game.id, press.id))).toMatchObject({
      origin: 'manual', startHole: 3, endHole: 9, status: 'won', stakeMinor: 100,
    });
    expect(revalidateNassauManualPress(f.game, f.snapshot, later, records, press)).toEqual({ valid: true });
    expect(calculateNassau(f.game, f.snapshot, later, records.map((entry) => ({ ...entry, gameEtag: 'fictional-new-peer-revision' })))).toEqual(result);
    expect(validateNassauManualPress(f.game, f.snapshot, later, [], press).valid).toBe(false);
  });

  it('supports manual presses on manual presses, independent of stored declaration order', () => {
    const f = fixture();
    const firstCards = played(f.cards, 2, (player) => player === 0 ? 3 : 4);
    const first = declaration(f, firstCards);
    const firstRecord = pressRecord(f.game.id, first);
    const laterCards = played(f.cards, 4, (player) => player === 0 ? 3 : 4);
    const second = declaration(f, laterCards, [firstRecord], nassauManualBetId(f.game.id, first.id), strokeGameId(981));
    const result = calculateNassau(f.game, f.snapshot, laterCards, [pressRecord(f.game.id, second), firstRecord]);
    expect(result.stalePresses).toEqual([]);
    expect(result.matches[0]?.bets.filter((bet) => bet.origin === 'manual').map((bet) => bet.startHole)).toEqual([3, 5]);
  });

  it('stores a staged press on its starting hole while proving only the acknowledged preceding prefix', () => {
    const f = fixture();
    const acknowledged = played(f.cards, 3, (player) => player === 0 ? 3 : 4);
    const press = declaration(f, acknowledged);
    expect(press).toMatchObject({ declaredAfterHole: 3, startHole: 4 });
    expect(validateNassauManualPress(f.game, f.snapshot, acknowledged, [], press)).toEqual({ valid: true });
    const saved = played(f.cards, 4, (player, hole) => player === (hole === 4 ? 1 : 0) ? 3 : 4);
    const records = [pressRecord(f.game.id, press)];
    expect(records[0]?.number).toBe(4);
    const result = calculateNassau(f.game, f.snapshot, saved, records);
    expect(result.stalePresses).toEqual([]);
    expect(result.matches[0]?.bets.find((bet) => bet.manualPress?.id === press.id))
      .toMatchObject({ startHole: 4, currentPosition: -1, status: 'pending' });
    expect(revalidateNassauManualPress(f.game, f.snapshot, saved, records, press)).toEqual({ valid: true });
    const previousHoleRecords = records.map((entry) => ({ ...entry, number: press.declaredAfterHole }));
    expect(calculateNassau(f.game, f.snapshot, saved, previousHoleRecords).stalePresses).toEqual([press]);
    expect(revalidateNassauManualPress(f.game, f.snapshot, saved, previousHoleRecords, press).valid).toBe(false);
  });

  it('retains stale manual money as unavailable after corrections change proof, revision, or automatic ancestry', () => {
    const f = fixture();
    const cards = played(f.cards, 2, (player) => player === 0 ? 3 : 4);
    const press = declaration(f, cards);
    const records = [pressRecord(f.game.id, press)];
    const correction = strokeGameCards(cards, 1, [{ kind: 'strokes', strokes: 5 }]);
    for (const result of [
      calculateNassau(f.game, f.snapshot, correction, records),
      calculateNassau(f.game, { ...f.snapshot, inputRevision: 'fictional-corrected-inputs' }, cards, records),
      calculateNassau({ ...f.game, stakes: { ...f.game.stakes, frontMinor: 101 } }, f.snapshot, cards, records),
    ]) {
      expect(result.stalePresses).toEqual([press]);
      expect(result.matches[0]?.bets.find((bet) => bet.origin === 'manual')).toMatchObject({ status: 'stale', settlement: { status: 'unavailable' } });
      expect(result.settlement.status).toBe('unavailable');
      expect(result.settlement.players.every((player) => player.netMinor === null)).toBe(true);
    }
    const auto = { ...f, game: { ...f.game, automaticPresses: true } };
    const four = played(f.cards, 4, (player) => player === 0 ? 3 : 4);
    const autoPress = declaration(auto, four, [], `${f.matchId}:front:auto:3`);
    const changed = strokeGameCards(four, 1, [{ kind: 'strokes', strokes: 4 }]);
    expect(calculateNassau(auto.game, f.snapshot, changed, [pressRecord(f.game.id, autoPress)]).stalePresses).toEqual([autoPress]);
  });

  it('creates automatic children from manual presses and binds manual declarations to the parent segment', () => {
    const base = fixture();
    const f = { ...base, game: { ...base.game, automaticPresses: true } };
    const first = played(f.cards, 2, (player) => player === 0 ? 3 : 4);
    const press = declaration(f, first);
    const result = calculateNassau(f.game, f.snapshot, played(f.cards, 6, (player) => player === 0 ? 3 : 4), [pressRecord(f.game.id, press)]);
    const child = result.matches[0]?.bets.find((bet) => bet.parentBetId === nassauManualBetId(f.game.id, press.id));
    expect(child).toMatchObject({ origin: 'automatic', startHole: 5, endHole: 9, stakeMinor: 100 });
    const backCards = played(f.cards, 11, (player, hole) => hole < 10 ? 4 : player === 0 ? 3 : 4);
    const backPress = declaration(f, backCards, [], `${f.matchId}:back`, strokeGameId(982));
    const back = calculateNassau(f.game, f.snapshot, backCards, [pressRecord(f.game.id, backPress)]);
    expect(back.matches[0]?.bets.find((bet) => bet.manualPress?.id === backPress.id))
      .toMatchObject({ segment: 'back', startHole: 12, endHole: 18, stakeMinor: 200 });
  });

  it('fails closed visibly for unknown, cyclic, duplicate, or malformed declaration references', () => {
    const f = fixture();
    const cards = played(f.cards, 2, (player) => player === 0 ? 3 : 4);
    const good = declaration(f, cards);
    const cycle = { ...good, parentBetId: nassauManualBetId(f.game.id, good.id) };
    const unknown = { ...good, matchId: 'unknown-match' };
    const badStart = { ...good, startHole: 2 };
    for (const press of [cycle, unknown, badStart]) {
      const result = calculateNassau(f.game, f.snapshot, cards, [pressRecord(f.game.id, press)]);
      expect(result.stalePresses).toEqual([press]);
      expect(result.settlement.status).toBe('unavailable');
    }
    const duplicate = { ...pressRecord(f.game.id, good), presses: [good, good] };
    const result = calculateNassau(f.game, f.snapshot, cards, [duplicate]);
    expect(result.stalePresses).toHaveLength(2);
    expect(result.settlement.status).toBe('unavailable');
    const invalid = calculateNassau(f.game, f.snapshot, cards, [record(f.game.id, 'unknown-match', 1, 'halved')]);
    expect(invalid.issues).toContainEqual({ code: 'unknown-match', number: 1 });
    expect(invalid.pressOptions).toEqual([]);
  });
});
