import type { DotAward, DotHoleContext, DotRoundInput } from './dot-context.js';
import type { GamePlayerResult } from './games.js';
import { dotsRotationContext } from './dots-rotation.js';
import type { DotsRotationContext } from './dots-rotation.js';
export { dotsFirstPlayedHole, dotsRotationContext } from './dots-rotation.js';
export type { DotsRotationContext } from './dots-rotation.js';

export type DotsSpecialKind = 'hogan' | 'seve' | 'long-drive' | 'paree' | 'sandy' | 'pully' | 'dime'
  | 'super-dime' | 'kp' | 'murphy' | 'pully-murphy' | 'haz-par' | 'gorilla' | 'birdie' | 'eagle'
  | 'string' | 'birdy-string' | 'blue-plate' | 'king-of-the-hill' | 'assassin' | 'walk' | 'sweep' | 'chippy' | 'pickup';

export const dotsSpecialCatalog: readonly {
  readonly kind: DotsSpecialKind; readonly label: string; readonly description: string;
  readonly defaultUnits: number; readonly automatic: boolean;
}[] = [
  { kind: 'hogan', label: 'Hogan', description: 'Fairway and GIR (GIR only on par 3), gross par or better.', defaultUnits: 1, automatic: false },
  { kind: 'seve', label: 'Seve', description: 'Miss fairway and GIR (miss GIR only on par 3), gross par or better.', defaultUnits: 1, automatic: false },
  { kind: 'long-drive', label: 'Long Drive', description: 'Longest qualifying fairway drive on each par 5; category carry.', defaultUnits: 1, automatic: false },
  { kind: 'paree', label: 'Paree', description: 'Separately called fairway-bunker recovery, gross par or better; failure awards opponents.', defaultUnits: 1, automatic: false },
  { kind: 'sandy', label: 'Sandy', description: 'Each bunker recovery, gross par or better.', defaultUnits: 1, automatic: false },
  { kind: 'pully', label: 'Pully', description: 'Hole a gross par putt longer than the flagstick.', defaultUnits: 1, automatic: false },
  { kind: 'dime', label: 'Dime', description: 'Approach inside the flagstick; replaced by SuperDime.', defaultUnits: 1, automatic: false },
  { kind: 'super-dime', label: 'SuperDime', description: 'Approach inside the putter, replacing Dime.', defaultUnits: 1, automatic: false },
  { kind: 'kp', label: 'KP', description: 'Closest qualifying GIR on each par 3; category carry.', defaultUnits: 1, automatic: false },
  { kind: 'murphy', label: 'Murphy', description: 'Called up-and-down, gross par or better; failure awards opponents.', defaultUnits: 1, automatic: false },
  { kind: 'pully-murphy', label: 'Pully Murphy', description: 'Separately called long gross par putt; failure awards opponents.', defaultUnits: 1, automatic: false },
  { kind: 'haz-par', label: 'Haz Par', description: 'Hazard recovery, gross par or better.', defaultUnits: 1, automatic: false },
  { kind: 'gorilla', label: 'Gorilla', description: 'Reach a personal par-5 green in two, regardless of final score.', defaultUnits: 1, automatic: false },
  { kind: 'birdie', label: 'Birdie', description: 'Exactly one under personal gross par.', defaultUnits: 2, automatic: true },
  { kind: 'eagle', label: 'Eagle', description: 'Exactly two under personal gross par, not also Birdie.', defaultUnits: 5, automatic: true },
  { kind: 'string', label: 'String', description: 'Third consecutive exact gross par, and every subsequent par.', defaultUnits: 1, automatic: true },
  { kind: 'birdy-string', label: 'BirdyString', description: 'Third consecutive gross birdie or better, and every subsequent qualifying hole.', defaultUnits: 1, automatic: true },
  { kind: 'blue-plate', label: 'Blue Plate', description: 'Closest qualifying GIR on each par 5; category carry.', defaultUnits: 1, automatic: false },
  { kind: 'king-of-the-hill', label: 'King of the Hill', description: 'Individual round-end ownership of every award in a category; never shared or multiplied.', defaultUnits: 1, automatic: true },
  { kind: 'assassin', label: 'Assassin', description: 'A partnered pair holds both closest qualifying approaches on a par 3 or 5.', defaultUnits: 1, automatic: true },
  { kind: 'walk', label: 'Walk', description: 'Manually declared three-putt awards the opposing side.', defaultUnits: 1, automatic: false },
  { kind: 'sweep', label: 'Sweep', description: 'The same partnered pair wins linked High and Low.', defaultUnits: 1, automatic: true },
  { kind: 'chippy', label: 'Chippy', description: 'Chip in, gross par or better.', defaultUnits: 1, automatic: false },
  { kind: 'pickup', label: 'Pickup', description: 'Explicitly selected pickup awards opponents; never inferred from a score.', defaultUnits: 1, automatic: false },
];

export interface DotsSpecialSelection { readonly kind: DotsSpecialKind; readonly units: number }
interface CommonDotsDefinition {
  readonly id: string; readonly name: string; readonly kind: 'dots';
  readonly groupNumber: number; readonly playerIds: readonly string[];
  readonly specials: readonly DotsSpecialSelection[];
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
}

export interface DotsDeclarationIssue {
  readonly code: 'HOGAN_SEVE' | 'PULLY_DIME' | 'HOGAN_MURPHY' | 'HOGAN_CHIPPY' | 'DIME_SUPER_DIME'
    | 'HOGAN_WALK' | 'SEVE_WALK';
  readonly kinds: readonly DotsSpecialKind[];
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

export const dotsManualKinds: readonly DotsSpecialKind[] = [
  'hogan', 'seve', 'sandy', 'pully', 'dime', 'super-dime', 'haz-par', 'gorilla', 'walk', 'chippy', 'pickup',
];
const categories: readonly DotsContest['kind'][] = ['kp', 'blue-plate', 'long-drive'];
const parQualified: readonly DotsSpecialKind[] = ['hogan', 'seve', 'sandy', 'haz-par', 'chippy'];
const exact = (value: bigint): number | null => value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
const sum = (values: readonly number[]): number | null => exact(values.reduce((total, value) => total + BigInt(value), 0n));
const unique = (values: readonly unknown[]) => new Set(values).size === values.length;
const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
const sameMembers = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && unique(left) && left.every((id) => right.includes(id));

export function dotsDefinitionMatchesRound(game: DotsGameDefinition, round: DotRoundInput): boolean {
  const groups = round.groups.filter((group) => group.number === game.groupNumber);
  const group = groups[0];
  return groups.length === 1 && group !== undefined && game.playerIds.length === 4 && unique(game.playerIds)
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
      if (game.version === 2 && dotsDeclarationIssues(player).conflicts.length) return false;
      const personal = round.playerLayouts?.find((entry) => entry.playerId === player.playerId)?.layout ?? round.layout;
      const par = personal.find((entry) => entry.number === record.number)?.par;
      const score = round.cards.find((card) => card.playerId === player.playerId)?.holes.find((entry) => entry.number === record.number)?.score;
      for (const [kind, count] of Object.entries(player.counts)) {
        if (!dotsManualKinds.some((manual) => manual === kind) || !game.specials.some((entry) => entry.kind === kind)
          || !Number.isSafeInteger(count) || count < 0) return false;
        if (!count) continue;
        if (kind === 'gorilla' && par !== 5) return false;
        if (score?.kind === 'strokes' && (parQualified.some((entry) => entry === kind) && (par === undefined || score.strokes > par)
          || kind === 'pully' && score.strokes !== par)) return false;
        if (score && score.kind !== 'unplayed' && score.kind !== 'strokes'
          && (parQualified.some((entry) => entry === kind) || kind === 'pully')) return false;
      }
      if ((player.counts.dime ?? 0) > 0 && (player.counts['super-dime'] ?? 0) > 0) return false;
      for (const call of player.calls) {
        callIds.push(call.id);
        if (!enabled.has(call.kind)) return false;
        if (call.result === 'success' && score && score.kind !== 'unplayed'
          && (score.kind !== 'strokes' || par === undefined
            || (call.kind === 'pully-murphy' ? score.strokes !== par : score.strokes > par))) return false;
      }
    }
    for (const contest of record.contests) {
      const neededForAssassin = enabled.has('assassin') && contest.kind !== 'long-drive';
      if (!enabled.has(contest.kind) && !neededForAssassin || hole.par !== (contest.kind === 'kp' ? 3 : 5)) return false;
      if (contest.status === 'awarded') {
        if (!contest.winnerId || !game.playerIds.includes(contest.winnerId)
          || contest.secondId !== undefined && (!game.playerIds.includes(contest.secondId)
            || contest.secondId === contest.winnerId || contest.kind === 'long-drive')) return false;
      } else if (contest.winnerId !== undefined || contest.secondId !== undefined) return false;
    }
    if (game.mode === 'linked' && contexts.length && contextFor(game, record.number, contexts).status === 'unavailable') return false;
  }
  return unique(callIds);
}

export function calculateDots(
  game: DotsGameDefinition, round: DotRoundInput, records: readonly DotsHoleRecord[],
  contexts: readonly DotHoleContext[] = [],
): DotsResults {
  const issues: string[] = [];
  const rotation = game.version === 2 ? dotsRotationContext(game, round, records) : undefined;
  const effectiveContexts = rotation?.contexts ?? contexts;
  const valid = dotsDefinitionMatchesRound(game, round);
  const recordsValid = valid && dotsRecordsMatchGame(records, game, round);
  if (!valid) issues.push('invalid-dots-group');
  else if (!recordsValid) issues.push('invalid-dots-records');
  const units = new Map(game.specials.map((special) => [special.kind, special.units]));
  const configValid = unique(game.specials.map((special) => special.kind))
    && game.specials.every((special) => positive(special.units) && dotsSpecialCatalog.some((entry) => entry.kind === special.kind));
  if (!configValid) issues.push('invalid-dots-configuration');
  const supportedMode = !(game.mode === 'individual' && units.has('assassin'))
    && !(game.mode !== 'linked' && units.has('sweep'));
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
  for (const hole of holes) {
    if (!valid || !recordsValid || !configValid || !supportedMode) { mark(hole, 'unavailable', issues[0] ?? 'invalid-dots-input'); continue; }
    const context = contextFor(game, hole.number, effectiveContexts);
    const record = records.find((entry) => entry.number === hole.number);
    const defaultPar = round.layout.find((entry) => entry.number === hole.number)?.par;
    if (context.status !== 'ready') mark(hole, context.status, context.reason ?? 'linked-context-not-ready');
    const evidence = (sourceHoles: readonly number[]) => game.playerIds.flatMap((playerId) => sourceHoles.flatMap((number) => {
      const layout = round.playerLayouts?.find((entry) => entry.playerId === playerId)?.layout ?? round.layout;
      const par = layout.find((entry) => entry.number === number)?.par;
      const score = round.cards.find((entry) => entry.playerId === playerId)?.holes.find((entry) => entry.number === number)?.score;
      return par === undefined ? [] : [{ playerId, number, strokes: score?.kind === 'strokes' ? score.strokes : null, par }];
    }));
    const add = (kind: DotsSpecialKind, earnedBy: string | null, recipients: readonly string[], count: number,
      source: DotAward['source'], sourceHoles: readonly number[], reason: string, suffix = '') => {
      const base = units.get(kind);
      if (base === undefined || context.status !== 'ready') return;
      const dots = exact(BigInt(base) * BigInt(count) * BigInt(context.multiplier));
      if (dots === null) { mark(hole, 'unavailable', 'arithmetic-range'); issues.push('arithmetic-range'); return; }
      const award: DotAward = { id: `${game.id}:${String(hole.number)}:${kind}:${earnedBy ?? 'side'}:${suffix}`,
        number: hole.number, kind, source, earnedBy, recipientIds: [...recipients], units: base, count,
        multiplier: context.multiplier, dots, sourceHoles: [...sourceHoles], scores: evidence(sourceHoles), reason };
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
      for (const kind of dotsManualKinds) {
        const count = declaration?.counts[kind] ?? 0;
        if (!count || !units.has(kind)) continue;
        if (kind === 'dime' && (declaration?.counts['super-dime'] ?? 0) > 0) continue;
        if ((parQualified.includes(kind) || kind === 'pully') && pending) { mark(hole, 'pending', 'special-needs-score'); continue; }
        if (parQualified.includes(kind) && (strokes === null || par === undefined || strokes > par)
          || kind === 'pully' && strokes !== par || kind === 'gorilla' && par !== 5) continue;
        add(kind, playerId, kind === 'walk' || kind === 'pickup' ? opponents(playerId) : own(playerId),
          count, 'manual', [hole.number], `Declared ${String(count)} ${kind}; qualifying gross facts are honor-system claims.`);
      }
      for (const call of declaration?.calls ?? []) {
        if (call.result === 'pending') { mark(hole, 'pending', 'unresolved-call'); continue; }
        if (call.result === 'success' && pending) { mark(hole, 'pending', 'call-needs-score'); continue; }
        add(call.kind, playerId, call.result === 'failure' ? opponents(playerId) : own(playerId),
          1, 'manual', [hole.number], `${dotsSpecialCatalog.find((entry) => entry.kind === call.kind)?.label ?? call.kind} call: ${call.result}.`, call.id);
      }
      if (strokes !== null && par !== undefined) {
        if (strokes === par - 1) add('birdie', playerId, own(playerId), 1, 'automatic', [hole.number], 'Exactly one under personal gross par.');
        if (strokes === par - 2) add('eagle', playerId, own(playerId), 1, 'automatic', [hole.number], 'Exactly two under personal gross par.');
      }
      const streak = streaks.get(playerId) ?? { par: [], birdie: [], unknown: { par: false, birdie: false } };
      for (const kind of ['string', 'birdy-string'] as const) {
        const key = kind === 'string' ? 'par' : 'birdie';
        if (pending) { streak[key] = []; streak.unknown[key] = true; continue; }
        const qualifies = strokes !== null && par !== undefined && (kind === 'string' ? strokes === par : strokes < par);
        if (!qualifies) { streak[key] = []; streak.unknown[key] = false; continue; }
        streak[key].push(hole.number);
        if (streak[key].length >= 3) add(kind, playerId, own(playerId), 1, 'automatic', streak[key].slice(-3), 'Three consecutive qualifying acknowledged gross scores.');
        else if (streak.unknown[key] && units.has(kind)) mark(hole, 'pending', 'earlier-streak-score-pending');
      }
      streaks.set(playerId, streak);
    }
    for (const kind of categories) {
      const neededForAssassin = units.has('assassin') && kind !== 'long-drive';
      if (!units.has(kind) && !neededForAssassin || defaultPar !== (kind === 'kp' ? 3 : 5)) continue;
      const carry = carries.get(kind);
      if (!carry) continue;
      const contest = record?.contests.find((entry) => entry.kind === kind);
      if (contest?.status === 'awarded' && contest.winnerId && kind !== 'long-drive' && contest.secondId
        && context.sides.length === 2 && context.sides.every((side) => side.length === 2)
        && own(contest.winnerId).includes(contest.secondId)) {
        add('assassin', contest.winnerId, own(contest.winnerId), 1, 'derived', [hole.number],
          'Both closest qualifying approaches belong to the same pair.', kind);
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
    if (units.has('sweep') && game.mode === 'linked' && context.status === 'ready'
      && context.sides.length === 2 && context.sides.every((side) => side.length === 2)) {
      if (context.highWinnerIds === undefined || context.lowWinnerIds === undefined) {
        mark(hole, 'pending', 'missing-sweep-outcome');
      } else if (context.highWinnerIds.length === 2 && sameMembers(context.highWinnerIds, context.lowWinnerIds)) {
        add('sweep', null, context.highWinnerIds, 1, 'derived', [hole.number], 'The same linked pair won High and Low.');
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
    ...(rotation ? { rotation } : {}) };
}
