import type { RoundScores } from '../../domain/scoring';
import { scorePermissions } from '../../domain/scoring';

export function writablePlayerIds(round: RoundScores): readonly string[] {
  const permissions = scorePermissions(round);
  if (round.eventStatus !== 'active') return [];
  if (permissions.role === 'owner') return round.cards.map((card) => card.playerId);
  if (permissions.role === 'tester') {
    const ids = round.cards.map((card) => card.playerId);
    return !permissions.canManageGames && permissions.viewerPlayerId === undefined
      && new Set(permissions.writePlayerIds).size === ids.length
      && permissions.writePlayerIds.length === ids.length
      && ids.every((id) => permissions.writePlayerIds.includes(id)) ? ids : [];
  }
  if (permissions.role !== 'player' || !permissions.viewerPlayerId) return [];
  const assigned = round.groups.find((group) => group.playerIds.includes(permissions.viewerPlayerId ?? ''));
  return assigned?.playerIds.filter((id) => permissions.writePlayerIds.includes(id)) ?? [];
}

export function scoreAccessKey(round: RoundScores): string {
  return JSON.stringify([scorePermissions(round), round.eventStatus, round.groups]);
}
