import type { EventSkinsDetails } from '../domain/event-skins-details.js';
import type { PublicLeaderboardSummary } from '../domain/public-leaderboard.js';
import { isEventSkinsDetails } from './event-skins-details.js';
import { isPublicLeaderboardSummary } from './public-leaderboard.js';
import { isRecord } from './events.js';

type Summary = Extract<PublicLeaderboardSummary, { readonly kind: 'event-skins' }>;
// Version-1 wire ordinals are stable; append new values instead of reordering.
const dispositions = ['strokes', 'unplayed', 'picked-up', 'did-not-finish', 'unavailable'] as const;
const outcomes = ['won', 'covered', 'beaten', 'pending', 'ineligible', 'unavailable'] as const;

/** Positional rows remove repeated keys/IDs; readers expand only after strict shape checks. */
export function compactSkinsSummary(value: Summary) {
  const skins = value.eventSkins;
  const roundIndex = new Map(value.workspace.rounds.map((round, index) => [round.id, index]));
  const playerIndex = new Map(value.workspace.roster.map((player, index) => [player.playerId, index]));
  return {
    version: 1, kind: 'event-skins-summary-compact', workspace: value.workspace,
    ...(value.reviewNotices ? { reviewNotices: value.reviewNotices } : {}),
    ...(skins ? { results: {
      status: skins.status, awardedSkins: skins.awardedSkins, pendingHoles: skins.pendingHoles,
      unavailableHoles: skins.unavailableHoles, totalHoles: skins.totalHoles,
      players: skins.players.map((player) => [
        playerIndex.get(player.playerId), player.skins, player.rank,
        player.cells.map((cell) => [roundIndex.get(cell.roundId), cell.skins, cell.decidedHoles, cell.totalHoles, cell.status]),
      ]),
      holes: skins.holes.map((hole) => [roundIndex.get(hole.roundId), hole.number, hole.status,
        hole.winnerId === null ? null : playerIndex.get(hole.winnerId), hole.grossUnderParPriority, hole.reason ?? null]),
    } } : {}),
  };
}

export function compactSkinsDetails(value: EventSkinsDetails) {
  const roundIndex = new Map(value.rounds.map((round, index) => [round.id, index]));
  const playerIndex = new Map(value.players.map((player, index) => [player.playerId, index]));
  return {
    version: 1, kind: 'event-skins-details-compact', eventId: value.eventId, eventName: value.eventName,
    status: value.status, rounds: value.rounds, players: value.players,
    holes: value.holes.map((hole) => [
      roundIndex.get(hole.roundId), hole.number, hole.status,
      hole.winnerId === null ? null : playerIndex.get(hole.winnerId),
      hole.contenderIds.map((id) => playerIndex.get(id)), hole.grossUnderParPriority, hole.reason ?? null,
      hole.players.map((player) => [playerIndex.get(player.playerId), dispositions.indexOf(player.disposition), player.par, player.gross,
        player.net, player.strokesReceived, outcomes.indexOf(player.outcome), player.reason ?? null]),
    ]),
  };
}

function keys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) {
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}
function rows(value: unknown, length: number): value is unknown[][] {
  return Array.isArray(value) && value.every((row: unknown) => Array.isArray(row) && row.length === length);
}
function reference(values: readonly unknown[], index: unknown): unknown {
  return typeof index === 'number' && Number.isSafeInteger(index) && index >= 0 ? values[index] : undefined;
}
function field(values: readonly unknown[], index: unknown, key: string): unknown {
  const entry = reference(values, index);
  return isRecord(entry) ? entry[key] : undefined;
}
function reason(value: unknown): object {
  return value === null ? {} : { reason: value };
}

export function expandSkinsSummary(value: unknown): Summary | null {
  if (!isRecord(value) || !keys(value, ['version', 'kind', 'workspace'], ['results', 'reviewNotices'])
    || value.version !== 1 || value.kind !== 'event-skins-summary-compact'
    || !isRecord(value.workspace) || !Array.isArray(value.workspace.rounds) || !Array.isArray(value.workspace.roster)) return null;
  const workspace = value.workspace;
  const rounds = workspace.rounds;
  const roster = workspace.roster;
  if (!Array.isArray(rounds) || !Array.isArray(roster)) return null;
  const skins = value.results;
  if (skins !== undefined && (!isRecord(skins) || !keys(skins,
    ['status', 'awardedSkins', 'pendingHoles', 'unavailableHoles', 'totalHoles', 'players', 'holes'])
    || !rows(skins.players, 4) || !rows(skins.holes, 6))) return null;
  if (isRecord(skins) && rows(skins.players, 4)
    && skins.players.some((player) => !rows(player[3], 5))) return null;
  const expanded = {
    version: 1, kind: 'event-skins', workspace,
    ...(Object.hasOwn(value, 'reviewNotices') ? { reviewNotices: value.reviewNotices } : {}),
    ...(isRecord(skins) && rows(skins.players, 4) && rows(skins.holes, 6) ? { eventSkins: {
      status: skins.status, awardedSkins: skins.awardedSkins, pendingHoles: skins.pendingHoles,
      unavailableHoles: skins.unavailableHoles, totalHoles: skins.totalHoles,
      players: skins.players.map((player) => ({
        playerId: field(roster, player[0], 'playerId'), displayName: field(roster, player[0], 'displayName'),
        skins: player[1], rank: player[2],
        cells: rows(player[3], 5) ? player[3].map((cell) => ({
          roundId: field(rounds, cell[0], 'id'), skins: cell[1], decidedHoles: cell[2], totalHoles: cell[3], status: cell[4],
        })) : [],
      })),
      holes: skins.holes.map((hole) => ({
        roundId: field(rounds, hole[0], 'id'), number: hole[1], status: hole[2],
        winnerId: hole[3] === null ? null : field(roster, hole[3], 'playerId'),
        grossUnderParPriority: hole[4], ...reason(hole[5]),
      })),
    } } : {}),
  };
  return isPublicLeaderboardSummary(expanded) && expanded.kind === 'event-skins' ? expanded : null;
}

export function expandSkinsDetails(value: unknown): EventSkinsDetails | null {
  if (!isRecord(value) || !keys(value, ['version', 'kind', 'eventId', 'eventName', 'status', 'rounds', 'players', 'holes'])
    || value.version !== 1 || value.kind !== 'event-skins-details-compact'
    || !Array.isArray(value.rounds) || !Array.isArray(value.players) || !rows(value.holes, 8)
    || value.holes.some((hole) => !Array.isArray(hole[4]) || !rows(hole[7], 8))) return null;
  const players = value.players;
  const rounds = value.rounds;
  const expanded = {
    version: 1, eventId: value.eventId, eventName: value.eventName, status: value.status, rounds, players,
    holes: value.holes.map((hole) => ({
      roundId: field(rounds, hole[0], 'id'), number: hole[1], status: hole[2],
      winnerId: hole[3] === null ? null : field(players, hole[3], 'playerId'),
      contenderIds: Array.isArray(hole[4]) ? hole[4].map((index: unknown) => field(players, index, 'playerId')) : [],
      grossUnderParPriority: hole[5], ...reason(hole[6]),
      players: rows(hole[7], 8) ? hole[7].map((player) => ({
        playerId: field(players, player[0], 'playerId'), disposition: reference(dispositions, player[1]), par: player[2], gross: player[3],
        net: player[4], strokesReceived: player[5], outcome: reference(outcomes, player[6]), ...reason(player[7]),
      })) : [],
    })),
  };
  return isEventSkinsDetails(expanded) ? expanded : null;
}
