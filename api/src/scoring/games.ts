import type { TableClient } from '@azure/data-tables';
import type { GameConfiguration, RoundGameDefinition } from '../../../src/domain/games.js';
import { maximumPrivateWriteBytes } from '../../../src/contracts/private-values.js';
import { isGameConfiguration } from '../../../src/contracts/games.js';
import { isRecord, isUuid } from '../../../src/contracts/events.js';
import { decode, optionalRow, revision } from '../catalog/entities.js';
import { ApiError } from '../errors.js';
import { privateContent } from '../private-values.js';

type StoredGames = Omit<GameConfiguration, 'etag'>;

function isStoredGames(value: unknown): value is StoredGames {
  return isRecord(value) && !('etag' in value) && isGameConfiguration({ ...value, etag: 'validation-only' });
}

export function gameConfigurationKey(roundId: string): string {
  return `round-games:${roundId}`;
}

export function gameChangeKey(roundId: string, requestId: string): string {
  return `game-change:${roundId}:${requestId}`;
}

export function configuredGameRounds(value: unknown): readonly string[] {
  if (value === undefined) return [];
  if (typeof value !== 'string') throw new ApiError(503, 'INVALID_STORED_GAMES');
  let ids: unknown;
  try { ids = JSON.parse(value); } catch { throw new ApiError(503, 'INVALID_STORED_GAMES'); }
  if (!Array.isArray(ids) || ids.length > 8 || !ids.every(isUuid) || new Set(ids).size !== ids.length) {
    throw new ApiError(503, 'INVALID_STORED_GAMES');
  }
  return ids;
}

export async function readGameConfiguration(table: TableClient, eventId: string, roundId: string,
  configuredRounds: readonly string[]): Promise<GameConfiguration | undefined> {
  const row = await optionalRow(table, eventId, gameConfigurationKey(roundId));
  if (!row) {
    if (configuredRounds.includes(roundId)) throw new ApiError(503, 'INVALID_STORED_GAMES');
    const prefix = `game-change:${roundId}`;
    const evidence = await table.listEntities({
      queryOptions: { filter: `PartitionKey eq '${eventId}' and RowKey ge '${prefix}:' and RowKey lt '${prefix};'` },
    }).byPage({ maxPageSize: 1 }).next();
    if (!evidence.done && (evidence.value.length > 0 || evidence.value.continuationToken)) {
      throw new ApiError(503, 'INVALID_STORED_GAMES');
    }
    return undefined;
  }
  if (!configuredRounds.includes(roundId) || row.kind !== 'round-games' || row.schemaVersion !== 1) {
    throw new ApiError(503, 'INVALID_STORED_GAMES');
  }
  const stored = decode(await privateContent(table, eventId, gameConfigurationKey(roundId), row.content), isStoredGames);
  if (stored.eventId !== eventId || stored.roundId !== roundId
    || Buffer.byteLength(JSON.stringify({ games: stored.games }), 'utf8') > maximumPrivateWriteBytes) {
    throw new ApiError(503, 'INVALID_STORED_GAMES');
  }
  return { eventId, roundId, games: stored.games, etag: revision(row) };
}

export function gameConfigurationContent(eventId: string, roundId: string, games: readonly RoundGameDefinition[]): StoredGames {
  return { eventId, roundId, games };
}
