import type { DotAward, DotHoleContext, DotRoundInput } from './dot-context.js';
import type { ChurchyGameDefinitionV3 } from './churchy.js';
import type { HoleScore } from './scoring.js';
import type { GamePlayerResult } from './games.js';
import { dotsRotationContext } from './dots-rotation.js';
import type { DotsRotationContext } from './dots-rotation.js';
export { dotsFirstPlayedHole, dotsRotationContext } from './dots-rotation.js';
export type { DotsRotationContext } from './dots-rotation.js';

export type DotsSpecialKind = 'hogan' | 'seve' | 'long-drive' | 'paree' | 'sandy' | 'pully' | 'dime'
  | 'super-dime' | 'kp' | 'murphy' | 'pully-murphy' | 'haz-par' | 'gorilla' | 'birdie' | 'eagle'
  | 'string' | 'birdy-string' | 'blue-plate' | 'king-of-the-hill' | 'assassin' | 'walk' | 'sweep' | 'chippy' | 'pickup' | 'other';

export const dotsSpecialCatalog: readonly {
  readonly kind: DotsSpecialKind; readonly label: string; readonly description: string;
  readonly defaultUnits: number; readonly automatic: boolean;
}[] = [
  { kind: 'hogan', label: 'Hogan', description: 'Fairway and GIR (GIR only on par 3), gross par or better.', defaultUnits: 1, automatic: false },
  { kind: 'seve', label: 'Seve', description: 'Miss fairway and GIR (miss GIR only on par 3), gross par or better.', defaultUnits: 1, automatic: false },
  { kind: 'long-drive', label: 'Long Drive', description: 'Longest qualifying fairway drive on each par 5; category carry.', defaultUnits: 1, automatic: false },
  { kind: 'paree', label: 'Paree', description: 'Separately called fairway-bunker recovery, gross par or better; failure awards opponents.', defaultUnits: 1, automatic: false },
  { kind: 'sandy', label: 'Sandy', description: 'Each bunker recovery, gross par or better.', defaultUnits: 1, automatic: false },
  { kind: 'pully', label: 'Pully', description: 'Hole a putt longer than the flagstick for gross par or birdie.', defaultUnits: 1, automatic: false },
  { kind: 'dime', label: 'Dime', description: 'Approach inside the flagstick; replaced by SuperDime.', defaultUnits: 1, automatic: false },
  { kind: 'super-dime', label: 'SuperDime', description: 'Approach inside the putter, replacing Dime.', defaultUnits: 1, automatic: false },
  { kind: 'kp', label: 'KP', description: 'Closest qualifying GIR on each par 3; category carry.', defaultUnits: 1, automatic: false },
  { kind: 'murphy', label: 'Murphy', description: 'Called up-and-down, gross par or better; failure awards opponents.', defaultUnits: 1, automatic: false },
  { kind: 'pully-murphy', label: 'Pully Murphy', description: 'Separately called long gross par putt; failure awards opponents.', defaultUnits: 1, automatic: false },
  { kind: 'haz-par', label: 'Haz Par', description: 'Hazard recovery, gross par or better.', defaultUnits: 1, automatic: false },
  { kind: 'gorilla', label: 'Gorilla', description: 'Reach a personal par-5 green in two, regardless of final score.', defaultUnits: 1, automatic: false },
  { kind: 'birdie', label: 'Birdie', description: 'Exactly one under personal gross par.', defaultUnits: 2, automatic: true },
  { kind: 'eagle', label: 'Eagle', description: 'Exactly two under personal gross par, not also Birdie.', defaultUnits: 5, automatic: true },
  { kind: 'string', label: 'String', description: 'Third consecutive personal gross par or better, and every subsequent qualifying hole. Birdie String replaces String when both qualify.', defaultUnits: 1, automatic: true },
  { kind: 'birdy-string', label: 'BirdyString', description: 'Third consecutive personal gross birdie or better, and every subsequent qualifying hole. Replaces String on that hole only.', defaultUnits: 1, automatic: true },
  { kind: 'blue-plate', label: 'Blue Plate', description: 'Closest qualifying GIR on each par 5; category carry.', defaultUnits: 1, automatic: false },
  { kind: 'king-of-the-hill', label: 'King of the Hill', description: 'Individual round-end ownership of every award in a category; never shared or multiplied.', defaultUnits: 1, automatic: true },
  { kind: 'assassin', label: 'Assassin', description: 'A partnered pair holds both closest qualifying approaches or both longest qualifying par-5 drives.', defaultUnits: 1, automatic: true },
  { kind: 'walk', label: 'Walk', description: 'Manually declared three-putt awards the opposing side.', defaultUnits: 1, automatic: false },
  { kind: 'sweep', label: 'Sweep', description: 'The same partnered pair wins linked High and Low.', defaultUnits: 1, automatic: true },
  { kind: 'chippy', label: 'Chippy', description: 'Chip in, gross par or better.', defaultUnits: 1, automatic: false },
  { kind: 'pickup', label: 'Pickup', description: 'Explicitly selected pickup awards opponents; never inferred from a score.', defaultUnits: 1, automatic: false },
  { kind: 'other', label: 'Other', description: 'Manually agreed whole-count catch-all, entered once for the earning golfer.', defaultUnits: 1, automatic: false },
];

export interface DotsSpecialSelection { readonly kind: DotsSpecialKind; readonly units: number }
interface CommonDotsDefinition {
  readonly id: string; readonly name: string; readonly kind: 'dots';
  readonly groupNumber: number; readonly playerIds: readonly string[];
  readonly specials: readonly DotsSpecialSelection[];
  readonly sweepRule?: 'manual-v1';
  readonly basis?: never;
  readonly format?: never; readonly teams?: never; readonly preset?: never; readonly points?: never;
  readonly handicapAllowancePercent?: never;
}
export type DotsGameDefinition = CommonDotsDefinition & (
  | { readonly version: 2; readonly mode: 'rotating'; readonly rotationHoles: 3 | 6;
      readonly stakeMinor: number | null; readonly partnerIds?: never; readonly linkedGameId?: never }
  | ({ readonly version: 1; readonly rotationHoles?: never } & (
  | { readonly mode: 'individual'; readonly stakeMinor: number | null; readonly partnerIds?: never; readonly linkedGameId?: never }
  | { readonly mode: 'fixed'; readonly partnerIds: readonly string[]; readonly stakeMinor: number | null; readonly linkedGameId?: never }
  | { readonly mode: 'linked'; readonly linkedGameId: string; readonly stakeMinor?: never; readonly partnerIds?: never })));
export interface DotsRotationStart {
  readonly playerIds: readonly string[];
  readonly recordedLate?: true;
}
export interface DotsCall {
  readonly id: string; readonly kind: 'paree' | 'murphy' | 'pully-murphy';
  readonly result: 'pending' | 'success' | 'failure';
  readonly murphyPresses?: 0 | 1 | 2;
  readonly murphyTarget?: 'par' | 'birdie';
  readonly pareeTarget?: 'par';
  readonly pullyMurphyTarget?: 'par';
}

export function dotsCallResult(call: DotsCall, score: HoleScore | undefined, par: number | undefined): DotsCall['result'] {
  if (!(call.kind === 'murphy' && call.murphyTarget !== undefined)
    && !(call.kind === 'paree' && call.pareeTarget === 'par')
    && !(call.kind === 'pully-murphy' && call.pullyMurphyTarget === 'par')) return call.result;
  if (!score || score.kind === 'unplayed') return 'pending';
  if ((call.pareeTarget !== undefined || call.pullyMurphyTarget !== undefined)
    && (par === undefined || !Number.isSafeInteger(par) || par < 1)) return 'pending';
  if (score.kind !== 'strokes') return 'failure';
  if (par === undefined || !Number.isSafeInteger(par) || par < 1) return 'pending';
  return (call.pullyMurphyTarget === 'par' ? score.strokes === par
    : score.strokes <= par - (call.murphyTarget === 'birdie' ? 1 : 0)) ? 'success' : 'failure';
}
export interface DotsPlayerDeclaration {
  readonly playerId: string; readonly counts: Readonly<Partial<Record<DotsSpecialKind, number>>>;
  readonly calls: readonly DotsCall[];
}
export interface DotsContest {
  readonly kind: 'kp' | 'blue-plate' | 'long-drive'; readonly status: 'awarded' | 'no-qualifier';
  readonly winnerId?: string; readonly secondId?: string;
}
export interface DotsHoleRecord {
  readonly number: number; readonly gameId: string; readonly gameEtag: string;
  readonly players: readonly DotsPlayerDeclaration[]; readonly contests: readonly DotsContest[];
  readonly rotation?: DotsRotationStart;
}
export interface DotsHoleResult {
  readonly number: number; readonly status: 'complete' | 'pending' | 'unavailable'; readonly reason?: string;
  readonly awards: readonly DotAward[]; readonly points: readonly { readonly playerId: string; readonly dots: number | null }[];
}
export interface DotsResults {
  readonly status: 'complete' | 'in-progress' | 'unavailable'; readonly players: readonly GamePlayerResult[];
  readonly holes: readonly DotsHoleResult[]; readonly awards: readonly DotAward[];
  readonly unawarded: readonly { readonly kind: DotsSpecialKind; readonly sourceHoles: readonly number[]; readonly units: number }[];
  readonly issues: readonly string[];
  readonly rotation?: DotsRotationContext;
  readonly reviewRequired?: readonly DotSpecialReview[];
}

export interface DotSpecialReview {
  readonly number: number;
  readonly kind: DotsSpecialKind;
  readonly playerId?: string;
  readonly reason: 'score-qualification' | 'category-hole';
}

export interface DotsDeclarationIssue {
  readonly code: 'HOGAN_SEVE' | 'PULLY_DIME' | 'HOGAN_MURPHY' | 'HOGAN_CHIPPY' | 'DIME_SUPER_DIME'
    | 'HOGAN_WALK' | 'SEVE_WALK' | 'FAILED_CALL_SPECIAL' | 'CHIPPY_PULLY' | 'SEVE_CATEGORY' | 'SANDY_KP' | 'SCORE_QUALIFICATION';
  readonly kinds: readonly DotsSpecialKind[];
}

export function sameDotsPlayerDeclaration(left: DotsPlayerDeclaration | undefined, right: DotsPlayerDeclaration | undefined): boolean {
  const key = (player: DotsPlayerDeclaration | undefined) => player && JSON.stringify({
    playerId: player.playerId, counts: Object.entries(player.counts).sort(([a], [b]) => a.localeCompare(b)),
    calls: player.calls.map((call) => [call.id, call.kind, call.result, call.murphyPresses ?? null,
      call.murphyTarget ?? null, call.pareeTarget ?? null, call.pullyMurphyTarget ?? null]),
  });
  return key(left) === key(right);
}

/** Source declarations only: shared awards do not imply incompatible achievements. */
export function dotsDeclarationIssues(declaration: DotsPlayerDeclaration): {
  readonly conflicts: readonly DotsDeclarationIssue[]; readonly warnings: readonly DotsDeclarationIssue[];
} {
  const has = (kind: DotsSpecialKind) => (declaration.counts[kind] ?? 0) > 0
    || declaration.calls.some((call) => call.kind === kind);
  const conflicts: DotsDeclarationIssue[] = [], warnings: DotsDeclarationIssue[] = [];
  const check = (code: DotsDeclarationIssue['code'], kinds: readonly DotsSpecialKind[], warning = false) => {
    if (kinds.every(has)) (warning ? warnings : conflicts).push({ code, kinds });
  };
  check('HOGAN_SEVE', ['hogan', 'seve']);
  check('PULLY_DIME', ['pully', 'dime']);
  check('PULLY_DIME', ['pully', 'super-dime']);
  check('HOGAN_MURPHY', ['hogan', 'murphy']);
  check('HOGAN_CHIPPY', ['hogan', 'chippy']);
  check('DIME_SUPER_DIME', ['dime', 'super-dime']);
  check('HOGAN_WALK', ['hogan', 'walk'], true);
  check('SEVE_WALK', ['seve', 'walk'], true);
  return { conflicts, warnings };
}

/** New or changed source declarations only; historical calculations retain their original rules. */
export function dotsDeclarationWriteIssues(declaration: DotsPlayerDeclaration,
  context?: { readonly score?: HoleScore | undefined; readonly par?: number | undefined; readonly automaticKinds?: readonly DotsSpecialKind[] }): {
  readonly conflicts: readonly DotsDeclarationIssue[]; readonly warnings: readonly DotsDeclarationIssue[];
} {
  const issues = dotsDeclarationIssues(declaration);
  const conflicts = [...issues.conflicts];
  const result = (call: DotsCall) => context ? dotsCallResult(call, context.score, context.par) : call.result;
  const failedCalls = declaration.calls.filter((call) => result(call) === 'failure');
  const specials = new Set<DotsSpecialKind>([
    ...parQualified.filter((kind) => (declaration.counts[kind] ?? 0) > 0),
    ...(['pully', 'dime', 'super-dime'] as const).filter((kind) => (declaration.counts[kind] ?? 0) > 0),
    ...declaration.calls.filter((call) => result(call) === 'success').map((call) => call.kind),
    ...(context?.automaticKinds ?? []),
  ]);
  const pairs = new Set<string>();
  for (const call of failedCalls) {
    for (const special of specials) {
      if (call.murphyTarget === 'birdie' && context?.score?.kind === 'strokes' && context.score.strokes === context.par
        && [...parQualified, 'pully', 'paree', 'murphy', 'pully-murphy', 'string'].some((kind) => kind === special)) continue;
      const key = `${call.kind}:${special}`;
      if (!pairs.has(key)) conflicts.push({ code: 'FAILED_CALL_SPECIAL', kinds: [call.kind, special] });
      pairs.add(key);
    }
  }
  return { conflicts, warnings: issues.warnings };
}

/** Write-only rules: never reinterpret historical awards or category carry recipients. */
export function dotsCoexistenceWriteIssues(declaration: DotsPlayerDeclaration, context: {
  readonly score?: HoleScore | undefined; readonly par?: number | undefined;
  readonly categoryPar?: number | undefined;
  readonly contests?: readonly DotsContest[]; readonly automaticKinds?: readonly DotsSpecialKind[];
} = {}): { readonly conflicts: readonly DotsDeclarationIssue[]; readonly warnings: readonly DotsDeclarationIssue[] } {
  const issues = dotsDeclarationWriteIssues(declaration, context);
  const conflicts = [...issues.conflicts];
  const has = (kind: DotsSpecialKind) => (declaration.counts[kind] ?? 0) > 0;
  if (has('chippy') && has('pully')) conflicts.push({ code: 'CHIPPY_PULLY', kinds: ['chippy', 'pully'] });
  if (has('seve')) {
    for (const kind of ['kp', 'long-drive'] as const) {
      if (context.contests?.some((contest) => contest.kind === kind && contest.status === 'awarded'
        && (contest.winnerId === declaration.playerId || contest.secondId === declaration.playerId))) {
        conflicts.push({ code: 'SEVE_CATEGORY', kinds: ['seve', kind] });
      }
    }
  }
  if (has('sandy') && (context.categoryPar === undefined || context.categoryPar === 3)
    && context.contests?.some((contest) => contest.kind === 'kp' && contest.status === 'awarded'
      && (contest.winnerId === declaration.playerId || contest.secondId === declaration.playerId))) {
    conflicts.push({ code: 'SANDY_KP', kinds: ['sandy', 'kp'] });
  }
  const { score, par } = context;
  if (score && score.kind !== 'unplayed') {
    for (const kind of [...parQualified, 'pully'] as const) {
      if (has(kind) && (score.kind !== 'strokes' || par === undefined
        || (kind === 'pully' ? !pullyScore(score.strokes, par) : score.strokes > par))) {
        conflicts.push({ code: 'SCORE_QUALIFICATION', kinds: [kind] });
      }
    }
    for (const call of declaration.calls) {
      if (call.result === 'success' && (score.kind !== 'strokes' || par === undefined
        || (call.kind === 'pully-murphy' ? score.strokes !== par : score.strokes > par))
        && !conflicts.some((issue) => issue.code === 'SCORE_QUALIFICATION' && issue.kinds[0] === call.kind)) {
        conflicts.push({ code: 'SCORE_QUALIFICATION', kinds: [call.kind] });
      }
    }
  }
  return { conflicts, warnings: issues.warnings };
}

/** Compare source-hole issues, permitting unchanged historical conflicts and unrelated peer saves. */
export function dotsCoexistenceWriteConflicts(
  game: DotsGameDefinition | ChurchyGameDefinitionV3, before: DotRoundInput, after: DotRoundInput,
  previous: readonly DotsHoleRecord[], records: readonly DotsHoleRecord[],
): readonly string[] {
  const sourceCategories = (contests: readonly DotsContest[], playerId: string) =>
    ['kp', 'long-drive'].flatMap((kind) => contests.flatMap((contest) => contest.kind === kind && contest.status === 'awarded'
      ? contest.winnerId === playerId ? [`${kind}:winner`] : contest.secondId === playerId ? [`${kind}:second`] : [] : [])).join(':');
  const issues = (player: DotsPlayerDeclaration, record: DotsHoleRecord, round: DotRoundInput) =>
    dotsCoexistenceWriteIssues(player, {
      score: round.cards.find((card) => card.playerId === player.playerId)?.holes.find((hole) => hole.number === record.number)?.score,
      par: (round.playerLayouts?.find((entry) => entry.playerId === player.playerId)?.layout ?? round.layout)
        .find((hole) => hole.number === record.number)?.par,
      contests: record.contests,
      categoryPar: round.layout.find((hole) => hole.number === record.number)?.par,
    }).conflicts;
  return [...new Set(records.filter((record) => record.gameId === game.id).flatMap((record) =>
    record.players.flatMap((player) => {
      const oldRecord = previous.find((entry) => entry.gameId === game.id && entry.number === record.number);
      const prior = oldRecord?.players.find((entry) => entry.playerId === player.playerId);
      const changed = !sameDotsPlayerDeclaration(player, prior);
      const categoriesChanged = sourceCategories(record.contests, player.playerId)
        !== sourceCategories(oldRecord?.contests ?? [], player.playerId);
      const old = prior && oldRecord ? issues(prior, oldRecord, before) : [];
      return issues(player, record, after).some((issue) => changed
        || (issue.code === 'SEVE_CATEGORY' || issue.code === 'SANDY_KP') && categoriesChanged
        || !old.some((entry) => entry.code === issue.code && entry.kinds.join(':') === issue.kinds.join(':')))
        ? [player.playerId] : [];
    })))];
}

/** Reuse score qualifications and acknowledged order without revalidating historical manual declarations. */
function dotsAutomaticWriteAwards(game: DotsGameDefinition | ChurchyGameDefinitionV3,
  round: DotRoundInput, records: readonly DotsHoleRecord[]): readonly DotAward[] {
  const automatic = game.specials.filter((selection) =>
    ['birdie', 'eagle', 'string', 'birdy-string'].some((kind) => kind === selection.kind));
  if (game.version !== 1) {
    const layout = game.kind === 'churchy' ? [...round.layout].sort((a, b) => a.number - b.number) : round.layout;
    const first = round.groups.find((group) => group.number === game.groupNumber)?.startingHole ?? layout[0]?.number;
    const receipts = records.map((record) => ({ ...record, players: [], contests: [] }));
    if (game.kind === 'churchy' && game.orderMode === 'tee' && first !== undefined) {
      receipts.push({ number: first, gameId: game.id, gameEtag: '', players: [], contests: [], rotation: { playerIds: game.playerIds } });
    }
    return calculateDots({ id: game.id, name: game.name, groupNumber: game.groupNumber, playerIds: game.playerIds,
      specials: automatic, kind: 'dots', version: 2, mode: 'rotating', stakeMinor: null,
      rotationHoles: game.kind === 'dots' ? game.rotationHoles : 3 }, { ...round, layout }, receipts).awards
      .filter((award) => award.source === 'automatic');
  }
  return calculateDots({ id: game.id, name: game.name, groupNumber: game.groupNumber, playerIds: game.playerIds,
    specials: automatic, kind: 'dots', version: 1, mode: 'individual', stakeMinor: null }, round, []).awards
    .filter((award) => award.source === 'automatic');
}

/** Reject newly earned automatic conflicts, including streaks affected by an earlier score edit. */
export function dotsAutomaticWriteConflicts(
  game: DotsGameDefinition | ChurchyGameDefinitionV3,
  before: DotRoundInput, after: DotRoundInput,
  previous: readonly DotsHoleRecord[], records: readonly DotsHoleRecord[],
): readonly string[] {
  if (!records.some((record) => record.players.some((player) => player.calls.some((call) =>
    call.result === 'failure' || call.murphyTarget !== undefined || call.pareeTarget !== undefined)))) return [];
  const oldAwards = dotsAutomaticWriteAwards(game, before, previous), awards = dotsAutomaticWriteAwards(game, after, records);
  const orderActivated = !previous.some((record) => record.rotation !== undefined)
    && records.some((record) => record.rotation !== undefined);
  const canonical = (player: DotsPlayerDeclaration | undefined) => player && JSON.stringify({
    playerId: player.playerId, counts: Object.entries(player.counts).sort(([a], [b]) => a.localeCompare(b)),
    calls: player.calls.map((call) => [call.id, call.kind, call.result, call.murphyPresses ?? null,
      call.murphyTarget ?? null, call.pareeTarget ?? null]),
  });
  return [...new Set(records.flatMap((record) => record.players.flatMap((player) => {
    const prior = previous.find((entry) => entry.number === record.number)?.players.find((entry) => entry.playerId === player.playerId);
    const changed = canonical(player) !== canonical(prior);
    const issues = (declaration: DotsPlayerDeclaration, round: DotRoundInput, source: readonly DotAward[]) => {
      const score = round.cards.find((card) => card.playerId === player.playerId)?.holes.find((hole) => hole.number === record.number)?.score;
      const par = (round.playerLayouts?.find((entry) => entry.playerId === player.playerId)?.layout ?? round.layout)
        .find((hole) => hole.number === record.number)?.par;
      const automaticKinds = dotsSpecialCatalog.filter(({ kind }) => source.some((award) =>
        award.number === record.number && award.earnedBy === player.playerId && award.kind === kind)).map(({ kind }) => kind);
      return dotsDeclarationWriteIssues(declaration, { score, par, automaticKinds }).conflicts
        .filter((issue) => issue.code === 'FAILED_CALL_SPECIAL');
    };
    const old = prior ? issues(prior, before, oldAwards) : [];
    return issues(player, after, awards).some((issue) => changed
      || !old.some((entry) => entry.kinds.join(':') === issue.kinds.join(':'))
      || orderActivated && awards.some((award) => award.number === record.number && award.earnedBy === player.playerId
        && award.kind === issue.kinds[1])) ? [player.playerId] : [];
  })))];
}

export const dotsManualKinds: readonly DotsSpecialKind[] = [
  'hogan', 'seve', 'sandy', 'pully', 'dime', 'super-dime', 'haz-par', 'gorilla', 'walk', 'chippy', 'pickup', 'other',
];
export function dotsManualKindsFor(game: Pick<DotsGameDefinition, 'sweepRule'>): readonly DotsSpecialKind[] {
  return game.sweepRule === 'manual-v1' ? [...dotsManualKinds, 'sweep'] : dotsManualKinds;
}
const categories: readonly DotsContest['kind'][] = ['kp', 'blue-plate', 'long-drive'];
const parQualified: readonly DotsSpecialKind[] = ['hogan', 'seve', 'sandy', 'haz-par', 'chippy'];
const exact = (value: bigint): number | null => value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
const sum = (values: readonly number[]): number | null => exact(values.reduce((total, value) => total + BigInt(value), 0n));
const unique = (values: readonly unknown[]) => new Set(values).size === values.length;
const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
const pullyScore = (strokes: number | null, par: number | undefined) => par !== undefined
  && (strokes === par || strokes === par - 1);
const sameMembers = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && unique(left) && left.every((id) => right.includes(id));
type DotsRulesProfile = 'dots' | 'churcie-v3';

export function dotsDefinitionMatchesRound(game: DotsGameDefinition, round: DotRoundInput): boolean {
  const groups = round.groups.filter((group) => group.number === game.groupNumber);
  const group = groups[0];
  return groups.length === 1 && group !== undefined
    && (game.mode === 'individual' ? game.playerIds.length >= 1 && game.playerIds.length <= 4
      && (game.playerIds.length !== 1 || game.stakeMinor === null || game.stakeMinor === 0)
      : game.playerIds.length === 4) && unique(game.playerIds)
    && sameMembers(group.playerIds, game.playerIds)
    && game.playerIds.every((id) => round.cards.filter((card) => card.playerId === id).length === 1
      && round.groups.filter((candidate) => candidate.playerIds.includes(id)).length === 1)
    && round.layout.length > 0 && unique(round.layout.map((hole) => hole.number))
    && round.layout.every((hole) => positive(hole.number) && positive(hole.par))
    && (group.startingHole === undefined || round.layout.some((hole) => hole.number === group.startingHole))
    && (game.mode !== 'fixed' || sameMembers(game.partnerIds, game.playerIds));
}

function contextFor(game: DotsGameDefinition, number: number, contexts: readonly DotHoleContext[]): DotHoleContext {
  if (game.mode === 'rotating') return contexts.find((context) => context.number === number)
    ?? { number, status: 'pending', sides: [], multiplier: 1, reason: 'missing-dots-rotation' };
  if (game.mode === 'linked') {
    const matches = contexts.filter((context) => context.number === number);
    const found = matches[0];
    if (matches.length > 1) return { number, status: 'unavailable', sides: [], multiplier: 1, reason: 'duplicate-linked-context' };
    if (!found) return { number, status: 'pending', sides: [], multiplier: 1, reason: 'missing-linked-context' };
    if (found.sourceGameId !== undefined && found.sourceGameId !== game.linkedGameId) {
      return { number, status: 'unavailable', sides: [], multiplier: 1, reason: 'invalid-linked-context' };
    }
    if (found.status !== 'ready') return found;
    const members = found.sides.flat();
    if (!sameMembers(members, game.playerIds)
      || found.sides.length !== 2 || found.sides.some((side) => side.length < 1)
      || ![1, 2, 3].includes(found.multiplier)
      || [found.highWinnerIds, found.lowWinnerIds].some((ids) => ids !== undefined && ids.length > 0
        && !found.sides.some((side) => sameMembers(side, ids)))) {
      return { number, status: 'unavailable', sides: [], multiplier: 1, reason: 'invalid-linked-context' };
    }
    return found;
  }
  return { number, status: 'ready', multiplier: 1, sides: game.mode === 'individual'
    ? game.playerIds.map((id) => [id]) : [game.partnerIds.slice(0, 2), game.partnerIds.slice(2)] };
}

/** Semantic write validation. Read projections can still represent historical invalid input as unavailable. */
export function dotsRecordsMatchGame(
  records: readonly DotsHoleRecord[], game: DotsGameDefinition, round: DotRoundInput,
  contexts: readonly DotHoleContext[] = [],
  previous?: { readonly records: readonly DotsHoleRecord[]; readonly round: DotRoundInput },
  qualification: 'strict' | 'review' = 'strict',
): boolean {
  if (!dotsDefinitionMatchesRound(game, round) || !unique(records.map((record) => record.number))) return false;
  const rotations = records.filter((record) => record.rotation !== undefined);
  if (rotations.length > 1 || rotations.length && (game.version !== 2
    || dotsRotationContext(game, round, records).contexts.some((context) => context.status === 'unavailable'))) return false;
  const enabled = new Set(game.specials.map((special) => special.kind));
  const callIds: string[] = [];
  for (const record of records) {
    const hole = round.layout.find((candidate) => candidate.number === record.number);
    if (!hole || record.gameId !== game.id || !unique(record.players.map((player) => player.playerId))
      || !unique(record.contests.map((contest) => contest.kind))) return false;
    for (const player of record.players) {
      if (!game.playerIds.includes(player.playerId)) return false;
      const prior = previous?.records.find((entry) => entry.number === record.number && entry.gameId === game.id)
        ?.players.find((entry) => entry.playerId === player.playerId);
      const unchanged = prior !== undefined && sameDotsPlayerDeclaration(player, prior);
      if (game.version === 2 && dotsDeclarationIssues(player).conflicts.length && !unchanged) return false;
      const personal = round.playerLayouts?.find((entry) => entry.playerId === player.playerId)?.layout ?? round.layout;
      const par = personal.find((entry) => entry.number === record.number)?.par;
      const score = round.cards.find((card) => card.playerId === player.playerId)?.holes.find((entry) => entry.number === record.number)?.score;
      const oldScore = previous?.round.cards.find((card) => card.playerId === player.playerId)
        ?.holes.find((entry) => entry.number === record.number)?.score;
      const oldPar = (previous?.round.playerLayouts?.find((entry) => entry.playerId === player.playerId)?.layout
        ?? previous?.round.layout)?.find((entry) => entry.number === record.number)?.par;
      const historical = (kind: string) => unchanged
        && dotsCoexistenceWriteIssues(prior, { score: oldScore, par: oldPar }).conflicts
          .some((issue) => issue.code === 'SCORE_QUALIFICATION' && issue.kinds.some((entry) => entry === kind));
      for (const [kind, count] of Object.entries(player.counts)) {
        if (!dotsManualKindsFor(game).some((manual) => manual === kind) || !game.specials.some((entry) => entry.kind === kind)
          || !Number.isSafeInteger(count) || count < 0) return false;
        if (!count) continue;
        if (qualification === 'strict' && kind === 'gorilla' && par !== 5) return false;
        if (qualification === 'strict' && !historical(kind) && score?.kind === 'strokes' && (parQualified.some((entry) => entry === kind) && (par === undefined || score.strokes > par)
          || kind === 'pully' && !pullyScore(score.strokes, par))) return false;
        if (qualification === 'strict' && !historical(kind) && score && score.kind !== 'unplayed' && score.kind !== 'strokes'
          && (parQualified.some((entry) => entry === kind) || kind === 'pully')) return false;
      }
      if ((player.counts.dime ?? 0) > 0 && (player.counts['super-dime'] ?? 0) > 0 && !unchanged) return false;
      for (const call of player.calls) {
        callIds.push(call.id);
        if (!enabled.has(call.kind) || call.murphyPresses !== undefined
          && (call.kind !== 'murphy' || ![0, 1, 2].includes(call.murphyPresses))) return false;
        if (call.murphyTarget !== undefined && (call.kind !== 'murphy'
          || !['par', 'birdie'].includes(call.murphyTarget) || call.result !== 'pending')) return false;
        if (call.pareeTarget !== undefined && (call.kind !== 'paree'
          || call.result !== 'pending')) return false;
        if (call.pullyMurphyTarget !== undefined && (call.kind !== 'pully-murphy'
          || call.result !== 'pending')) return false;
        if (qualification === 'strict' && !historical(call.kind) && call.result === 'success' && score && score.kind !== 'unplayed'
          && (score.kind !== 'strokes' || par === undefined
            || (call.kind === 'pully-murphy' ? score.strokes !== par : score.strokes > par))) return false;
      }
    }
    for (const contest of record.contests) {
      const neededForAssassin = enabled.has('assassin') && contest.kind !== 'long-drive';
      if (!enabled.has(contest.kind) && !neededForAssassin
        || qualification === 'strict' && hole.par !== (contest.kind === 'kp' ? 3 : 5)) return false;
      if (contest.status === 'awarded') {
        if (!contest.winnerId || !game.playerIds.includes(contest.winnerId)
          || contest.secondId !== undefined && (!game.playerIds.includes(contest.secondId)
            || contest.secondId === contest.winnerId)) return false;
      } else if (contest.winnerId !== undefined || contest.secondId !== undefined) return false;
    }
    if (game.mode === 'linked' && contexts.length && contextFor(game, record.number, contexts).status === 'unavailable') return false;
  }
  return unique(callIds);
}

export function calculateDots(
  game: DotsGameDefinition, round: DotRoundInput, records: readonly DotsHoleRecord[],
  contexts: readonly DotHoleContext[] = [], profile: DotsRulesProfile = 'dots',
): DotsResults {
  const issues: string[] = [];
  const rotation = game.version === 2 ? dotsRotationContext(game, round, records) : undefined;
  const effectiveContexts = rotation?.contexts ?? contexts;
  const valid = dotsDefinitionMatchesRound(game, round);
  const recordsValid = valid && dotsRecordsMatchGame(records, game, round, [], undefined, 'review');
  const reviewRequired: DotSpecialReview[] = [];
  if (!valid) issues.push('invalid-dots-group');
  else if (!recordsValid) issues.push('invalid-dots-records');
  const units = new Map(game.specials.map((special) => [special.kind, special.units]));
  const configValid = unique(game.specials.map((special) => special.kind))
    && (game.sweepRule === undefined || profile === 'dots' && units.has('sweep'))
    && game.specials.every((special) => positive(special.units) && dotsSpecialCatalog.some((entry) => entry.kind === special.kind));
  if (!configValid) issues.push('invalid-dots-configuration');
  const supportedMode = !(game.mode === 'individual' && units.has('assassin'))
    && !(game.mode !== 'linked' && units.has('sweep') && game.sweepRule !== 'manual-v1');
  if (!supportedMode) issues.push('unsupported-dots-special-mode');
  const group = round.groups.find((entry) => entry.number === game.groupNumber);
  const start = round.layout.findIndex((hole) => hole.number === (group?.startingHole ?? round.layout[0]?.number));
  const order = rotation
    ? rotation.contexts.flatMap((context) => round.layout.filter((hole) => hole.number === context.number))
    : [...round.layout.slice(Math.max(0, start)), ...round.layout.slice(0, Math.max(0, start))];
  type WorkingHole = { number: number; status: DotsHoleResult['status']; reason?: string; awards: DotAward[] };
  const holes: WorkingHole[] = order.map((hole) => ({ number: hole.number, status: 'complete', awards: [] }));
  const awards: DotAward[] = [];
  const unawarded: { kind: DotsSpecialKind; sourceHoles: readonly number[]; units: number }[] = [];
  const streaks = new Map<string, { par: number[]; birdie: number[]; unknown: { par: boolean; birdie: boolean } }>();
  const carries = new Map<DotsContest['kind'], { holes: number[]; blocked: 'pending' | 'unavailable' | null }>(
    categories.map((kind) => [kind, { holes: [], blocked: null }]),
  );
  const mark = (hole: WorkingHole, status: 'pending' | 'unavailable', reason: string) => {
    if (hole.status !== 'unavailable') { hole.status = status; hole.reason = reason; }
  };
  const review = (hole: WorkingHole, kind: DotsSpecialKind, reason: DotSpecialReview['reason'], playerId?: string) => {
    if (!reviewRequired.some((entry) => entry.number === hole.number && entry.kind === kind && entry.playerId === playerId)) {
      reviewRequired.push({ number: hole.number, kind, reason, ...(playerId === undefined ? {} : { playerId }) });
    }
    mark(hole, 'pending', 'special-review-required');
  };
  for (const hole of holes) {
    if (!valid || !recordsValid || !configValid || !supportedMode) { mark(hole, 'unavailable', issues[0] ?? 'invalid-dots-input'); continue; }
    const context = contextFor(game, hole.number, effectiveContexts);
    const record = records.find((entry) => entry.number === hole.number);
    const defaultPar = round.layout.find((entry) => entry.number === hole.number)?.par;
    for (const contest of record?.contests ?? []) {
      if (defaultPar !== (contest.kind === 'kp' ? 3 : 5)) {
        review(hole, contest.kind, 'category-hole', contest.winnerId);
        const carry = carries.get(contest.kind);
        if (carry) carry.blocked = 'pending';
      }
    }
    if (context.status !== 'ready') mark(hole, context.status, context.reason ?? 'linked-context-not-ready');
    const evidence = (sourceHoles: readonly number[]) => game.playerIds.flatMap((playerId) => sourceHoles.flatMap((number) => {
      const layout = round.playerLayouts?.find((entry) => entry.playerId === playerId)?.layout ?? round.layout;
      const par = layout.find((entry) => entry.number === number)?.par;
      const score = round.cards.find((entry) => entry.playerId === playerId)?.holes.find((entry) => entry.number === number)?.score;
      return par === undefined ? [] : [{ playerId, number, strokes: score?.kind === 'strokes' ? score.strokes : null, par }];
    }));
    const add = (kind: DotsSpecialKind | 'category-sweep', earnedBy: string | null, recipients: readonly string[], count: number,
      source: DotAward['source'], sourceHoles: readonly number[], reason: string, suffix = '', multiplier = context.multiplier) => {
      const base = kind === 'category-sweep' ? 1 : units.get(kind);
      if (base === undefined || context.status !== 'ready' || recipients.length === 0) return;
      const dots = exact(BigInt(base) * BigInt(count) * BigInt(multiplier));
      if (dots === null) { mark(hole, 'unavailable', 'arithmetic-range'); issues.push('arithmetic-range'); return; }
      const award: DotAward = { id: `${game.id}:${String(hole.number)}:${kind}:${earnedBy ?? 'side'}:${suffix}`,
        number: hole.number, kind, source, earnedBy, recipientIds: [...recipients], units: base, count,
        multiplier, dots, sourceHoles: [...sourceHoles], scores: evidence(sourceHoles), reason };
      hole.awards.push(award); awards.push(award);
    };
    const own = (playerId: string) => context.sides.find((side) => side.includes(playerId)) ?? [];
    const opponents = (playerId: string) => game.playerIds.filter((id) => !own(playerId).includes(id));
    for (const playerId of game.playerIds) {
      const card = round.cards.find((entry) => entry.playerId === playerId);
      const scores = card?.holes.filter((entry) => entry.number === hole.number) ?? [];
      const score = scores[0]?.score;
      const personalLayouts = round.playerLayouts?.filter((entry) => entry.playerId === playerId);
      const layout = personalLayouts?.[0]?.layout ?? round.layout;
      const par = layout.find((entry) => entry.number === hole.number)?.par;
      const numeric = score?.kind === 'strokes' && positive(score.strokes);
      const pending = !score || score.kind === 'unplayed';
      if (scores.length > 1 || par === undefined || !positive(par) || (personalLayouts?.length ?? 0) > 1
        || score?.kind === 'strokes' && !numeric) mark(hole, 'unavailable', 'invalid-score-input');
      else if (pending) mark(hole, 'pending', 'missing-score-data');
      const strokes = numeric ? score.strokes : null;
      const declaration = record?.players.find((entry) => entry.playerId === playerId);
      for (const kind of dotsManualKindsFor(game)) {
        const count = declaration?.counts[kind] ?? 0;
        if (!count || !units.has(kind)) continue;
        if (kind === 'dime' && (declaration?.counts['super-dime'] ?? 0) > 0) continue;
        if ((parQualified.includes(kind) || kind === 'pully') && pending) { mark(hole, 'pending', 'special-needs-score'); continue; }
        if (parQualified.includes(kind) && (strokes === null || par === undefined || strokes > par)
          || kind === 'pully' && !pullyScore(strokes, par) || kind === 'gorilla' && par !== 5) {
          review(hole, kind, 'score-qualification', playerId); continue;
        }
        add(kind, playerId, kind === 'walk' || kind === 'pickup' ? opponents(playerId) : own(playerId),
          count, 'manual', [hole.number], kind === 'sweep' ? `Manually awarded ${String(count)} Sweep.`
            : `Declared ${String(count)} ${kind}; qualifying gross facts are honor-system claims.`);
      }
      for (const call of declaration?.calls ?? []) {
        const result = dotsCallResult(call, score, par);
        if (result === 'pending') { mark(hole, 'pending', 'unresolved-call'); continue; }
        if (result === 'success' && pending) { mark(hole, 'pending', 'call-needs-score'); continue; }
        if (result === 'success' && (strokes === null || par === undefined
          || (call.kind === 'pully-murphy' ? strokes !== par : strokes > par))) {
          review(hole, call.kind, 'score-qualification', playerId); continue;
        }
        add(call.kind, playerId, result === 'failure' ? opponents(playerId) : own(playerId),
          1 + (call.murphyPresses ?? 0), 'manual', [hole.number], `${dotsSpecialCatalog.find((entry) => entry.kind === call.kind)?.label ?? call.kind} call: ${result}.`, call.id,
          call.murphyTarget !== undefined || call.pareeTarget !== undefined
            || call.murphyPresses !== undefined ? 1 : context.multiplier);
      }
      if (strokes !== null && par !== undefined) {
        if (strokes === par - 1) add('birdie', playerId, own(playerId), 1, 'automatic', [hole.number], 'Exactly one under personal gross par.');
        if (strokes === par - 2) add('eagle', playerId, own(playerId), 1, 'automatic', [hole.number], 'Exactly two under personal gross par.');
      }
      const streak = streaks.get(playerId) ?? { par: [], birdie: [], unknown: { par: false, birdie: false } };
      for (const kind of ['birdy-string', 'string'] as const) {
        const key = kind === 'string' ? 'par' : 'birdie';
        if (pending) { streak[key] = []; streak.unknown[key] = true; continue; }
        const qualifies = strokes !== null && par !== undefined
          && (kind === 'string' ? round.stringRulesVersion === 1 ? strokes === par : strokes <= par : strokes < par);
        if (!qualifies) { streak[key] = []; streak.unknown[key] = false; continue; }
        streak[key].push(hole.number);
        const replaced = round.stringRulesVersion !== 1 && kind === 'string'
          && units.has('birdy-string') && streak.birdie.length >= 3;
        if (streak[key].length >= 3 && !replaced) add(kind, playerId, own(playerId), 1, 'automatic', streak[key].slice(-3), 'Three consecutive qualifying acknowledged gross scores.');
        else if (streak[key].length < 3 && streak.unknown[key] && units.has(kind)) mark(hole, 'pending', 'earlier-streak-score-pending');
      }
      streaks.set(playerId, streak);
    }
    for (const kind of categories) {
      const neededForAssassin = units.has('assassin') && kind !== 'long-drive';
      if (!units.has(kind) && !neededForAssassin || defaultPar !== (kind === 'kp' ? 3 : 5)) continue;
      const carry = carries.get(kind);
      if (!carry) continue;
      const contest = record?.contests.find((entry) => entry.kind === kind);
      if (contest?.status === 'awarded' && contest.winnerId && contest.secondId
        && context.sides.length === 2 && context.sides.every((side) => side.length === 2)
        && own(contest.winnerId).includes(contest.secondId)) {
        add('assassin', contest.winnerId, own(contest.winnerId), 1, 'derived', [hole.number],
          kind === 'long-drive' ? 'Both longest qualifying drives belong to the same pair.'
            : 'Both closest qualifying approaches belong to the same pair.', kind);
      }
      if (carry.blocked) { mark(hole, carry.blocked, 'earlier-contest-unresolved'); continue; }
      if (!contest) { carry.blocked = 'pending'; mark(hole, 'pending', 'missing-contest-decision'); continue; }
      carry.holes.push(hole.number);
      if (contest.status === 'no-qualifier') continue;
      if (context.status !== 'ready') { carry.blocked = context.status; continue; }
      const winner = contest.winnerId;
      if (!winner) continue;
      add(kind, winner, own(winner), carry.holes.length, 'manual', carry.holes, 'Winner collects current and carried category awards.');
      carry.holes = [];
    }
    if (profile === 'dots' && round.dotsCategorySweepsVersion !== 0 && defaultPar === 5
      && units.has('long-drive') && units.has('blue-plate')) {
      const drive = record?.contests.find((contest) => contest.kind === 'long-drive');
      const approach = record?.contests.find((contest) => contest.kind === 'blue-plate');
      if (drive?.status === 'awarded' && approach?.status === 'awarded'
        && drive.winnerId !== undefined && drive.winnerId === approach.winnerId) {
        add('category-sweep', drive.winnerId, own(drive.winnerId), 1, 'derived', [hole.number],
          'The same golfer won Long Drive and Blue Plate on this hole.', '', 1);
      }
    }
    if (units.has('sweep') && game.sweepRule !== 'manual-v1' && game.mode === 'linked' && context.status === 'ready'
      && context.sides.length === 2 && context.sides.every((side) => side.length === 2)) {
      if (context.highWinnerIds === undefined || context.lowWinnerIds === undefined) {
        mark(hole, 'pending', 'missing-sweep-outcome');
      } else if (context.highWinnerIds.length === 2 && sameMembers(context.highWinnerIds, context.lowWinnerIds)) {
        add('sweep', null, context.highWinnerIds, profile === 'churcie-v3' ? context.sweepMultiplier ?? 1 : 1,
          'derived', [hole.number], 'The same linked pair won High and Low.');
      }
    }
  }
  for (const kind of categories) {
    const carry = carries.get(kind), base = units.get(kind);
    if (!carry || base === undefined || carry.blocked || !carry.holes.length) continue;
    const amount = exact(BigInt(base) * BigInt(carry.holes.length));
    if (amount === null) issues.push('arithmetic-range');
    else unawarded.push({ kind, sourceHoles: [...carry.holes], units: amount });
  }
  if (holes.length > 0 && holes.every((hole) => hole.status === 'complete') && units.has('king-of-the-hill')) {
    for (const kind of categories) {
      if (!units.has(kind)) continue;
      const eligible = order.filter((hole) => hole.par === (kind === 'kp' ? 3 : 5)).map((hole) => hole.number);
      const categoryAwards = awards.filter((award) => award.kind === kind);
      const winner = categoryAwards[0]?.earnedBy;
      if (!eligible.length || !winner || categoryAwards.some((award) => award.earnedBy !== winner)
        || !sameMembers(categoryAwards.flatMap((award) => award.sourceHoles).map(String), eligible.map(String))) continue;
      const base = units.get('king-of-the-hill') ?? 1;
      awards.push({ id: `${game.id}:king:${kind}`, number: null, kind: 'king-of-the-hill', source: 'derived',
        earnedBy: winner, recipientIds: [winner], units: base, count: 1, multiplier: 1, dots: base,
        sourceHoles: eligible, scores: [], reason: `Individual owner of every ${kind} award, including collected carry.` });
    }
  }
  const resultHoles: DotsHoleResult[] = holes.map((hole) => {
    const points = game.playerIds.map((playerId) => ({ playerId,
      dots: hole.status !== 'complete' ? null : sum(hole.awards.filter((award) => award.recipientIds.includes(playerId)).map((award) => award.dots)) }));
    if (points.some((point) => point.dots === null) && hole.status === 'complete') {
      mark(hole, 'unavailable', 'arithmetic-range'); issues.push('arithmetic-range');
      return { ...hole, points: points.map((point) => ({ ...point, dots: null })) };
    }
    return { ...hole, points };
  });
  const status = issues.length || resultHoles.some((hole) => hole.status === 'unavailable') ? 'unavailable'
    : resultHoles.some((hole) => hole.status === 'pending') ? 'in-progress' : 'complete';
  const players: GamePlayerResult[] = game.playerIds.map((playerId) => {
    const card = round.cards.find((entry) => entry.playerId === playerId);
    const playerAwards = awards.filter((award) => award.recipientIds.includes(playerId));
    const hasKnown = playerAwards.length > 0 || resultHoles.some((hole) => hole.status === 'complete');
    const total = hasKnown ? sum(playerAwards.map((award) => award.dots)) : null;
    const segment = (front: boolean) => {
      const selected = resultHoles.filter((hole) => (hole.number <= 9) === front);
      return selected.some((hole) => hole.status === 'complete')
        ? sum(playerAwards.filter((award) => award.number !== null && (award.number <= 9) === front).map((award) => award.dots)) : null;
    };
    if (hasKnown && total === null) issues.push('arithmetic-range');
    return { playerId, displayName: card?.displayName ?? playerId, playingHandicap: null,
      status: status === 'unavailable' || hasKnown && total === null ? 'unavailable' : status,
      holes: resultHoles.map((hole) => ({ number: hole.number, points: hole.points.find((point) => point.playerId === playerId)?.dots ?? null, strokesReceived: null })),
      holesScored: resultHoles.filter((hole) => hole.status === 'complete').length, totalHoles: order.length,
      frontPoints: segment(true), backPoints: segment(false), totalPoints: total };
  });
  return { status: issues.length ? 'unavailable' : status,
    players: issues.length ? players.map((player) => ({ ...player, status: 'unavailable' })) : players,
    holes: resultHoles, awards, unawarded, issues: [...new Set(issues)],
    ...(rotation ? { rotation } : {}), ...(reviewRequired.length ? { reviewRequired } : {}) };
}
