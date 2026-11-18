import { describe, expect, it } from 'vitest';
import { calculateDots, dotsDeclarationIssues, dotsDefinitionMatchesRound, dotsSpecialCatalog, dotsRecordsMatchGame } from './dots.js';
import type { DotsContest, DotsGameDefinition, DotsHoleRecord, DotsPlayerDeclaration, DotsSpecialKind } from './dots.js';
import type { DotHoleContext, DotRoundInput } from './dot-context.js';
import type { HoleScore } from './scoring.js';

const ids = ['A', 'B', 'C', 'D'];
function fixture(pars: readonly number[] = [4], kinds: readonly DotsSpecialKind[] = dotsSpecialCatalog.map((entry) => entry.kind)) {
  const layout = pars.map((par, index) => ({ number: index + 1, par, sourceId: index + 1, allocation: index + 1, length: 300 }));
  const game: DotsGameDefinition = { id: 'dots-A', name: 'Dots A', kind: 'dots', version: 1,
    groupNumber: 1, playerIds: ids, mode: 'individual', stakeMinor: null,
    specials: kinds.map((kind) => ({ kind, units: dotsSpecialCatalog.find((entry) => entry.kind === kind)?.defaultUnits ?? 1 })) };
  const round: DotRoundInput = { layout, groups: [{ number: 1, playerIds: ids }],
    cards: ids.map((playerId) => ({ playerId, displayName: playerId, etag: null, updatedAt: null,
      holes: layout.map((hole) => ({ number: hole.number, score: { kind: 'strokes', strokes: hole.par } })) })) };
  return { game, round };
}
function record(number = 1, players: readonly DotsPlayerDeclaration[] = [], contests: readonly DotsContest[] = []): DotsHoleRecord {
  return { number, gameId: 'dots-A', gameEtag: 'revision-A', players, contests };
}
function declaration(playerId: string, counts: DotsPlayerDeclaration['counts'] = {}, calls: DotsPlayerDeclaration['calls'] = []): DotsPlayerDeclaration {
  return { playerId, counts, calls };
}
function setScores(round: DotRoundInput, playerId: string, scores: readonly HoleScore[]): DotRoundInput {
  return { ...round, cards: round.cards.map((card) => card.playerId === playerId
    ? { ...card, holes: card.holes.map((hole, index) => ({ ...hole, score: scores[index] ?? hole.score })) } : card) };
}
const totals = (result: ReturnType<typeof calculateDots>) => result.players.map((player) => player.totalPoints);
const fixed = (game: DotsGameDefinition): Extract<DotsGameDefinition, { readonly mode: 'fixed' }> => ({
  id: game.id, name: game.name, kind: 'dots', version: 1, groupNumber: 1, playerIds: ids,
  specials: game.specials, mode: 'fixed', partnerIds: ids, stakeMinor: null,
});
function linked(game: DotsGameDefinition): DotsGameDefinition {
  return { id: game.id, name: game.name, kind: 'dots', version: 1, groupNumber: 1, playerIds: ids,
    mode: 'linked', linkedGameId: 'base-A', specials: game.specials };
}
function context(number = 1, multiplier: 1 | 2 | 3 = 1, sides: readonly (readonly string[])[] = [['A', 'B'], ['C', 'D']]): DotHoleContext {
  return { number, status: 'ready', sides, multiplier, sourceGameId: 'base-A' };
}

describe('source-only Dots declaration review', () => {
  it.each([0, 1, 2] as const)('rejects Churchie-only Murphy stage %i in ordinary individual, fixed, linked and rotating Dots', (murphyPresses) => {
    const f = fixture([4], ['murphy']);
    const rotating: DotsGameDefinition = { id: f.game.id, name: f.game.name, kind: 'dots', version: 2,
      mode: 'rotating', rotationHoles: 3, groupNumber: 1, playerIds: ids, specials: f.game.specials, stakeMinor: null };
    for (const game of [f.game, fixed(f.game), linked(f.game), rotating]) {
      const records = [{ ...record(1, [declaration('A', {}, [{
        id: 'murphy-call', kind: 'murphy', result: 'success', murphyPresses,
      }])]), ...(game.version === 2 ? { rotation: { playerIds: ids } } : {}) }];
      expect(dotsRecordsMatchGame(records, game, f.round, [context(1, 2)])).toBe(false);
      const result = calculateDots(game, f.round, records, [context(1, 2)]);
      expect(result.status).toBe('unavailable');
      expect(result.awards).toEqual([]);
    }
  });

  it('keeps current-stake Sweep confined to the internal Churchie profile, preserving ordinary linked multipliers', () => {
    const f = fixture([4], ['sweep']);
    const game = linked({ ...f.game, specials: [{ kind: 'sweep', units: 2 }] });
    const contexts: readonly DotHoleContext[] = [{ ...context(1, 2), sweepMultiplier: 3,
      highWinnerIds: ['A', 'B'], lowWinnerIds: ['A', 'B'] }];
    expect(calculateDots(game, f.round, [], contexts).awards[0]).toMatchObject({ kind: 'sweep', count: 1, dots: 4 });
    expect(calculateDots(game, f.round, [], contexts, 'churcie-v3').awards[0])
      .toMatchObject({ kind: 'sweep', count: 3, dots: 12 });
  });

  it.each([
    [{ hogan: 1, seve: 1 }, [], 'HOGAN_SEVE'],
    [{ pully: 1, dime: 1 }, [], 'PULLY_DIME'],
    [{ pully: 1, 'super-dime': 1 }, [], 'PULLY_DIME'],
    [{ hogan: 1, chippy: 1 }, [], 'HOGAN_CHIPPY'],
    [{ dime: 1, 'super-dime': 1 }, [], 'DIME_SUPER_DIME'],
    [{ hogan: 1 }, [{ id: 'call', kind: 'murphy', result: 'pending' }], 'HOGAN_MURPHY'],
    [{ hogan: 1 }, [{ id: 'call', kind: 'murphy', result: 'failure' }], 'HOGAN_MURPHY'],
  ] satisfies readonly (readonly [DotsPlayerDeclaration['counts'], DotsPlayerDeclaration['calls'], string])[])(
    'reports incompatible source declarations %j %j', (counts, calls, code) => {
      expect(dotsDeclarationIssues(declaration('A', counts, calls))).toMatchObject({ conflicts: [{ code }], warnings: [] });
    },
  );

  it('warns without forbidding Hogan/Seve and Walk, ignores zeros and unrelated calls', () => {
    expect(dotsDeclarationIssues(declaration('A', { hogan: 1, walk: 1 }))).toEqual({
      conflicts: [], warnings: [{ code: 'HOGAN_WALK', kinds: ['hogan', 'walk'] }],
    });
    expect(dotsDeclarationIssues(declaration('A', { seve: 1, walk: 1 }))).toEqual({
      conflicts: [], warnings: [{ code: 'SEVE_WALK', kinds: ['seve', 'walk'] }],
    });
    expect(dotsDeclarationIssues(declaration('A', { hogan: 1, seve: 0 }, [
      { id: 'call', kind: 'paree', result: 'success' },
    ]))).toEqual({ conflicts: [], warnings: [] });
    const { game, round } = fixture([5], ['hogan', 'walk']);
    expect(totals(calculateDots(game, round, [record(1, [declaration('A', { hogan: 1, walk: 1 })])]))).toEqual([1, 1, 1, 1]);
  });

  it('does not retroactively invalidate or change v1 individual, fixed or linked awards', () => {
    const { game, round } = fixture([4], ['hogan', 'seve', 'pully', 'dime', 'murphy', 'chippy']);
    const records = [record(1, [declaration('A', { hogan: 1, seve: 1, pully: 1, dime: 1, chippy: 1 },
      [{ id: 'call-A', kind: 'murphy', result: 'success' }])])];
    expect(dotsDeclarationIssues(records[0]?.players[0] ?? declaration('A')).conflicts.length).toBe(4);
    for (const candidate of [game, fixed(game), linked(game)]) {
      expect(dotsRecordsMatchGame(records, candidate, round)).toBe(true);
      const result = calculateDots(candidate, round, records, [context(1, 2)]);
      expect(result.status).toBe('complete');
      expect(result).not.toHaveProperty('rotation');
      expect(result.players.map((player) => player.totalPoints)).toEqual(candidate.mode === 'individual'
        ? [6, 0, 0, 0] : candidate.mode === 'fixed' ? [6, 6, 0, 0] : [12, 12, 0, 0]);
    }
  });
});

describe('independent Dots earning and declarations', () => {
  it.each([1, 2, 3, 4])('keeps %i individual golfers on singleton sides with actual opponents only', (count) => {
    const f = fixture([4], ['sandy', 'walk', 'pickup', 'murphy', 'paree', 'pully-murphy']);
    const playerIds = ids.slice(0, count);
    const game = { ...f.game, playerIds };
    const round = { ...f.round, groups: [{ number: 1, playerIds }], cards: f.round.cards.slice(0, count) };
    const records = [record(1, [declaration('A', { sandy: 2, walk: 1, pickup: 1 }, [
      { id: 'call-murphy', kind: 'murphy', result: 'failure' },
      { id: 'call-paree', kind: 'paree', result: 'failure' },
      { id: 'call-pully', kind: 'pully-murphy', result: 'failure' },
    ])])];
    expect(dotsDefinitionMatchesRound(game, round)).toBe(true);
    expect(dotsRecordsMatchGame(records, game, round)).toBe(true);
    const result = calculateDots(game, round, records);
    expect(result.status).toBe('complete');
    expect(totals(result)).toEqual([2, ...playerIds.slice(1).map(() => 5)]);
    expect(result.awards.every((award) => award.recipientIds.length > 0)).toBe(true);
    expect(result.awards.find((award) => award.kind === 'sandy')?.recipientIds).toEqual(['A']);
    expect(result.awards.find((award) => award.kind === 'walk')?.recipientIds)
      .toEqual(count === 1 ? undefined : playerIds.slice(1));
    if (count < 4) {
      expect(dotsDefinitionMatchesRound({ ...fixed(f.game), playerIds, partnerIds: playerIds }, round)).toBe(false);
      expect(dotsDefinitionMatchesRound({ ...linked(f.game), playerIds }, round)).toBe(false);
      expect(dotsDefinitionMatchesRound({ id: game.id, name: game.name, kind: 'dots', version: 2,
        mode: 'rotating', rotationHoles: 3, groupNumber: 1, playerIds, stakeMinor: null, specials: [] }, round)).toBe(false);
    }
    expect(dotsDefinitionMatchesRound({ ...game, playerIds: [...playerIds, 'outsider'] }, round)).toBe(false);
    if (count === 1) expect(dotsDefinitionMatchesRound({ ...game, stakeMinor: 1 }, round)).toBe(false);
  });

  it('retains solo positive automatic awards and pending score/call states without fictitious failure awards', () => {
    const f = fixture([4], ['birdie', 'walk', 'pickup', 'murphy']);
    const game = { ...f.game, playerIds: ['A'] };
    const round = { ...f.round, groups: [{ number: 1, playerIds: ['A'] }], cards: f.round.cards.slice(0, 1) };
    const records = [record(1, [declaration('A', { walk: 1, pickup: 1 },
      [{ id: 'failed', kind: 'murphy', result: 'failure' }])])];
    expect(totals(calculateDots(game, setScores(round, 'A', [{ kind: 'strokes', strokes: 3 }]), records))).toEqual([2]);
    expect(calculateDots(game, setScores(round, 'A', [{ kind: 'picked-up' }]), records))
      .toMatchObject({ status: 'complete', awards: [], players: [{ totalPoints: 0 }] });
    expect(calculateDots(game, setScores(round, 'A', [{ kind: 'unplayed' }]), records).status).toBe('in-progress');
    expect(calculateDots(game, round, [record(1, [declaration('A', {},
      [{ id: 'pending', kind: 'murphy', result: 'pending' }])])]).status).toBe('in-progress');
  });

  it('records three Sandys plus a separately called Paree, and each partner’s own achievements', () => {
    const { game, round } = fixture([4], ['sandy', 'paree', 'murphy', 'walk', 'pickup']);
    const records = [record(1, [
      declaration('A', { sandy: 3 }, [{ id: 'call-A', kind: 'paree', result: 'success' }]),
      declaration('B', { sandy: 1 }, [{ id: 'call-B', kind: 'murphy', result: 'success' }]),
      declaration('C', { sandy: 1 }),
    ])];
    expect(totals(calculateDots(fixed(game), round, records))).toEqual([6, 6, 1, 1]);
    expect(totals(calculateDots(game, round, records))).toEqual([4, 2, 1, 0]);
    expect(calculateDots(game, round, records).awards[0]).toMatchObject({ count: 3, source: 'manual', dots: 3 });
  });

  it('awards Walk, explicit Pickup and failed calls to opponents without negative points', () => {
    const { game, round } = fixture([4], ['walk', 'pickup', 'murphy', 'pully-murphy']);
    const records = [record(1, [declaration('A', { walk: 1, pickup: 1 }, [
      { id: 'call-A', kind: 'murphy', result: 'failure' },
      { id: 'call-B', kind: 'pully-murphy', result: 'failure' },
    ])])];
    expect(totals(calculateDots(game, round, records))).toEqual([0, 4, 4, 4]);
    expect(totals(calculateDots(fixed(game), round, records))).toEqual([0, 0, 4, 4]);
    const lone = context(1, 2, [['A'], ['B', 'C', 'D']]);
    expect(totals(calculateDots(linked(game), round, records, [lone]))).toEqual([0, 8, 8, 8]);
  });

  it('multiplies specials on both sides and retains individual achievements through partner changes', () => {
    const { game, round } = fixture([4, 4], ['sandy', 'pully']);
    const records = [record(1, [declaration('A', { sandy: 1 }), declaration('B', { pully: 1 })]),
      record(2, [declaration('A', { sandy: 1 })])];
    const result = calculateDots(linked(game), round, records,
      [context(1, 2, [['A'], ['B', 'C', 'D']]), context(2, 3, [['A', 'C'], ['B', 'D']])]);
    expect(totals(result)).toEqual([5, 2, 5, 2]);
    expect(result.holes[1]?.awards[0]?.recipientIds).toEqual(['A', 'C']);
  });

  it.each(['hogan', 'seve', 'sandy', 'haz-par', 'chippy'] as const)('%s qualifies on gross birdie and eagle using personal par', (kind) => {
    const { game, round } = fixture([3], [kind]);
    for (const strokes of [2, 1]) {
      expect(totals(calculateDots(game, setScores(round, 'A', [{ kind: 'strokes', strokes }]),
        [record(1, [declaration('A', { [kind]: 1 })])]))).toEqual([1, 0, 0, 0]);
    }
    const personal = { ...round, playerLayouts: [{ playerId: 'A', layout: round.layout.map((hole) => ({ ...hole, par: 5 })) }] };
    expect(totals(calculateDots(game, personal, [record(1, [declaration('A', { [kind]: 1 })])]))).toEqual([1, 0, 0, 0]);
  });

  it('keeps called Pully Murphy at gross par and explicitly stacks independent calls', () => {
    const { game, round } = fixture([4], ['pully', 'murphy', 'pully-murphy']);
    const records = [record(1, [declaration('A', { pully: 1 }, [
      { id: 'call-A', kind: 'murphy', result: 'success' }, { id: 'call-B', kind: 'pully-murphy', result: 'success' },
    ])])];
    expect(totals(calculateDots(game, round, records))).toEqual([3, 0, 0, 0]);
    expect(calculateDots(game, setScores(round, 'A', [{ kind: 'strokes', strokes: 3 }]), records).status).toBe('unavailable');
    const pending = [record(1, [declaration('A', {}, [{ id: 'call-A', kind: 'murphy', result: 'pending' }])])];
    expect(calculateDots(game, round, pending)).toMatchObject({ status: 'in-progress', awards: [] });
  });

  it('shares a declared birdie Pully and qualified Hogan alongside automatic Birdie without inventing Hogan', () => {
    const { game, round } = fixture([4], ['pully', 'hogan', 'birdie']);
    const birdie = setScores(round, 'A', [{ kind: 'strokes', strokes: 3 }]);
    const records = [record(1, [declaration('A', { pully: 1, hogan: 1 })])];
    expect(dotsRecordsMatchGame(records, game, birdie)).toBe(true);
    for (const candidate of [fixed(game), linked(game)]) {
      const result = calculateDots(candidate, birdie, records, [context()]);
      expect(result.status).toBe('complete');
      expect(result.awards.map((award) => [award.kind, award.dots])).toEqual([['hogan', 1], ['pully', 1], ['birdie', 2]]);
      expect(totals(result)).toEqual([4, 4, 0, 0]);
    }
    const automatic = calculateDots(game, birdie, []);
    expect(automatic.awards.map((award) => award.kind)).toEqual(['birdie']);
    expect(totals(automatic)).toEqual([2, 0, 0, 0]);
    for (const score of [{ kind: 'strokes', strokes: 5 }, { kind: 'picked-up' }, { kind: 'did-not-finish' }] satisfies readonly HoleScore[]) {
      expect(dotsRecordsMatchGame(records, game, setScores(round, 'A', [score]))).toBe(false);
    }
  });

  it('keeps stable call IDs only in ledger bookkeeping, not player-facing explanations', () => {
    const { game, round } = fixture([4], ['paree']);
    const callId = '00000000-0000-4000-8000-000000000001';
    const result = calculateDots(game, round, [record(1, [declaration('A', {}, [
      { id: callId, kind: 'paree', result: 'success' },
    ])])]);
    expect(result.awards[0]?.id).toContain(callId);
    expect(result.awards[0]?.reason).toBe('Paree call: success.');
    expect(result.awards[0]?.reason).not.toContain(callId);
  });

  it('Gorilla needs personal par 5, not a par-or-better finish; SuperDime replaces Dime', () => {
    const { game, round } = fixture([5], ['gorilla', 'dime', 'super-dime']);
    const worse = setScores(round, 'A', [{ kind: 'strokes', strokes: 8 }]);
    expect(totals(calculateDots(game, worse, [record(1, [declaration('A', { gorilla: 1, 'super-dime': 1 })])]))).toEqual([2, 0, 0, 0]);
    expect(dotsRecordsMatchGame([record(1, [declaration('A', { dime: 1, 'super-dime': 1 })])], game, round)).toBe(false);
  });

  it('never infers manual Pickup or a completed numeric score from X7/DNF', () => {
    const { game, round } = fixture([4, 4, 4], ['pickup', 'birdie', 'eagle', 'string']);
    const changed = setScores(round, 'A', [{ kind: 'picked-up', reportedStrokes: 3 },
      { kind: 'did-not-finish' }, { kind: 'picked-up', reportedStrokes: 7 }]);
    const result = calculateDots(game, changed, []);
    expect(result.awards.filter((award) => award.earnedBy === 'A')).toEqual([]);
    expect(result.status).toBe('complete');
  });
});

describe('automatic gross awards and actual-order dependencies', () => {
  it.each([['kp', 3], ['blue-plate', 5], ['long-drive', 5]] as const)(
    'uses an optional second %s qualifier only for same-side Assassin, never a second category win', (kind, par) => {
      const { game, round } = fixture([par], [kind, 'assassin']);
      const candidate = fixed(game);
      const first: DotsContest = { kind, status: 'awarded', winnerId: 'A' };
      for (const secondId of [undefined, 'B', 'C']) {
        const contest = { ...first, ...(secondId ? { secondId } : {}) };
        const records = [record(1, [], [contest])];
        const result = calculateDots(candidate, round, records);
        const assassin = secondId === 'B' ? 1 : 0;
        expect(result.awards.filter((award) => award.kind === kind)).toHaveLength(1);
        expect(result.awards.filter((award) => award.kind === 'assassin')).toHaveLength(assassin);
        expect(result.awards.filter((award) => award.kind === kind || award.kind === 'assassin')
          .reduce((sum, award) => sum + award.dots, 0)).toBe(1 + assassin);
      }
      const solo = calculateDots(linked(game), round, [record(1, [], [{ ...first, secondId: 'B' }])],
        [context(1, 2, [['A'], ['B', 'C', 'D']])]);
      expect(solo.awards.some((award) => award.kind === 'assassin')).toBe(false);
    },
  );

  it('Eagle excludes Birdie but continues BirdyString; albatross has no invented base award', () => {
    const { game, round } = fixture([5, 5, 5, 5], ['birdie', 'eagle', 'birdy-string']);
    const result = calculateDots(game, setScores(round, 'A', [4, 3, 4, 2].map((strokes) => ({ kind: 'strokes', strokes }))), []);
    expect(result.awards.map((award) => [award.number, award.kind, award.dots])).toEqual([
      [1, 'birdie', 2], [2, 'eagle', 5], [3, 'birdie', 2], [3, 'birdy-string', 1], [4, 'birdy-string', 1],
    ]);
    expect(totals(result)).toEqual([11, 0, 0, 0]);
  });

  it('follows a starting-hole circuit across the turn without retroactive String bonuses', () => {
    const { game, round } = fixture(Array.from({ length: 18 }, () => 4), ['string']);
    const rotated = { ...round, groups: [{ number: 1, playerIds: ids, startingHole: 10 }] };
    const result = calculateDots(game, rotated, []);
    expect(result.awards.filter((award) => award.earnedBy === 'A').map((award) => award.number))
      .toEqual([12, 13, 14, 15, 16, 17, 18, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(result.players[0]).toMatchObject({ totalPoints: 16, frontPoints: 9, backPoints: 7, playingHandicap: null });
  });

  it('keeps unknown prefixes pending, then recovers after three known qualifiers or a known break', () => {
    const { game, round } = fixture([4, 4, 4, 4, 4], ['string']);
    const unknown = setScores(round, 'A', [{ kind: 'unplayed' }]);
    const result = calculateDots(game, unknown, []);
    expect(result.holes.map((hole) => hole.status)).toEqual(['pending', 'pending', 'pending', 'complete', 'complete']);
    expect(result.awards.filter((award) => award.earnedBy === 'A').map((award) => award.number)).toEqual([4, 5]);
    const broken = setScores(unknown, 'A', [{ kind: 'unplayed' }, { kind: 'strokes', strokes: 3 }]);
    expect(calculateDots(game, broken, []).holes.map((hole) => hole.status)).toEqual(['pending', 'complete', 'complete', 'complete', 'complete']);
  });

  it('distinguishes known zero from all-future pending and missing/invalid contexts', () => {
    const { game, round } = fixture([4], ['birdie']);
    expect(totals(calculateDots(game, round, []))).toEqual([0, 0, 0, 0]);
    const future = { ...round, cards: round.cards.map((card) => ({ ...card, holes: [{ number: 1, score: { kind: 'unplayed' as const } }] })) };
    expect(totals(calculateDots(game, future, []))).toEqual([null, null, null, null]);
    expect(calculateDots(linked(game), round, []).status).toBe('in-progress');
    expect(calculateDots(linked(game), round, [], [{ ...context(), sourceGameId: 'other' }]).status).toBe('unavailable');
  });

  it('preserves pending final-hole contexts with no selected sides until comeback composition resolves', () => {
    const { game, round } = fixture([4], ['sandy']);
    const records = [record(1, [declaration('A', { sandy: 1 })])];
    const waiting: DotHoleContext = { number: 1, status: 'pending', sides: [], multiplier: 1, reason: 'comeback-pending' };
    expect(calculateDots(linked(game), round, records, [waiting]))
      .toMatchObject({ status: 'in-progress', awards: [], holes: [{ number: 1, status: 'pending' }] });
    const unavailable: DotHoleContext = { ...waiting, status: 'unavailable', reason: 'comeback-unavailable' };
    expect(calculateDots(linked(game), round, records, [unavailable]).holes[0])
      .toMatchObject({ status: 'unavailable', reason: 'comeback-unavailable' });
    expect(totals(calculateDots(linked(game), round, records, [context()]))).toEqual([1, 1, 0, 0]);
  });
});

describe('contests, carry, King and derived partner specials', () => {
  it('collects two no-qualifier carries with the winning-hole multiplier, then earns individual King', () => {
    const { game, round } = fixture([3, 3, 3, 3], ['kp', 'king-of-the-hill']);
    const records = [record(1, [], [{ kind: 'kp', status: 'no-qualifier' }]),
      record(2, [], [{ kind: 'kp', status: 'no-qualifier' }]),
      record(3, [], [{ kind: 'kp', status: 'awarded', winnerId: 'A' }]),
      record(4, [], [{ kind: 'kp', status: 'awarded', winnerId: 'A' }])];
    const result = calculateDots(linked(game), round, records, [context(1), context(2), context(3, 2), context(4)]);
    expect(result.awards.map((award) => [award.number, award.dots, award.recipientIds])).toEqual([
      [3, 6, ['A', 'B']], [4, 1, ['A', 'B']], [null, 1, ['A']],
    ]);
    expect(result.awards[0]?.sourceHoles).toEqual([1, 2, 3]);
    expect(totals(result)).toEqual([8, 7, 0, 0]);
    expect(result.players[0]?.frontPoints).toBe(7);
  });

  it('does not count shared teammate credit as ownership and leaves final carry unawarded', () => {
    const { game, round } = fixture([3, 3, 3, 3], ['kp', 'king-of-the-hill']);
    const records = [1, 2, 3].map((number) => record(number, [], [{ kind: 'kp', status: 'awarded', winnerId: 'A' }]));
    const result = calculateDots(fixed(game), round, [...records, record(4, [], [{ kind: 'kp', status: 'no-qualifier' }])]);
    expect(result.unawarded).toEqual([{ kind: 'kp', sourceHoles: [4], units: 1 }]);
    expect(result.awards.some((award) => award.kind === 'king-of-the-hill')).toBe(false);
    const shared = calculateDots(fixed(game), round, [...records, record(4, [], [{ kind: 'kp', status: 'awarded', winnerId: 'B' }])]);
    expect(shared.awards.some((award) => award.kind === 'king-of-the-hill')).toBe(false);
  });

  it('carries in actual order 13,17,3,9 from hole 10 and never wraps twice', () => {
    const { game, round } = fixture(Array.from({ length: 18 }, (_, index) => [3, 9, 13, 17].includes(index + 1) ? 3 : 4), ['kp']);
    const rotated = { ...round, groups: [{ number: 1, playerIds: ids, startingHole: 10 }] };
    const records = [record(13, [], [{ kind: 'kp', status: 'no-qualifier' }]),
      record(17, [], [{ kind: 'kp', status: 'awarded', winnerId: 'A' }]),
      record(3, [], [{ kind: 'kp', status: 'no-qualifier' }]),
      record(9, [], [{ kind: 'kp', status: 'no-qualifier' }])];
    const result = calculateDots(game, rotated, records);
    expect(result.awards[0]).toMatchObject({ number: 17, sourceHoles: [13, 17], dots: 2 });
    expect(result.unawarded).toEqual([{ kind: 'kp', sourceHoles: [3, 9], units: 2 }]);
  });

  it('blocks dependent carry/King on missing decisions while independent categories resolve', () => {
    const { game, round } = fixture([3, 5, 3], ['kp', 'blue-plate', 'king-of-the-hill']);
    const result = calculateDots(game, round, [
      record(2, [], [{ kind: 'blue-plate', status: 'awarded', winnerId: 'C' }]),
      record(3, [], [{ kind: 'kp', status: 'awarded', winnerId: 'A' }]),
    ]);
    expect(result.status).toBe('in-progress');
    expect(result.awards.map((award) => award.kind)).toEqual(['blue-plate']);
    expect(result.holes[2]?.reason).toBe('earlier-contest-unresolved');
  });

  it('uses variable category counts and independently awards all three individual Kings', () => {
    const { game, round } = fixture([3, 5, 3], ['kp', 'long-drive', 'blue-plate', 'king-of-the-hill']);
    const records = [record(1, [], [{ kind: 'kp', status: 'awarded', winnerId: 'A' }]),
      record(2, [], [{ kind: 'long-drive', status: 'awarded', winnerId: 'B' },
        { kind: 'blue-plate', status: 'awarded', winnerId: 'C' }]),
      record(3, [], [{ kind: 'kp', status: 'awarded', winnerId: 'A' }])];
    expect(calculateDots(game, round, records).awards.filter((award) => award.kind === 'king-of-the-hill')
      .map((award) => award.earnedBy)).toEqual(['A', 'C', 'B']);
    const future = setScores(round, 'D', [{ kind: 'unplayed' }]);
    expect(calculateDots(game, future, records).awards.some((award) => award.kind === 'king-of-the-hill')).toBe(false);
  });

  it('Assassin requires an explicit same-pair second approach; Sweep requires real linked High/Low', () => {
    const { game, round } = fixture([3], ['kp', 'assassin']);
    const records = [record(1, [], [{ kind: 'kp', status: 'awarded', winnerId: 'A', secondId: 'B' }])];
    expect(calculateDots(game, round, records).status).toBe('unavailable');
    expect(totals(calculateDots(fixed(game), round, records))).toEqual([2, 2, 0, 0]);
    const withSweep: DotsGameDefinition = { ...linked(game), specials: [...game.specials, { kind: 'sweep', units: 1 }] };
    const ctx = { ...context(), highWinnerIds: ['A', 'B'], lowWinnerIds: ['B', 'A'] };
    expect(totals(calculateDots(withSweep, round, records, [ctx]))).toEqual([3, 3, 0, 0]);
    expect(calculateDots(withSweep, round, records, [{ ...ctx, lowWinnerIds: ['C', 'D'] }])
      .awards.some((award) => award.kind === 'sweep')).toBe(false);
    const solo = { ...context(1, 3, [['A'], ['B', 'C', 'D']]) };
    expect(calculateDots(withSweep, round, records, [solo]).awards.map((award) => award.kind)).toEqual(['kp']);
  });

  it('makes standalone Sweep visibly unavailable instead of treating its unsupported selection as zero', () => {
    const { game, round } = fixture([4], ['sweep']);
    for (const definition of [game, fixed(game)]) {
      expect(calculateDots(definition, round, [])).toMatchObject({
        status: 'unavailable', issues: ['unsupported-dots-special-mode'],
        holes: [{ number: 1, status: 'unavailable', reason: 'unsupported-dots-special-mode' }],
      });
    }
  });

  it.each([
    {},
    { highWinnerIds: ['A', 'B'] },
    { lowWinnerIds: ['A', 'B'] },
    { highWinnerIds: [] },
  ])('keeps Sweep pending on missing linked High/Low, retaining independent shared specials: %j', (outcomes) => {
    const { game, round } = fixture([4], ['sandy', 'sweep']);
    const records = [record(1, [declaration('A', { sandy: 1 })])];
    const ctx = { ...context(), ...outcomes };
    const result = calculateDots(linked(game), round, records, [ctx]);
    expect(result.status).toBe('in-progress');
    expect(result.holes[0]?.reason).toBe('missing-sweep-outcome');
    expect(result.holes[0]?.points.every((point) => point.dots === null)).toBe(true);
    expect(result.awards.map((award) => award.kind)).toEqual(['sandy']);
    expect(totals(result)).toEqual([1, 1, null, null]);
    const resolved = calculateDots(linked(game), round, records, [{ ...context(), highWinnerIds: [], lowWinnerIds: [] }]);
    expect(resolved.status).toBe('complete');
    expect(totals(resolved)).toEqual([1, 1, 0, 0]);
    const withoutSweep = { ...linked(game), specials: [{ kind: 'sandy' as const, units: 1 }] };
    expect(calculateDots(withoutSweep, round, records, [ctx]).status).toBe('complete');
  });

  it('can select Assassin independently of KP/Blue Plate units without inventing those awards', () => {
    const { game, round } = fixture([3, 5], ['assassin']);
    const records = [
      record(1, [], [{ kind: 'kp', status: 'awarded', winnerId: 'A', secondId: 'B' }]),
      record(2, [], [{ kind: 'blue-plate', status: 'awarded', winnerId: 'C', secondId: 'D' }]),
    ];
    const result = calculateDots(fixed(game), round, records);
    expect(result.status).toBe('complete');
    expect(result.awards.map((award) => award.kind)).toEqual(['assassin', 'assassin']);
    expect(totals(result)).toEqual([1, 1, 1, 1]);
  });

  it('does not make Assassin dependent on an unresolved earlier category carry', () => {
    const { game, round } = fixture([3, 3], ['kp', 'assassin']);
    const result = calculateDots(fixed(game), round, [
      record(2, [], [{ kind: 'kp', status: 'awarded', winnerId: 'A', secondId: 'B' }]),
    ]);
    expect(result.status).toBe('in-progress');
    expect(result.awards.map((award) => award.kind)).toEqual(['assassin']);
    expect(totals(result)).toEqual([1, 1, null, null]);
  });

  it('preserves independent Long Drive and Blue Plate winners without a false three-of-four King', () => {
    const { game, round } = fixture([5, 5, 5, 5], ['long-drive', 'blue-plate', 'king-of-the-hill']);
    const long = ['B', 'C', 'A', 'B'], plate = ['C', 'C', 'D', 'C'];
    const records = round.layout.map((hole, index) => record(hole.number, [], [
      { kind: 'long-drive', status: 'awarded', winnerId: long[index] ?? 'A' },
      { kind: 'blue-plate', status: 'awarded', winnerId: plate[index] ?? 'A' },
    ]));
    const result = calculateDots(game, round, records);
    expect(totals(result)).toEqual([1, 2, 4, 1]);
    expect(result.awards.some((award) => award.kind === 'king-of-the-hill')).toBe(false);
  });

  it('fails closed on exact arithmetic overflow without rounding, mutation or arbitrary count ceilings', () => {
    const { game, round } = fixture([4], ['sandy']);
    const records = [record(1, [declaration('A', { sandy: Number.MAX_SAFE_INTEGER })])];
    const before = structuredClone({ game, round, records });
    expect(totals(calculateDots(game, round, records))).toEqual([Number.MAX_SAFE_INTEGER, 0, 0, 0]);
    expect(calculateDots(linked(game), round, records, [context(1, 3)]).status).toBe('unavailable');
    expect({ game, round, records }).toEqual(before);
    const two = fixture([4, 4], ['sandy']);
    expect(calculateDots(two.game, two.round, [...records, record(2, [declaration('A', { sandy: 1 })])]).status).toBe('unavailable');
  });
});
