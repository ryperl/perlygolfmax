import { describe, expect, it } from 'vitest';
import { calculateDots, dotsAutomaticWriteConflicts, dotsCoexistenceWriteConflicts, dotsCoexistenceWriteIssues, dotsDeclarationIssues, dotsDeclarationWriteIssues, dotsDefinitionMatchesRound, dotsSpecialCatalog, dotsRecordsMatchGame } from './dots.js';
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
  it('enforces Chippy/Pully per source in every individual size, fixed, rotating, linked and Churchie v3 mode', () => {
    const f = fixture([4], ['chippy', 'pully']);
    const rotating: DotsGameDefinition = { id: f.game.id, name: f.game.name, kind: 'dots', version: 2,
      groupNumber: 1, playerIds: ids, mode: 'rotating', rotationHoles: 3, stakeMinor: null, specials: f.game.specials };
    const churchie = { id: f.game.id, name: 'Fictional Churchie', kind: 'churchy' as const, version: 3 as const,
      groupNumber: 1, playerIds: ids, specials: f.game.specials, basis: 'net' as const,
      orderMode: 'tee' as const, amountPerDotMinor: 0, currency: 'USD' as const };
    const individual = [1, 2, 3, 4].map((count) => ({ ...f.game, playerIds: ids.slice(0, count) }));
    for (const game of [...individual, fixed(f.game), rotating, linked(f.game), churchie]) {
      const bad = record(1, [declaration('A', { chippy: 1, pully: 1 })]);
      expect(dotsCoexistenceWriteConflicts(game, f.round, f.round, [], [bad])).toEqual(['A']);
      expect(dotsCoexistenceWriteConflicts(game, f.round, f.round, [bad], [bad])).toEqual([]);
      const separate = record(1, [declaration('A', { chippy: 1 }), declaration('B', { pully: 1 })]);
      expect(dotsCoexistenceWriteConflicts(game, f.round, f.round, [], [separate])).toEqual([]);
    }
    const shared = calculateDots(fixed(f.game), f.round, [record(1, [
      declaration('A', { chippy: 1 }), declaration('B', { pully: 1 }),
    ])]);
    expect(shared.awards.map((award) => award.recipientIds)).toEqual([['A', 'B'], ['A', 'B']]);
    expect(dotsDeclarationWriteIssues(declaration('A', { chippy: 1, pully: 1 })).conflicts).toEqual([]);
  });

  it('checks actual KP/Long Drive source winners and seconds, never carry ownership, Blue Plate or Gorilla', () => {
    const f = fixture([3, 5, 5], ['seve', 'kp', 'long-drive', 'blue-plate', 'gorilla']);
    const source = declaration('A', { seve: 1 });
    for (const kind of ['kp', 'long-drive'] as const) {
      for (const selection of [{ winnerId: 'A' }, { winnerId: 'B', secondId: 'A' }]) {
        expect(dotsCoexistenceWriteIssues(source, { score: { kind: 'strokes', strokes: 3 }, par: 3,
          contests: [{ kind, status: 'awarded', ...selection }] }).conflicts)
          .toContainEqual({ code: 'SEVE_CATEGORY', kinds: ['seve', kind] });
      }
      expect(dotsCoexistenceWriteIssues(source, { contests: [{ kind, status: 'no-qualifier' }] }).conflicts).toEqual([]);
    }
    const saved = record(2, [source]);
    const selected = { ...saved, contests: [{ kind: 'long-drive' as const, status: 'awarded' as const, winnerId: 'B', secondId: 'A' }] };
    expect(dotsCoexistenceWriteConflicts(f.game, f.round, f.round, [saved], [selected])).toEqual(['A']);
    expect(dotsCoexistenceWriteConflicts(f.game, f.round, f.round, [selected], [selected])).toEqual([]);
    const allowed = record(2, [declaration('A', { seve: 1, gorilla: 1 })],
      [{ kind: 'blue-plate', status: 'awarded', winnerId: 'A' }]);
    expect(dotsCoexistenceWriteConflicts(f.game, f.round, f.round, [], [allowed])).toEqual([]);
    const carry = [record(2, [source], [{ kind: 'long-drive', status: 'no-qualifier' }]),
      record(3, [], [{ kind: 'long-drive', status: 'awarded', winnerId: 'A' }])];
    expect(dotsCoexistenceWriteConflicts(f.game, f.round, f.round, [], carry)).toEqual([]);
    expect(calculateDots(f.game, f.round, [selected]).issues).not.toContain('invalid-dots-records');
  });

  it('requires explicit repair for newly invalid manual score claims but permits historical and unrelated peer writes', () => {
    const f = fixture([4], ['hogan', 'seve', 'sandy', 'haz-par', 'chippy', 'pully', 'paree']);
    for (const kind of ['hogan', 'seve', 'sandy', 'haz-par', 'chippy', 'pully'] as const) {
      const saved = [record(1, [declaration('A', { [kind]: 1 })])];
      for (const score of [{ kind: 'strokes' as const, strokes: 5 }, { kind: 'picked-up' as const, reportedStrokes: 7 },
        { kind: 'did-not-finish' as const }]) {
        const next = setScores(f.round, 'A', [score]);
        expect(dotsCoexistenceWriteConflicts(f.game, f.round, next, saved, saved)).toEqual(['A']);
        expect(dotsCoexistenceWriteConflicts(f.game, next, next, saved, saved)).toEqual([]);
        expect(dotsCoexistenceWriteConflicts(f.game, next, setScores(next, 'B', [score]), saved, saved)).toEqual([]);
        expect(dotsCoexistenceWriteConflicts(f.game, f.round, next, saved, [record(1, [declaration('A')])])).toEqual([]);
      }
      expect(dotsCoexistenceWriteConflicts(f.game, f.round, setScores(f.round, 'A', [{ kind: 'unplayed' }]), saved, saved)).toEqual([]);
    }
    const called = [record(1, [declaration('A', {}, [{ id: 'fictional-call', kind: 'paree', result: 'success' }])])];
    expect(dotsCoexistenceWriteConflicts(f.game, f.round, setScores(f.round, 'A', [{ kind: 'strokes', strokes: 5 }]), called, called)).toEqual(['A']);
    const oldRound = setScores(f.round, 'A', [{ kind: 'strokes', strokes: 5 }]);
    const historical = [record(1, [declaration('A', { hogan: 1 })])];
    const peerEdit = [record(1, [declaration('A', { hogan: 1 }), declaration('B', { sandy: 1 })])];
    expect(dotsRecordsMatchGame(peerEdit, f.game, oldRound)).toBe(false);
    expect(dotsRecordsMatchGame(peerEdit, f.game, oldRound, [], { records: historical, round: oldRound })).toBe(true);
    expect(dotsCoexistenceWriteConflicts(f.game, oldRound, oldRound, historical, peerEdit)).toEqual([]);
  });

  it('excludes same-source Sandy/KP on the default par 3 regardless of personal tee par, in both edit directions', () => {
    const f = fixture([3], ['sandy', 'kp']);
    const source = declaration('A', { sandy: 1 });
    for (const selection of [{ winnerId: 'A' }, { winnerId: 'B', secondId: 'A' }]) {
      const contest: DotsContest = { kind: 'kp', status: 'awarded', ...selection };
      expect(dotsCoexistenceWriteIssues(source, { score: { kind: 'strokes', strokes: 4 }, par: 4,
        categoryPar: 3, contests: [contest] }).conflicts).toEqual([{ code: 'SANDY_KP', kinds: ['sandy', 'kp'] }]);
      const saved = record(1, [source]), selected = record(1, [source], [contest]);
      expect(dotsCoexistenceWriteConflicts(f.game, f.round, f.round, [saved], [selected])).toEqual(['A']);
      expect(dotsCoexistenceWriteConflicts(f.game, f.round, f.round, [record(1, [], [contest])], [selected])).toEqual(['A']);
      expect(dotsCoexistenceWriteConflicts(f.game, f.round, f.round, [selected], [selected])).toEqual([]);
      expect(dotsCoexistenceWriteConflicts(f.game, f.round, f.round, [selected], [saved])).toEqual([]);
    }
    expect(dotsCoexistenceWriteIssues(source, { categoryPar: 3, contests: [{ kind: 'kp', status: 'awarded', winnerId: 'B' }] }).conflicts).toEqual([]);
    expect(dotsCoexistenceWriteIssues(source, { categoryPar: 3, contests: [{ kind: 'kp', status: 'no-qualifier' }] }).conflicts).toEqual([]);
    expect(dotsCoexistenceWriteIssues(source, { categoryPar: 5, contests: [
      { kind: 'blue-plate', status: 'awarded', winnerId: 'A' }, { kind: 'long-drive', status: 'awarded', winnerId: 'A' },
    ] }).conflicts).toEqual([]);
    expect(dotsRecordsMatchGame([record(1, [source], [{ kind: 'kp', status: 'awarded', winnerId: 'A' }])], f.game, f.round)).toBe(true);
  });

  it('awards opt-in manual Sweep counts with actual teammates in every mode, without High/Low or gross qualifications', () => {
    const f = fixture([4, 4, 4, 4], ['sweep']);
    const rotating: DotsGameDefinition = { id: f.game.id, name: f.game.name, kind: 'dots', version: 2,
      groupNumber: 1, playerIds: ids, mode: 'rotating', rotationHoles: 3, stakeMinor: null, specials: f.game.specials };
    for (const base of [f.game, fixed(f.game), rotating, linked(f.game)]) {
      const game = { ...base, sweepRule: 'manual-v1' as const, specials: [{ kind: 'sweep' as const, units: 2 }] };
      const records = [record(4, [declaration('A', { sweep: 3 })]),
        ...(game.version === 2 ? [{ ...record(), rotation: { playerIds: ids } }] : [])];
      const round = setScores(f.round, 'A', f.round.layout.map(() => ({ kind: 'picked-up', reportedStrokes: 7 })));
      const result = calculateDots(game, round, records, f.round.layout.map((hole) => context(hole.number, 3)));
      expect(result.status).toBe('complete');
      expect(result.awards).toEqual([expect.objectContaining({ kind: 'sweep', source: 'manual', earnedBy: 'A',
        count: 3, units: 2, dots: game.mode === 'linked' ? 18 : 6,
        recipientIds: game.mode === 'individual' ? ['A'] : game.mode === 'rotating' ? ['A', 'C'] : ['A', 'B'] })]);
      expect(calculateDots(game, round, [], f.round.layout.map((hole) => ({
        ...context(hole.number), highWinnerIds: ['A', 'B'], lowWinnerIds: ['A', 'B'],
      }))).awards).toEqual([]);
      expect(dotsRecordsMatchGame([record(4, [declaration('A', { sweep: -1 })])], game, round)).toBe(false);
      expect(dotsRecordsMatchGame(records, base, round)).toBe(false);
      expect(calculateDots(game, round, records, [], 'churcie-v3').status).toBe('unavailable');
    }
    const solo = { ...f.game, sweepRule: 'manual-v1' as const, playerIds: ['A'] };
    const round = { ...f.round, groups: [{ number: 1, playerIds: ['A'] }], cards: f.round.cards.slice(0, 1) };
    expect(totals(calculateDots(solo, round, [record(1, [declaration('A', { sweep: 2 })])]))).toEqual([2]);
    const pending = calculateDots({ ...linked(f.game), sweepRule: 'manual-v1' }, f.round,
      [record(1, [declaration('A', { sweep: 1 })])]);
    expect(pending.status).toBe('in-progress');
    expect(pending.awards).toEqual([]);
  });

  it('awards one automatic same-golfer category sweep in individual, fixed, rotating and linked modes, never Churchie', () => {
    const f = fixture([5], ['long-drive', 'blue-plate']);
    const records = [record(1, [], [
      { kind: 'long-drive', status: 'awarded', winnerId: 'A', secondId: 'B' },
      { kind: 'blue-plate', status: 'awarded', winnerId: 'A', secondId: 'C' },
    ])];
    const rotating: DotsGameDefinition = { id: f.game.id, name: f.game.name, kind: 'dots', version: 2,
      groupNumber: 1, playerIds: ids, mode: 'rotating', rotationHoles: 3, stakeMinor: null, specials: f.game.specials };
    for (const game of [f.game, fixed(f.game), rotating, linked(f.game)]) {
      const saved = records.map((entry) => ({ ...entry, ...(game.version === 2 ? { rotation: { playerIds: ids } } : {}) }));
      const result = calculateDots(game, f.round, saved, [context(1, 3)]);
      expect(result.status).toBe('complete');
      expect(result.awards.find((award) => award.kind === 'category-sweep')).toMatchObject({
        earnedBy: 'A', recipientIds: game.mode === 'individual' ? ['A'] : ['A', 'B'],
        units: 1, count: 1, multiplier: 1, dots: 1, sourceHoles: [1], source: 'derived',
      });
      expect(calculateDots(game, { ...f.round, dotsCategorySweepsVersion: 0 }, saved, [context(1, 3)])
        .awards.some((award) => award.kind === 'category-sweep')).toBe(false);
      expect(calculateDots(game, f.round, saved, [context(1, 3)], 'churcie-v3')
        .awards.some((award) => award.kind === 'category-sweep')).toBe(false);
    }
    expect(totals(calculateDots(f.game, f.round, records))).toEqual([3, 0, 0, 0]);
    expect(totals(calculateDots(linked(f.game), f.round, records, [context(1, 3)]))).toEqual([7, 7, 0, 0]);
  });

  it('does not award split-partner/second-qualifier wins, missing decisions, disabled categories or historical carry ownership', () => {
    const f = fixture([5, 5], ['long-drive', 'blue-plate']);
    const wins = (drive: string, approach: string): readonly DotsContest[] => [
      { kind: 'long-drive', status: 'awarded', winnerId: drive },
      { kind: 'blue-plate', status: 'awarded', winnerId: approach },
    ];
    for (const contests of [wins('A', 'B'), wins('A', 'B').map((contest) => ({ ...contest, secondId: 'C' })),
      wins('A', 'A').slice(0, 1), [{ kind: 'long-drive' as const, status: 'no-qualifier' as const },
        { kind: 'blue-plate' as const, status: 'awarded' as const, winnerId: 'A' }]]) {
      const result = calculateDots(fixed(f.game), f.round, [record(1, [], contests)]);
      expect(result.awards.some((award) => award.kind === 'category-sweep')).toBe(false);
      if (contests.length === 1) expect(result.holes[0]?.status).toBe('pending');
    }
    const historical = [record(1, [], [{ kind: 'long-drive', status: 'awarded', winnerId: 'A' },
      { kind: 'blue-plate', status: 'no-qualifier' }]), record(2, [], [
      { kind: 'long-drive', status: 'no-qualifier' }, { kind: 'blue-plate', status: 'awarded', winnerId: 'A' },
    ])];
    expect(calculateDots(f.game, f.round, historical).awards.some((award) => award.kind === 'category-sweep')).toBe(false);
    const onlyDrive = { ...f.game, specials: [{ kind: 'long-drive' as const, units: 1 }] };
    expect(calculateDots(onlyDrive, f.round, [record(1, [], wins('A', 'A').slice(0, 1))]).awards
      .some((award) => award.kind === 'category-sweep')).toBe(false);
    const invalid = calculateDots(f.game, f.round, [record(1, [], wins('missing', 'missing'))]);
    expect(invalid.status).toBe('unavailable');
    expect(invalid.awards).toEqual([]);
  });

  it('keeps carries and category units independent from the one-dot sweep, and retains linked High/Low Sweep', () => {
    const f = fixture([5, 5], ['long-drive', 'blue-plate', 'sweep']);
    const game = linked({ ...f.game, specials: f.game.specials.map((special) => ({ ...special, units: 4 })) });
    const records = [record(1, [], [{ kind: 'long-drive', status: 'no-qualifier' }, { kind: 'blue-plate', status: 'no-qualifier' }]),
      record(2, [], [{ kind: 'long-drive', status: 'awarded', winnerId: 'C' }, { kind: 'blue-plate', status: 'awarded', winnerId: 'C' }])];
    const contexts = [context(1, 3), { ...context(2, 3), highWinnerIds: ['C', 'D'], lowWinnerIds: ['C', 'D'] }];
    const result = calculateDots(game, f.round, records, contexts);
    expect(result.holes[1]?.awards.map((award) => [award.kind, award.dots])).toEqual([
      ['blue-plate', 24], ['long-drive', 24], ['category-sweep', 1], ['sweep', 12],
    ]);
    expect(result.holes[1]?.awards.find((award) => award.kind === 'category-sweep')?.recipientIds).toEqual(['C', 'D']);
    const pending = calculateDots(game, f.round, records, [context(1), { ...context(2), status: 'pending', sides: [] }]);
    expect(pending.holes[1]?.status).toBe('pending');
    expect(pending.holes[1]?.awards).toEqual([]);
  });

  it('uses the current rotation or solo side and does not invent a winner while earlier category carries are unresolved', () => {
    const f = fixture([4, 4, 4, 5], ['long-drive', 'blue-plate']);
    const game: DotsGameDefinition = { id: f.game.id, name: f.game.name, kind: 'dots', version: 2,
      groupNumber: 1, playerIds: ids, mode: 'rotating', rotationHoles: 3, stakeMinor: null, specials: f.game.specials };
    const saved = [record(4, [], [
      { kind: 'long-drive', status: 'awarded', winnerId: 'A' },
      { kind: 'blue-plate', status: 'awarded', winnerId: 'A' },
    ])];
    const rotated = calculateDots(game, f.round, [{ ...record(), rotation: { playerIds: ids } }, ...saved]);
    expect(rotated.awards.find((award) => award.kind === 'category-sweep')?.recipientIds).toEqual(['A', 'C']);
    const solo = calculateDots(linked(f.game), f.round, saved,
      f.round.layout.map((hole) => context(hole.number, 3, [['A'], ['B', 'C', 'D']])));
    expect(solo.awards.find((award) => award.kind === 'category-sweep')).toMatchObject({ dots: 1, recipientIds: ['A'] });
    const earlier = fixture([5, 5], ['long-drive', 'blue-plate']);
    const unresolved = calculateDots(earlier.game, earlier.round, saved.map((entry) => ({ ...entry, number: 2 })));
    expect(unresolved.holes.map((hole) => hole.status)).toEqual(['pending', 'pending']);
    expect(unresolved.awards).toEqual([expect.objectContaining({ kind: 'category-sweep', number: 2, dots: 1 })]);
    expect(unresolved.awards[0]?.sourceHoles).toEqual([2]);
  });
  const failedKinds = ['paree', 'murphy', 'pully-murphy'] as const;
  const incompatible = ['hogan', 'seve', 'sandy', 'haz-par', 'chippy', 'pully', 'dime', 'super-dime'] as const;
  it.each(failedKinds.flatMap((kind) => incompatible.map((special) => ({ kind, special }))))(
    'rejects failed $kind with own $special only on writes, preserving historical v1/v2 awards', ({ kind, special }) => {
      const player = declaration('A', { [special]: 2 }, [{ id: 'failed', kind, result: 'failure' }]);
      expect(dotsDeclarationWriteIssues(player).conflicts).toContainEqual({ code: 'FAILED_CALL_SPECIAL', kinds: [kind, special] });
      const readIssues = dotsDeclarationIssues(player);
      expect(readIssues.conflicts).toEqual(kind === 'murphy' && special === 'hogan'
        ? [{ code: 'HOGAN_MURPHY', kinds: ['hogan', 'murphy'] }] : []);
      const f = fixture([4], [kind, special]);
      const rotating: DotsGameDefinition = { id: f.game.id, name: f.game.name, kind: 'dots', version: 2,
        mode: 'rotating', rotationHoles: 3, groupNumber: 1, playerIds: ids, specials: f.game.specials, stakeMinor: null };
      for (const game of [f.game, rotating]) {
        const records = [{ ...record(1, [player]), ...(game.version === 2 ? { rotation: { playerIds: ids } } : {}) }];
        if (game.version === 2 && readIssues.conflicts.length) {
          expect(dotsRecordsMatchGame(records, game, f.round)).toBe(false);
          expect(calculateDots(game, f.round, records).status).toBe('unavailable');
          continue;
        }
        expect(dotsRecordsMatchGame(records, game, f.round)).toBe(true);
        const result = calculateDots(game, f.round, records);
        expect(result.status).toBe('complete');
        expect(result.awards.find((award) => award.kind === special)).toMatchObject({ earnedBy: 'A', count: 2, dots: 2 });
        expect(result.awards.find((award) => award.kind === kind)).toMatchObject({ earnedBy: 'A', count: 1, dots: 1 });
        expect(totals(result)).toEqual(game.version === 1 ? [2, 1, 1, 1] : [2, 2, 1, 1]);
      }
      expect(player.counts).toEqual({ [special]: 2 });
      for (const result of ['pending', 'success'] as const) {
        expect(dotsDeclarationWriteIssues({ ...player, calls: [{ id: result, kind, result }] }).conflicts
          .filter((issue) => issue.code === 'FAILED_CALL_SPECIAL')).toEqual([]);
      }
      for (const counts of [{}, { [special]: 0 }]) {
        expect(dotsDeclarationWriteIssues({ ...player, counts }).conflicts).toEqual([]);
      }
    },
  );

  it('deduplicates failed-call pairs despite successful/pending peers, composes old issues, and never compares teammates', () => {
    const calls: DotsPlayerDeclaration['calls'] = [
      { id: 'a', kind: 'paree', result: 'failure' }, { id: 'b', kind: 'paree', result: 'failure' },
      { id: 'c', kind: 'paree', result: 'success' }, { id: 'd', kind: 'paree', result: 'pending' },
      { id: 'e', kind: 'murphy', result: 'failure' }, { id: 'f', kind: 'pully-murphy', result: 'failure' },
    ];
    const player = declaration('A', { sandy: 2, hogan: 1, seve: 1, walk: 1 }, calls);
    const old = dotsDeclarationIssues(player), write = dotsDeclarationWriteIssues(player);
    expect(write.conflicts.filter((issue) => issue.code === 'FAILED_CALL_SPECIAL')).toHaveLength(12);
    for (const kind of failedKinds) {
      for (const special of ['hogan', 'seve', 'sandy', 'paree']) {
        expect(write.conflicts).toContainEqual({ code: 'FAILED_CALL_SPECIAL', kinds: [kind, special] });
      }
    }
    expect(write.conflicts.filter((issue) => issue.code !== 'FAILED_CALL_SPECIAL')).toEqual(old.conflicts);
    expect(write.warnings).toEqual(old.warnings);
    expect(dotsDeclarationWriteIssues(declaration('A', {}, calls.filter((call) => call.result !== 'success'))).conflicts).toEqual([]);
    expect(dotsDeclarationWriteIssues(declaration('B', { sandy: 2, dime: 1 })).conflicts).toEqual([]);
  });

  it.each(failedKinds.flatMap((kind) => failedKinds.map((made) => ({ kind, made }))))(
    'rejects failed $kind with successful $made but not pending calls or opponent-awarding Walk/Pickup', ({ kind, made }) => {
      const failed = { id: 'failed', kind, result: 'failure' as const };
      expect(dotsDeclarationWriteIssues(declaration('A', {}, [failed, { id: 'made', kind: made, result: 'success' }])).conflicts)
        .toEqual([{ code: 'FAILED_CALL_SPECIAL', kinds: [kind, made] }]);
      expect(dotsDeclarationWriteIssues(declaration('A', { walk: 1, pickup: 1, gorilla: 1, other: 2 },
        [failed, { id: 'pending', kind: made, result: 'pending' }])).conflicts).toEqual([]);
    },
  );

  it.each(['birdie', 'eagle', 'string', 'birdy-string'] as const)(
    'rejects newly earned %s using engine qualifications, including earlier score edits, without invalidating old results', (kind) => {
      const f = fixture([4, 4, 4], ['paree', kind]);
      const number = kind === 'birdie' || kind === 'eagle' ? 1 : 3;
      const player = declaration('A', {}, [{ id: 'failed', kind: 'paree', result: 'failure' }]);
      const records = [record(number, [player])];
      const strokes = kind === 'eagle' ? 2 : kind === 'string' ? 4 : 3;
      const after = setScores(f.round, 'A', Array.from({ length: 3 }, () => ({ kind: 'strokes', strokes })));
      const before = setScores(after, 'A', [{ kind: 'unplayed' }]);
      expect(dotsAutomaticWriteConflicts(f.game, before, after, records, records)).toEqual(['A']);
      expect(dotsAutomaticWriteConflicts(f.game, after, after, records, records)).toEqual([]);
      expect(dotsAutomaticWriteConflicts(f.game, after, after, [], records)).toEqual(['A']);
      expect(calculateDots(f.game, after, records).awards).toContainEqual(expect.objectContaining({ kind, earnedBy: 'A', number }));
      const personal = { ...after, playerLayouts: [{ playerId: 'A', layout: after.layout.map((hole) => ({ ...hole, par: 5 })) }] };
      if (kind === 'birdie') {
        const personalAfter = setScores(personal, 'A', [{ kind: 'strokes', strokes: 4 }]);
        expect(dotsAutomaticWriteConflicts(f.game, before, personalAfter, records, records)).toEqual(['A']);
      }
    },
  );

  it('uses the actual playing circuit for newly earned streak conflicts and does not compare shared teammate recipients', () => {
    const f = fixture([4, 4, 4], ['murphy', 'string']);
    const round = { ...f.round, groups: [{ number: 1, playerIds: ids, startingHole: 3 }] };
    const records = [record(2, [declaration('A', {}, [{ id: 'failed', kind: 'murphy', result: 'failure' }])])];
    const before = setScores(round, 'A', [{ kind: 'strokes', strokes: 4 }, { kind: 'strokes', strokes: 4 }, { kind: 'unplayed' }]);
    expect(dotsAutomaticWriteConflicts(f.game, before, round, records, records)).toEqual(['A']);
    expect(dotsAutomaticWriteConflicts(f.game, before, round, [], [record(2, [
      declaration('B', {}, [{ id: 'failed', kind: 'murphy', result: 'failure' }]),
    ])])).toEqual(['B']);
    const peerOnly = setScores(round, 'B', [{ kind: 'strokes', strokes: 5 }]);
    expect(dotsAutomaticWriteConflicts(f.game, before, peerOnly, [], [record(2, [
      declaration('B', {}, [{ id: 'failed', kind: 'murphy', result: 'failure' }]),
    ])])).toEqual([]);
  });

  it('rechecks automatic awards when a previously missing partner order is first acknowledged', () => {
    const f = fixture([4], ['paree', 'birdie']);
    const game: DotsGameDefinition = { id: f.game.id, name: f.game.name, kind: 'dots', version: 2,
      mode: 'rotating', rotationHoles: 3, groupNumber: 1, playerIds: ids, specials: f.game.specials, stakeMinor: null };
    const round = setScores(f.round, 'A', [{ kind: 'strokes', strokes: 3 }]);
    const historical = [record(1, [declaration('A', {}, [{ id: 'failed', kind: 'paree', result: 'failure' }])])];
    expect(dotsAutomaticWriteConflicts(game, round, round, historical, historical)).toEqual([]);
    expect(calculateDots(game, round, historical).status).toBe('in-progress');
    const ordered = historical.map((entry) => ({ ...entry, rotation: { playerIds: ids } }));
    expect(dotsAutomaticWriteConflicts(game, round, round, historical, ordered)).toEqual(['A']);
    expect(dotsAutomaticWriteConflicts(game, round, round, ordered, ordered)).toEqual([]);
    expect(calculateDots(game, round, ordered).status).toBe('complete');
  });

  it('uses the immutable rotating receipt origin when it differs from the configured starting hole', () => {
    const f = fixture([4, 4, 4], ['paree', 'string']);
    const game: DotsGameDefinition = { id: f.game.id, name: f.game.name, kind: 'dots', version: 2,
      mode: 'rotating', rotationHoles: 3, groupNumber: 1, playerIds: ids, specials: f.game.specials, stakeMinor: null };
    const records = [{ ...record(3), rotation: { playerIds: ids } },
      record(2, [declaration('A', {}, [{ id: 'failed', kind: 'paree', result: 'failure' }])])];
    const before = setScores(f.round, 'A', [{ kind: 'strokes', strokes: 4 }, { kind: 'strokes', strokes: 4 }, { kind: 'unplayed' }]);
    expect(dotsAutomaticWriteConflicts(game, before, f.round, records, records)).toEqual(['A']);
    expect(calculateDots(game, f.round, records).awards)
      .toContainEqual(expect.objectContaining({ kind: 'string', number: 2, earnedBy: 'A' }));
  });

  it.each([0, 1, 2] as const)('scales configured Murphy units by stage %i without linked hole stakes in every ordinary mode', (murphyPresses) => {
    const f = fixture([4], ['murphy']);
    f.game = { ...f.game, specials: [{ kind: 'murphy', units: 2 }] };
    const rotating: DotsGameDefinition = { id: f.game.id, name: f.game.name, kind: 'dots', version: 2,
      mode: 'rotating', rotationHoles: 3, groupNumber: 1, playerIds: ids, specials: f.game.specials, stakeMinor: null };
    for (const game of [f.game, fixed(f.game), linked(f.game), rotating]) {
      const records = [{ ...record(1, [declaration('A', {}, [{
        id: 'murphy-call', kind: 'murphy', result: 'pending', murphyPresses, murphyTarget: 'par',
      }])]), ...(game.version === 2 ? { rotation: { playerIds: ids } } : {}) }];
      expect(dotsRecordsMatchGame(records, game, f.round, [context(1, 2)])).toBe(true);
      const result = calculateDots(game, f.round, records, [context(1, 2)]);
      expect(result.status).toBe('complete');
      expect(result.awards).toEqual([expect.objectContaining({ kind: 'murphy', earnedBy: 'A',
        recipientIds: game.mode === 'individual' ? ['A'] : ['A', 'B'],
        count: 1 + murphyPresses, units: 2, multiplier: 1, dots: 2 * (1 + murphyPresses) })]);
    }
  });

  it.each([1, 2, 3, 4])('derives repeated explicit calls for %i real individual participants, not inferred calls or invented opponents', (count) => {
    const f = fixture([4], ['paree', 'murphy']);
    const game = { ...f.game, playerIds: ids.slice(0, count) };
    const round = { ...f.round, groups: [{ number: 1, playerIds: game.playerIds }], cards: f.round.cards.slice(0, count),
      playerLayouts: [{ playerId: 'A', layout: f.round.layout.map((hole) => ({ ...hole, par: 5 })) }] };
    const calls: DotsPlayerDeclaration['calls'] = [
      { id: 'paree-1', kind: 'paree', result: 'pending', pareeTarget: 'par' },
      { id: 'paree-2', kind: 'paree', result: 'pending', pareeTarget: 'par' },
      { id: 'murphy', kind: 'murphy', result: 'pending', murphyTarget: 'birdie', murphyPresses: 2 },
    ];
    const records = [record(1, [declaration('A', {}, calls)])];
    expect(calculateDots(game, round, []).awards).toEqual([]);
    for (const score of [{ kind: 'unplayed' }, { kind: 'strokes', strokes: 4 }, { kind: 'strokes', strokes: 5 },
      { kind: 'strokes', strokes: 6 }, { kind: 'picked-up', reportedStrokes: 7 }, { kind: 'did-not-finish' }] satisfies readonly HoleScore[]) {
      const result = calculateDots(game, setScores(round, 'A', [score]), records);
      if (score.kind === 'unplayed') {
        expect(result.status).toBe('in-progress');
        expect(result.awards).toEqual([]);
      } else {
        const pareeSuccess = score.kind === 'strokes' && score.strokes <= 5;
        const murphySuccess = score.kind === 'strokes' && score.strokes <= 4;
        expect(result.awards.filter((award) => award.kind === 'paree')).toHaveLength(pareeSuccess || count > 1 ? 2 : 0);
        for (const award of result.awards) expect(award.recipientIds).toEqual(
          (award.kind === 'paree' ? pareeSuccess : murphySuccess) ? ['A'] : game.playerIds.slice(1));
        expect(result.awards.find((award) => award.kind === 'murphy')?.dots).toBe(murphySuccess || count > 1 ? 3 : undefined);
      }
    }
    const legacy = [record(1, [declaration('A', {}, [{ id: 'manual', kind: 'paree', result: 'failure' }])])];
    expect(calculateDots(game, round, legacy).awards.some((award) => award.recipientIds.includes('A'))).toBe(false);
  });

  it('derives failed-call exclusions from personal scores while allowing par after a missed birdie target with Sandy and Pully', () => {
    const f = fixture([4], ['murphy', 'paree', 'sandy', 'pully']);
    const player = declaration('A', { sandy: 2, pully: 1 }, [
      { id: 'birdie', kind: 'murphy', result: 'pending', murphyTarget: 'birdie', murphyPresses: 1 },
    ]);
    expect(dotsDeclarationWriteIssues(player, { score: { kind: 'strokes', strokes: 4 }, par: 4 }).conflicts).toEqual([]);
    expect(dotsDeclarationWriteIssues(player, { score: { kind: 'strokes', strokes: 5 }, par: 4 }).conflicts)
      .toContainEqual({ code: 'FAILED_CALL_SPECIAL', kinds: ['murphy', 'sandy'] });
    const records = [record(1, [player])];
    const round = setScores(f.round, 'A', [{ kind: 'unplayed' }]);
    expect(dotsAutomaticWriteConflicts(f.game, round, f.round, records, records)).toEqual([]);
    expect(dotsAutomaticWriteConflicts(f.game, round, setScores(f.round, 'A', [{ kind: 'strokes', strokes: 5 }]), records, records)).toEqual(['A']);
  });

  it('uses the actual later rotating/linked teams while preserving the original multiplier of untouched linked manual calls', () => {
    const f = fixture([4, 4, 4, 4], ['paree', 'murphy']);
    const rotating: DotsGameDefinition = { id: f.game.id, name: f.game.name, kind: 'dots', version: 2,
      mode: 'rotating', rotationHoles: 3, groupNumber: 1, playerIds: ids, specials: f.game.specials, stakeMinor: null };
    const calls: DotsPlayerDeclaration['calls'] = [
      { id: 'paree', kind: 'paree', result: 'pending', pareeTarget: 'par' },
      { id: 'murphy', kind: 'murphy', result: 'pending', murphyTarget: 'birdie', murphyPresses: 2 },
    ];
    const records = [{ ...record(), rotation: { playerIds: ids } }, record(4, [declaration('A', {}, calls)])];
    const rotated = calculateDots(rotating, f.round, records).awards;
    expect(rotated.find((award) => award.kind === 'paree')).toMatchObject({ recipientIds: ['A', 'C'], dots: 1 });
    expect(rotated.find((award) => award.kind === 'murphy')).toMatchObject({ recipientIds: ['B', 'D'], dots: 3 });
    const contexts = f.round.layout.map((hole) => context(hole.number, 3, [['A', 'D'], ['B', 'C']]));
    const linkedAwards = calculateDots(linked(f.game), f.round,
      [record(4, [declaration('A', {}, [...calls, { id: 'legacy', kind: 'paree', result: 'success' }])])], contexts).awards;
    expect(linkedAwards.find((award) => award.id.endsWith(':paree'))).toMatchObject({ recipientIds: ['A', 'D'], dots: 1, multiplier: 1 });
    expect(linkedAwards.find((award) => award.kind === 'murphy')).toMatchObject({ recipientIds: ['B', 'C'], dots: 3, multiplier: 1 });
    expect(linkedAwards.find((award) => award.id.endsWith(':legacy'))).toMatchObject({ recipientIds: ['A', 'D'], dots: 3, multiplier: 3 });
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

  it('uses personal gross par-or-better runs, replaces only qualifying enabled Birdie String, and resumes String on par', () => {
    const f = fixture([4, 5, 3, 4, 4, 4, 4, 4], ['string', 'birdy-string', 'birdie', 'eagle']);
    const round = setScores(f.round, 'A', [3, 4, 1, 3, 4, 5, 4, 4]
      .map((strokes) => ({ kind: 'strokes', strokes })));
    const awards = (input: DotRoundInput, game = f.game) => calculateDots(game, input, []).awards
      .filter((award) => award.earnedBy === 'A' && ['string', 'birdy-string'].includes(award.kind))
      .map((award) => [award.number, award.kind]);
    expect(awards(round)).toEqual([[3, 'birdy-string'], [4, 'birdy-string'], [5, 'string']]);
    expect(awards(round, { ...f.game, specials: [{ kind: 'string', units: 1 }] }))
      .toEqual([[3, 'string'], [4, 'string'], [5, 'string']]);
    expect(awards(setScores(f.round, 'A', [4, 4, 3, 4, 4, 5, 4, 4]
      .map((strokes) => ({ kind: 'strokes', strokes })))))
      .toEqual([[3, 'string'], [4, 'string'], [5, 'string']]);
    expect(awards({ ...round, stringRulesVersion: 1 })).toEqual([[3, 'birdy-string'], [4, 'birdy-string']]);
    const automatic = calculateDots(f.game, round, []).awards.filter((award) => award.earnedBy === 'A');
    expect(automatic.filter((award) => award.number === 3).map((award) => award.kind)).toEqual(['eagle', 'birdy-string']);
  });

  it.each(['picked-up', 'did-not-finish'] as const)('breaks both runs on %s and keeps par-only interruptions of Birdie String', (kind) => {
    const f = fixture(Array.from({ length: 9 }, () => 4), ['string', 'birdy-string']);
    const input = setScores(f.round, 'A', [3, 3, 3, 4, 3, 3, 3, 3, 3].map((strokes, index) =>
      index === 4 ? { kind } : { kind: 'strokes', strokes }));
    expect(calculateDots(f.game, input, []).awards.filter((award) => award.earnedBy === 'A')
      .map((award) => [award.number, award.kind]))
      .toEqual([[3, 'birdy-string'], [4, 'string'], [8, 'birdy-string'], [9, 'birdy-string']]);
  });

  it('uses personal pars across a nine-hole wrapped circuit in fixed, rotating and linked consumers', () => {
    const f = fixture(Array.from({ length: 9 }, () => 4), ['string', 'birdy-string']);
    const input: DotRoundInput = { ...f.round, groups: [{ number: 1, playerIds: ids, startingHole: 9 }],
      playerLayouts: [{ playerId: 'A', layout: f.round.layout.map((hole) => ({ ...hole, par: 5 })) }] };
    const rotating: DotsGameDefinition = { id: f.game.id, name: f.game.name, kind: 'dots', version: 2,
      mode: 'rotating', rotationHoles: 3, groupNumber: 1, playerIds: ids, specials: f.game.specials, stakeMinor: null };
    for (const game of [f.game, fixed(f.game), rotating, linked(f.game)]) {
      const contexts = game.mode === 'linked' ? [9, 1, 2, 3, 4, 5, 6, 7, 8].map((number) => context(number)) : undefined;
      const records = game.version === 2 ? [{ ...record(9), rotation: { playerIds: ids } }] : [];
      const result = calculateDots(game, input, records, contexts);
      expect(result.awards.filter((award) => award.earnedBy === 'A').map((award) => [award.number, award.kind]))
        .toEqual([2, 3, 4, 5, 6, 7, 8].map((number) => [number, 'birdy-string']));
      expect(result.awards.some((award) => award.kind === 'string' && award.earnedBy === 'B')).toBe(true);
    }
  });

  it('rejects a newly earned mixed String conflicting with the same source failed call without erasing old records', () => {
    const f = fixture([4, 5, 3], ['string', 'murphy']);
    const previous = setScores(f.round, 'A', [4, 6, 3].map((strokes) => ({ kind: 'strokes', strokes })));
    const next = setScores(previous, 'A', [4, 4, 3].map((strokes) => ({ kind: 'strokes', strokes })));
    const records = [record(3, [declaration('A', {}, [{ id: 'failed', kind: 'murphy', result: 'failure' }])])];
    expect(dotsAutomaticWriteConflicts(f.game, previous, next, records, records)).not.toEqual([]);
    expect(calculateDots(f.game, next, records).awards.some((award) => award.kind === 'string' && award.earnedBy === 'A')).toBe(true);
    expect(dotsAutomaticWriteConflicts(f.game, { ...previous, stringRulesVersion: 1 },
      { ...next, stringRulesVersion: 1 }, records, records)).toEqual([]);
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
    const broken = setScores(unknown, 'A', [{ kind: 'unplayed' }, { kind: 'strokes', strokes: 5 }]);
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
    expect(totals(result)).toEqual([1, 2, 5, 1]);
    expect(result.awards.filter((award) => award.kind === 'category-sweep'))
      .toEqual([expect.objectContaining({ number: 2, earnedBy: 'C', dots: 1 })]);
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
