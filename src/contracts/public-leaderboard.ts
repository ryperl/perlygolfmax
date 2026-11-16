import type { EventStandingPlayer, EventStandingReason } from '../domain/event-leaderboard.js';
import type { PublicLeaderboardSummary } from '../domain/public-leaderboard.js';
import { boundedText } from './catalog.js';
import { isRecord, isUuid } from './events.js';
import { isOverallCompetition } from './setup.js';

function keys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}
const whole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const signed = (value: unknown): value is number | null => value === null || typeof value === 'number' && Number.isSafeInteger(value);
const unique = (values: readonly string[]) => new Set(values.map((value) => value.toLowerCase())).size === values.length;
const reasons: Readonly<Record<EventStandingReason, true>> = {
  'missing-handicap-index': true, 'invalid-handicap-index': true, 'missing-tee-ratings': true,
  'missing-stroke-index': true, 'missing-score-data': true, 'not-configured': true, 'missing-game': true,
  'missing-round': true, 'team-setup-required': true, 'invalid-stroke-score': true, 'arithmetic-range': true,
  'round-context-mismatch': true, 'stale-round-binding': true,
};
function cell(value: unknown): boolean {
  return isRecord(value) && typeof value.status === 'string'
    && ['complete', 'in-progress', 'awaiting-scores', 'not-configured', 'unavailable'].includes(value.status)
    && whole(value.holesScored) && whole(value.totalHoles) && value.holesScored <= value.totalHoles
    && signed(value.subtotal) && signed(value.relativeToPar)
    && (value.reason === undefined || typeof value.reason === 'string' && Object.hasOwn(reasons, value.reason));
}
function player(value: unknown): value is EventStandingPlayer {
  return isRecord(value) && keys(value,
    ['playerId', 'displayName', 'status', 'holesScored', 'totalHoles', 'subtotal', 'relativeToPar', 'rank', 'rankLabel', 'cells'], ['reason'])
    && cell(value) && isUuid(value.playerId) && boundedText(value.displayName)
    && (value.rank === null ? value.rankLabel === null
      : whole(value.rank) && value.rank > 0 && (value.rankLabel === String(value.rank) || value.rankLabel === `T${String(value.rank)}`)
        && (value.status === 'complete' || value.status === 'in-progress'))
    && Array.isArray(value.cells) && value.cells.every((entry: unknown) =>
      isRecord(entry) && keys(entry, ['roundId', 'status', 'holesScored', 'totalHoles', 'subtotal', 'relativeToPar'], ['reason'])
      && isUuid(entry.roundId) && cell(entry));
}
function namedRound(value: unknown): value is { readonly id: string; readonly name: string } {
  return isRecord(value) && keys(value, ['id', 'name']) && isUuid(value.id) && boundedText(value.name);
}
function namedPlayer(value: unknown): value is { readonly playerId: string; readonly displayName: string } {
  return isRecord(value) && keys(value, ['playerId', 'displayName']) && isUuid(value.playerId) && boundedText(value.displayName);
}
function standingRound(value: unknown): value is { readonly roundId: string; readonly roundName: string } {
  return isRecord(value) && keys(value, ['roundId', 'roundName']) && isUuid(value.roundId) && boundedText(value.roundName);
}

export function isPublicLeaderboardSummary(value: unknown): value is PublicLeaderboardSummary {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.workspace) || !isRecord(value.workspace.event)) return false;
  const workspace = value.workspace;
  const event = workspace.event;
  if (!isRecord(event) || !keys(event, ['id', 'name', 'status', 'role']) || !isUuid(event.id) || !boundedText(event.name)
    || event.role !== 'viewer' || event.status !== 'active') return false;
  if (value.kind === 'overall') {
    if (!keys(value, ['version', 'kind', 'workspace', 'standings']) || !keys(workspace, ['event'], ['overallCompetition'])
      || !isRecord(value.standings)) return false;
    const competition = workspace.overallCompetition;
    if (competition !== undefined && (!isRecord(competition) || (competition.kind === 'stableford'
      ? !keys(competition, ['kind', 'credit']) || competition.credit !== 'individual' && competition.credit !== 'team'
      : !isOverallCompetition(competition)))) return false;
    const standings = value.standings;
    if (!keys(standings, ['status', 'rounds', 'players', 'staleRoundIds'])
      || typeof standings.status !== 'string' || !['disabled', 'complete', 'provisional', 'unavailable'].includes(standings.status)
      || !Array.isArray(standings.rounds) || !standings.rounds.every(standingRound)
      || !Array.isArray(standings.players) || !standings.players.every(player)
      || !Array.isArray(standings.staleRoundIds) || !standings.staleRoundIds.every(isUuid)) return false;
    const rounds = standings.rounds;
    const players = standings.players;
    return unique(rounds.map((round) => round.roundId)) && unique(players.map((entry) => entry.playerId))
      && unique(standings.staleRoundIds)
      && (competition === undefined ? standings.status === 'disabled' : standings.status !== 'disabled')
      && (standings.status !== 'disabled' || rounds.length === 0 && players.length === 0 && standings.staleRoundIds.length === 0)
      && players.every((entry) => entry.cells.length === rounds.length && unique(entry.cells.map((item) => item.roundId))
        && entry.cells.every((item) => rounds.some((round) => round.roundId === item.roundId))
        && (entry.rank === null || entry.rank <= players.length));
  }
  if (value.kind !== 'event-skins' || !keys(value, ['version', 'kind', 'workspace'], ['eventSkins'])
    || !keys(workspace, ['event', 'rounds', 'roster'], ['eventSkinsSupported', 'eventSkins', 'purseConfigured'])
    || workspace.eventSkinsSupported !== undefined && workspace.eventSkinsSupported !== true
    || workspace.purseConfigured !== undefined && typeof workspace.purseConfigured !== 'boolean'
    || workspace.eventSkins !== undefined && (!isRecord(workspace.eventSkins)
      || !keys(workspace.eventSkins, ['version']) || workspace.eventSkins.version !== 1)
    || !Array.isArray(workspace.rounds) || !workspace.rounds.every(namedRound)
    || !Array.isArray(workspace.roster) || !workspace.roster.every(namedPlayer)) return false;
  const rounds = workspace.rounds;
  const roster = workspace.roster;
  if (!unique(rounds.map((round) => round.id)) || !unique(roster.map((entry) => entry.playerId))) return false;
  const skins = value.eventSkins;
  if (skins === undefined) return workspace.eventSkins === undefined;
  if (!isRecord(skins) || !keys(skins, ['status', 'awardedSkins', 'pendingHoles', 'unavailableHoles', 'totalHoles', 'players', 'holes'])
    || typeof skins.status !== 'string' || !['complete', 'provisional', 'unavailable'].includes(skins.status)
    || !whole(skins.awardedSkins) || !whole(skins.pendingHoles) || !whole(skins.unavailableHoles) || !whole(skins.totalHoles)
    || !Array.isArray(skins.holes) || !Array.isArray(skins.players)
    || skins.holes.length !== skins.totalHoles || skins.pendingHoles + skins.unavailableHoles > skins.totalHoles) return false;
  const holes: { readonly roundId: string; readonly number: number; readonly status: string; readonly winnerId: string | null }[] = [];
  for (const hole of skins.holes) {
    if (!isRecord(hole) || !keys(hole, ['roundId', 'number', 'status', 'winnerId', 'grossUnderParPriority'], ['reason'])
      || !isUuid(hole.roundId) || !rounds.some((round) => round.id === hole.roundId)
      || !whole(hole.number) || hole.number < 1 || hole.number > 18 || typeof hole.status !== 'string'
      || !['pending', 'unavailable', 'tied', 'awarded', 'ineligible'].includes(hole.status)
      || typeof hole.grossUnderParPriority !== 'boolean'
      || hole.reason !== undefined && !['round-context-mismatch', 'missing-score-data', 'missing-net-inputs', 'arithmetic-range'].some((reason) => reason === hole.reason)
      || (hole.status === 'awarded' ? !isUuid(hole.winnerId) || !roster.some((entry) => entry.playerId === hole.winnerId) : hole.winnerId !== null)) return false;
    const winnerId = hole.winnerId;
    if (winnerId !== null && !isUuid(winnerId)) return false;
    holes.push({ roundId: hole.roundId, number: hole.number, status: hole.status, winnerId });
  }
  if (!unique(holes.map((hole) => `${hole.roundId}:${String(hole.number)}`))
    || holes.filter((hole) => hole.status === 'awarded').length !== skins.awardedSkins
    || holes.filter((hole) => hole.status === 'pending').length !== skins.pendingHoles
    || holes.filter((hole) => hole.status === 'unavailable').length !== skins.unavailableHoles) return false;
  const ids: string[] = [];
  for (const entry of skins.players) {
    if (!isRecord(entry) || !keys(entry, ['playerId', 'displayName', 'skins', 'rank', 'cells'])
      || !isUuid(entry.playerId) || !boundedText(entry.displayName)
      || !roster.some((item) => item.playerId === entry.playerId && item.displayName === entry.displayName)
      || !whole(entry.skins) || entry.skins !== holes.filter((hole) => hole.winnerId === entry.playerId).length
      || (entry.skins === 0 ? entry.rank !== null : !whole(entry.rank) || entry.rank < 1 || entry.rank > roster.length)
      || !Array.isArray(entry.cells) || entry.cells.length !== rounds.length) return false;
    const cellIds: string[] = [];
    for (const item of entry.cells) {
      if (!isRecord(item) || !keys(item, ['roundId', 'skins', 'decidedHoles', 'totalHoles', 'status'])
        || !isUuid(item.roundId) || !rounds.some((round) => round.id === item.roundId)
        || !whole(item.skins) || !whole(item.decidedHoles) || !whole(item.totalHoles) || item.decidedHoles > item.totalHoles
        || !['complete', 'provisional', 'unavailable'].some((status) => status === item.status)) return false;
      cellIds.push(item.roundId);
    }
    if (!unique(cellIds)) return false;
    ids.push(entry.playerId);
  }
  return ids.length === roster.length && unique(ids);
}
