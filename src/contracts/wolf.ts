import type { WolfComebackReceipt, WolfGameDefinition, WolfHoleChoice, WolfHoleRecord, WolfResults } from '../domain/wolf.js';
import { calculateWolf, wolfForHole, wolfGroupMatchesRound, wolfTransfers } from '../domain/wolf.js';
import type { WolfRoundInput } from '../domain/wolf.js';
import type { Scorecard } from '../domain/scoring.js';
import { boundedText } from './catalog.js';
import { isEventRevision, isRecord, isUuid } from './events.js';
import { sameJsonValue } from './round-context.js';

function keys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}
function integer(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value); }
function nonnegative(value: unknown): value is number { return integer(value) && value >= 0; }
function nullable(value: unknown): value is number | null { return value === null || integer(value); }
const reasons = ['missing-handicap-index', 'uncaptured-handicap-index', 'invalid-handicap-index', 'missing-tee-ratings',
  'missing-stroke-index', 'missing-score-data', 'invalid-wolf-group', 'invalid-wolf-choice', 'arithmetic-range',
  'missing-numeric-ball', 'invalid-stroke-score'];

export function isWolfDefinition(value: unknown): value is WolfGameDefinition {
  return isRecord(value) && keys(value, ['id', 'name', 'kind', 'version', 'basis', 'groupNumber', 'playerIds', 'allowPig',
    ...(value.version === 2 ? ['stakeMinor'] : [])])
    && isUuid(value.id) && boundedText(value.name) && value.kind === 'wolf'
    && (value.version === 1 || value.version === 2 && (value.stakeMinor === null || nonnegative(value.stakeMinor)))
    && (value.basis === 'gross' || value.basis === 'net') && nonnegative(value.groupNumber) && value.groupNumber > 0
    && typeof value.allowPig === 'boolean' && Array.isArray(value.playerIds) && value.playerIds.length === 4
    && value.playerIds.every(isUuid) && new Set(value.playerIds).size === 4;
}

export function isWolfChoice(value: unknown): value is WolfHoleChoice {
  return isRecord(value) && isUuid(value.gameId) && isEventRevision(value.gameEtag)
    && (value.mode === 'partner'
      ? keys(value, ['gameId', 'gameEtag', 'mode', 'partnerId']) && isUuid(value.partnerId)
      : (value.mode === 'blind' || value.mode === 'pig') && keys(value, ['gameId', 'gameEtag', 'mode']));
}

export function isWolfRecord(value: unknown): value is WolfHoleRecord {
  return isRecord(value) && keys(value, ['number', 'choice'], ['outcome', 'recordedLate', 'comeback'])
    && (value.recordedLate === undefined || value.recordedLate === true)
    && (value.comeback === undefined || isWolfComebackReceipt(value.comeback))
    && integer(value.number) && value.number >= 1 && value.number <= 18 && isWolfChoice(value.choice)
    && (value.outcome === undefined || value.outcome === 'scores' || value.outcome === 'wolf'
      || value.outcome === 'opponents' || value.outcome === 'halved');
}

export function isWolfComebackReceipt(value: unknown): value is WolfComebackReceipt {
  if (!isRecord(value) || !keys(value, ['wolfId', 'afterHoles', 'totals', 'proof'])
    || !isUuid(value.wolfId) || typeof value.proof !== 'string' || value.proof.length === 0
    || !Array.isArray(value.afterHoles) || ![7, 16].includes(value.afterHoles.length)
    || !value.afterHoles.every((number: unknown) => integer(number) && number >= 1 && number <= 18)
    || new Set(value.afterHoles).size !== value.afterHoles.length || !Array.isArray(value.totals)
    || value.totals.length !== 4) return false;
  const ids = new Set<string>();
  for (const total of value.totals) {
    if (!isRecord(total) || !keys(total, ['playerId', 'dots']) || !isUuid(total.playerId)
      || !nonnegative(total.dots) || ids.has(total.playerId)) return false;
    ids.add(total.playerId);
  }
  return ids.has(value.wolfId);
}

export function wolfRecordMatchesGame(
  game: WolfGameDefinition, round: WolfRoundInput, cards: readonly Scorecard[], record: WolfHoleRecord,
): boolean {
  if (!isWolfRecord(record) || record.choice.gameId !== game.id || !wolfGroupMatchesRound(game, round)
    || !round.layout.some((hole) => hole.number === record.number)
    || record.choice.mode === 'pig' && !game.allowPig) return false;
  if (game.version === 1 && record.comeback !== undefined
    || game.version === 2 && record.outcome !== undefined && record.outcome !== 'scores') return false;
  let wolfId = wolfForHole(game, round, record.number);
  if (game.version === 2) {
    const anchor = round.groups.find((group) => group.number === game.groupNumber)?.playerIds[0];
    const saved = cards.find((card) => card.playerId === anchor)?.holes
      .flatMap((hole) => hole.score.wolf?.filter((entry) => entry.choice.gameId === game.id) ?? []) ?? [];
    const before = calculateWolf(game, round, cards, saved);
    const candidate = before.comeback?.receipt;
    if (record.comeback !== undefined && (!candidate || candidate.afterHoles.includes(record.number)
      || !sameJsonValue(candidate, record.comeback))) return false;
    const after = calculateWolf(game, round, cards, [...saved.filter((entry) => entry.number !== record.number), record]);
    const hole = after.holes.find((entry) => entry.number === record.number);
    wolfId = hole?.wolfId ?? null;
    if (hole?.reason === 'invalid-wolf-choice') return false;
    // The first final-hole declaration must freeze the shared selection.
    if (candidate?.afterHoles.includes(record.number) === false
      && before.comeback?.status !== 'saved' && record.comeback === undefined) return false;
    if (!candidate && record.comeback !== undefined) return false;
  }
  return wolfId !== null && (record.choice.mode !== 'partner'
    || record.choice.partnerId !== wolfId && game.playerIds.includes(record.choice.partnerId));
}

export function isWolfResults(value: unknown, game: WolfGameDefinition, context?: {
  readonly round: WolfRoundInput; readonly cards: readonly Scorecard[]; readonly records: readonly WolfHoleRecord[];
}): value is WolfResults {
  if (game.version === 2) return context !== undefined
    && sameJsonValue(value, calculateWolf(game, context.round, context.cards, context.records));
  if (!isRecord(value) || !keys(value, ['status', 'holes', 'players'], ['reason'])
    || typeof value.status !== 'string' || !['complete', 'in-progress', 'unavailable'].includes(value.status)
    || value.reason !== undefined && (value.status !== 'unavailable' || typeof value.reason !== 'string' || !reasons.includes(value.reason))
    || !Array.isArray(value.holes) || ![0, 9, 18].includes(value.holes.length) || !Array.isArray(value.players)) return false;
  const holes: unknown[] = value.holes, players: unknown[] = value.players;
  for (const hole of holes) {
    if (!isRecord(hole) || !keys(hole, ['number', 'wolfId', 'mode', 'wolfSide', 'opponents', 'status', 'source',
      'winner', 'wolfScore', 'opponentScore', 'stake', 'transfers'], ['reason', 'recordedLate'])
      || hole.recordedLate !== undefined && hole.recordedLate !== true
      || !integer(hole.number) || hole.number < 1 || hole.number > 18
      || hole.wolfId !== null && (!isUuid(hole.wolfId) || !game.playerIds.includes(hole.wolfId))
      || typeof hole.status !== 'string' || !['pending', 'unavailable', 'tied', 'won'].includes(hole.status)
      || typeof hole.source !== 'string' || !['scores', 'explicit'].includes(hole.source)
      || hole.reason !== undefined && (hole.status !== 'unavailable' || typeof hole.reason !== 'string' || !reasons.includes(hole.reason))
      || !nullable(hole.wolfScore) || !nullable(hole.opponentScore)
      || !Array.isArray(hole.wolfSide) || !Array.isArray(hole.opponents) || !Array.isArray(hole.transfers)) return false;
    if (hole.mode === null) {
      if (hole.stake !== null || hole.wolfSide.length || hole.opponents.length || hole.transfers.length
        || hole.winner !== null || hole.wolfScore !== null || hole.opponentScore !== null
        || hole.source !== 'scores' || hole.status !== 'pending' && hole.status !== 'unavailable') return false;
      continue;
    }
    if (typeof hole.mode !== 'string' || !['partner', 'blind', 'pig'].includes(hole.mode) || hole.mode === 'pig' && !game.allowPig
      || hole.wolfSide.length !== (hole.mode === 'partner' ? 2 : 1)
      || hole.opponents.length !== (hole.mode === 'partner' ? 2 : 3)
      || hole.wolfSide[0] !== hole.wolfId || hole.stake !== (hole.mode === 'pig' ? 3 : hole.mode === 'blind' ? 2 : 1)) return false;
    const side: unknown[] = hole.wolfSide, opponents: unknown[] = hole.opponents;
    if (![...side, ...opponents].every((id) => isUuid(id) && game.playerIds.includes(id))
      || new Set([...side, ...opponents]).size !== 4) return false;
    if (hole.status === 'won' || hole.status === 'tied') {
      if (hole.status === 'tied' ? hole.winner !== null : hole.winner !== 'wolf' && hole.winner !== 'opponents') return false;
      const a = side.filter((id): id is string => typeof id === 'string');
      const b = opponents.filter((id): id is string => typeof id === 'string');
      const winner = hole.winner === 'wolf' ? 'wolf' : hole.winner === 'opponents' ? 'opponents' : null;
      const stake = hole.mode === 'pig' ? 3 : hole.mode === 'blind' ? 2 : 1;
      if (!sameJsonValue(hole.transfers, wolfTransfers(a, b, stake, winner))) return false;
      if (hole.source === 'scores' && (!integer(hole.wolfScore) || !integer(hole.opponentScore)
        || winner !== (hole.wolfScore === hole.opponentScore ? null : hole.wolfScore < hole.opponentScore ? 'wolf' : 'opponents'))) return false;
      if (hole.source === 'explicit' && (hole.wolfScore !== null || hole.opponentScore !== null)) return false;
    } else if (hole.transfers.length || hole.winner !== null || hole.wolfScore !== null || hole.opponentScore !== null) return false;
  }
  if (new Set(holes.map((hole) => isRecord(hole) ? hole.number : undefined)).size !== holes.length) return false;
  if (value.reason === 'invalid-wolf-group') {
    if (value.status !== 'unavailable' || players.length || holes.some((hole) => !isRecord(hole)
      || hole.status !== 'unavailable' || hole.reason !== 'invalid-wolf-group' || hole.wolfId !== null)) return false;
  } else {
    if (players.length !== 4 || !holes.length) return false;
    const unavailable = holes.some((hole) => isRecord(hole) && hole.status === 'unavailable');
    const complete = holes.every((hole) => isRecord(hole) && (hole.status === 'won' || hole.status === 'tied'));
    if (value.status !== (unavailable ? 'unavailable' : complete ? 'complete' : 'in-progress')) return false;
    for (const [index, player] of players.entries()) {
      if (!isRecord(player) || !keys(player, ['playerId', 'displayName', 'playingHandicap', 'holesScored', 'totalHoles',
        'status', 'dotsWon', 'dotsLost', 'balance']) || player.playerId !== game.playerIds[index]
        || !boundedText(player.displayName) || player.playingHandicap !== null && !nonnegative(player.playingHandicap)
        || game.basis === 'gross' && player.playingHandicap !== null
        || player.totalHoles !== holes.length || player.status !== value.status) return false;
      const entries = holes.flatMap((hole) => isRecord(hole) && Array.isArray(hole.transfers)
        ? hole.transfers.filter((entry: unknown): entry is Record<string, unknown> => isRecord(entry) && entry.playerId === player.playerId) : []);
      if (!entries.every((entry) => integer(entry.dots))) return false;
      const won = entries.length ? entries.reduce((sum, entry) => sum + (typeof entry.dots === 'number' ? Math.max(0, entry.dots) : 0), 0) : null;
      const lost = entries.length ? entries.reduce((sum, entry) => sum + (typeof entry.dots === 'number' ? Math.max(0, -entry.dots) : 0), 0) : null;
      if (player.holesScored !== entries.length || player.dotsWon !== won || player.dotsLost !== lost
        || player.balance !== (won === null || lost === null ? null : won - lost)) return false;
    }
  }
  return context === undefined || sameJsonValue(value, calculateWolf(game, context.round, context.cards, context.records));
}
