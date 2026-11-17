import type { DotAwardAudit } from '../../../src/domain/dot-audit.js';
import type { RoundGameDefinition } from '../../../src/domain/games.js';
import type { RoundSnapshot } from '../../../src/domain/setup.js';
import type { Scorecard } from '../../../src/domain/scoring.js';
import { calculateGameResults } from '../../../src/domain/stableford.js';
import { canonical } from '../catalog/entities.js';
import type { TableClient } from '@azure/data-tables';
import type { StoredScoringLock } from './lock.js';
import { decode, optionalRow, revision } from '../catalog/entities.js';
import { isScorecard } from '../../../src/contracts/scoring.js';
import { isRecord } from '../../../src/contracts/events.js';
import { privateContent } from '../private-values.js';
import { ApiError } from '../errors.js';

export async function correctionAuditCards(
  table: TableClient, eventId: string, round: RoundSnapshot, lock: StoredScoringLock,
): Promise<readonly Scorecard[]> {
  if (lock.writtenPlayerIds.some((id) => !round.players.some((player) => player.playerId === id))) {
    throw new ApiError(503, 'INVALID_STORED_SCORECARD');
  }
  const cards: Scorecard[] = [];
  for (let index = 0; index < round.players.length; index += 16) {
    cards.push(...await Promise.all(round.players.slice(index, index + 16).map(async (player): Promise<Scorecard> => {
      if (!lock.writtenPlayerIds.includes(player.playerId)) return { playerId: player.playerId,
        displayName: player.displayName, etag: null, updatedAt: null,
        holes: round.teeProfile.holes.map((hole) => ({ number: hole.number, score: { kind: 'unplayed' } })) };
      const key = `score-card:${round.id}:${player.playerId}`;
      const row = await optionalRow(table, eventId, key);
      if (!row) throw new ApiError(503, 'INVALID_STORED_SCORECARD');
      const stored = decode(await privateContent(table, eventId, key, row.content), isRecord);
      const value = { ...stored, etag: revision(row) };
      if (Object.hasOwn(stored, 'etag') || !isScorecard(value) || value.playerId !== player.playerId
        || value.displayName !== player.displayName
        || value.holes.length !== round.teeProfile.holes.length
        || !round.teeProfile.holes.every((hole) => value.holes.some((entry) => entry.number === hole.number))) {
        throw new ApiError(503, 'INVALID_STORED_SCORECARD');
      }
      return value;
    })));
  }
  return cards;
}

export function buildDotAwardAudit(
  games: readonly RoundGameDefinition[], beforeRound: RoundSnapshot, afterRound: RoundSnapshot,
  beforeCards: readonly Scorecard[], afterCards: readonly Scorecard[], gameEtag: string | null,
): readonly DotAwardAudit[] {
  if (!games.some((game) => game.kind === 'dots' || game.kind === 'wolf' && game.version === 2)) return [];
  const before = calculateGameResults(games, beforeRound, beforeCards);
  const after = calculateGameResults(games, afterRound, afterCards);
  return games.flatMap((game): readonly DotAwardAudit[] => {
    if (game.kind !== 'dots' && !(game.kind === 'wolf' && game.version === 2)) return [];
    const previous = before.find((result) => result.gameId === game.id);
    const next = after.find((result) => result.gameId === game.id);
    const previousAwards = previous?.dots?.awards ?? previous?.wolf?.awards ?? [];
    const nextAwards = next?.dots?.awards ?? next?.wolf?.awards ?? [];
    if (canonical(previousAwards) === canonical(nextAwards)) return [];
    return [{ gameId: game.id, kind: game.kind, version: game.version, configuration: game, gameEtag,
      inputRevision: afterRound.inputRevision ?? null, before: previousAwards, after: nextAwards }];
  });
}
