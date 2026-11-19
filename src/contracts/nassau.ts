import type { NassauGameDefinition, PressMatchGameDefinition, MatchPlayGameDefinition, NassauHandicapInputs, NassauHoleRecord, NassauManualPress, NassauResults, NassauRoundContext } from '../domain/nassau.js';
import { calculateNassauFromHandicaps, nassauConfigurationIssues, nassauMatchId } from '../domain/nassau.js';
import type { Scorecard } from '../domain/scoring.js';
import { boundedText } from './catalog.js';
import { isEventRevision, isRecord, isUuid } from './events.js';
import { sameJsonValue } from './round-context.js';

function keys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function identifier(value: unknown, max = 2048): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && /^[\x21-\x7e]+$/.test(value);
}

export function isNassauDefinition(value: unknown): value is NassauGameDefinition {
  return isPressMatchDefinition(value) && value.kind === 'nassau';
}

export function isMatchPlayDefinition(value: unknown): value is MatchPlayGameDefinition {
  return isPressMatchDefinition(value) && value.kind === 'match-play';
}

export function isPressMatchDefinition(value: unknown): value is PressMatchGameDefinition {
  if (!isRecord(value) || !keys(value, ['id', 'name', 'kind', 'version', 'basis', 'groupNumber', 'variant', 'sides', 'stakes', 'automaticPresses'])
    || !isUuid(value.id) || !boundedText(value.name) || value.kind !== 'nassau' && value.kind !== 'match-play' || value.version !== 1
    || (value.basis !== 'gross' && value.basis !== 'net') || !integer(value.groupNumber, 1)
    || typeof value.automaticPresses !== 'boolean' || !isRecord(value.stakes)
    || !keys(value.stakes, ['frontMinor', 'backMinor', 'overallMinor', 'currency']) || value.stakes.currency !== 'USD'
    || !integer(value.stakes.frontMinor, 0) || !integer(value.stakes.backMinor, 0) || !integer(value.stakes.overallMinor, 0)
    || value.kind === 'match-play' && (value.stakes.frontMinor !== 0 || value.stakes.backMinor !== 0)
    || !Array.isArray(value.sides)) return false;
  const sides: unknown[] = value.sides;
  const sizes: number[] = [];
  const players: string[] = [];
  const ids: string[] = [];
  for (const side of sides) {
    if (!isRecord(side) || !keys(side, ['id', 'name', 'playerIds']) || !isUuid(side.id) || !boundedText(side.name)
      || !Array.isArray(side.playerIds) || !side.playerIds.every(isUuid)) return false;
    ids.push(side.id);
    players.push(...side.playerIds);
    sizes.push(side.playerIds.length);
  }
  const expected = value.variant === 'singles' ? '1,1' : value.variant === 'three-way' ? '1,1,1'
    : value.variant === 'one-v-two' ? '1,2'
      : value.variant === 'two-v-two-best-ball' || value.variant === 'two-v-two-aggregate' ? '2,2' : '';
  return expected !== '' && sizes.sort((a, b) => a - b).join(',') === expected
    && new Set(ids).size === ids.length && new Set(players).size === players.length;
}

export function isNassauManualPress(value: unknown): value is NassauManualPress {
  return isRecord(value) && keys(value, ['id', 'parentBetId', 'matchId', 'startHole', 'declaredAfterHole', 'pressingSide', 'proof'])
    && isUuid(value.id) && identifier(value.parentBetId) && identifier(value.matchId, 256)
    && integer(value.startHole, 1, 18) && integer(value.declaredAfterHole, 1, 18)
    && typeof value.proof === 'string'
    && (value.proof.startsWith('nassau-v1:') ? value.startHole === value.declaredAfterHole + 1
      : value.proof.startsWith('match-play-v1:') && value.startHole !== value.declaredAfterHole)
    && (value.pressingSide === 'a' || value.pressingSide === 'b') && value.proof.length <= 8192
    && /^[\x20-\x7e]+$/.test(value.proof);
}

export function isNassauHoleRecord(value: unknown): value is NassauHoleRecord {
  return isRecord(value) && keys(value, ['number', 'gameId', 'gameEtag', 'outcomes', 'presses'])
    && integer(value.number, 1, 18) && isUuid(value.gameId) && isEventRevision(value.gameEtag)
    && Array.isArray(value.outcomes) && value.outcomes.every((outcome: unknown) =>
      isRecord(outcome) && keys(outcome, ['matchId', 'outcome']) && identifier(outcome.matchId, 256)
      && (outcome.outcome === 'scores' || outcome.outcome === 'side-a' || outcome.outcome === 'side-b' || outcome.outcome === 'halved'))
    && new Set(value.outcomes.map((entry: { readonly matchId: string }) => entry.matchId)).size === value.outcomes.length
    && Array.isArray(value.presses) && value.presses.every((press: unknown) => isNassauManualPress(press) && press.startHole === value.number)
    && new Set(value.presses.map((entry: { readonly id: string }) => entry.id)).size === value.presses.length;
}

export function nassauDefinitionMatchesRound(game: PressMatchGameDefinition, round: NassauRoundContext): boolean {
  return isPressMatchDefinition(game) && nassauConfigurationIssues(game, round).length === 0;
}

/** Structural/context validation only; proof/eligibility validation uses the domain helpers. */
export function nassauRecordsMatchGame(value: unknown, game: PressMatchGameDefinition): value is readonly NassauHoleRecord[] {
  if (!isPressMatchDefinition(game) || !Array.isArray(value) || !value.every(isNassauHoleRecord)) return false;
  const records: NassauHoleRecord[] = value;
  const matches = game.variant === 'three-way'
    ? [nassauMatchId(game.id, 0, 1), nassauMatchId(game.id, 0, 2), nassauMatchId(game.id, 1, 2)]
    : [nassauMatchId(game.id, 0, 1)];
  const presses = records.flatMap((record) => record.presses);
  return new Set(records.map((record) => record.number)).size === records.length
    && new Set(presses.map((press) => press.id)).size === presses.length
    && records.every((record) => record.gameId === game.id && record.outcomes.every((entry) => matches.includes(entry.matchId))
      && record.presses.every((press) => matches.includes(press.matchId)
        && press.proof.startsWith(game.kind === 'match-play' ? 'match-play-v1:' : 'nassau-v1:')));
}

/** Exact recomputation rejects client-authored money, outcomes, missing bets, and excess/private fields. */
export function isNassauResults(
  value: unknown, game: PressMatchGameDefinition, round: NassauRoundContext, cards: readonly Scorecard[],
  records: readonly NassauHoleRecord[], published: NassauHandicapInputs,
): value is NassauResults {
  return isPressMatchDefinition(game) && records.every(isNassauHoleRecord)
    && sameJsonValue(value, calculateNassauFromHandicaps(game, round, cards, records, published));
}
