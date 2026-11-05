import type { GamePlayerResult, GameTeamHoleResult, GameTeamResult, TeamGameDefinition } from './games.js';
import { teamCountingSize } from './games.js';

function total(holes: readonly GameTeamHoleResult[]): number | null {
  const scored = holes.filter((hole) => hole.points !== null);
  return scored.length ? scored.reduce((sum, hole) => sum + (hole.points ?? 0), 0) : null;
}

export function aggregateTeamGameResults(
  game: TeamGameDefinition, players: readonly GamePlayerResult[], holeNumbers: readonly number[],
): readonly GameTeamResult[] {
  return game.teams.map((team) => {
    const members = team.playerIds.map((id) => players.find((player) => player.playerId === id));
    const unavailableMember = members.find((member) => member?.status === 'unavailable');
    const reason = members.some((member) => member === undefined
      || holeNumbers.some((number) => !member.holes.some((hole) => hole.number === number)))
      ? 'missing-score-data' : unavailableMember ? unavailableMember.unavailableReason ?? 'missing-score-data' : undefined;
    const holes = holeNumbers.map((number) => {
      const points = members.map((member) => member?.holes.find((hole) => hole.number === number)?.points);
      return {
        number,
        points: reason !== undefined || points.some((point) => point == null) ? null
          : points.filter((point): point is number => point != null).sort((left, right) => right - left)
            .slice(0, teamCountingSize(game.format)).reduce((sum, point) => sum + point, 0),
      };
    });
    const holesScored = holes.filter((hole) => hole.points !== null).length;
    return {
      teamId: team.id, displayName: team.name, playerIds: [...team.playerIds],
      status: reason !== undefined ? 'unavailable' : holesScored === holes.length ? 'complete' : 'in-progress',
      ...(reason === undefined ? {} : { unavailableReason: reason }),
      holes, holesScored, totalHoles: holeNumbers.length,
      frontPoints: total(holes.filter((hole) => hole.number <= 9)),
      backPoints: total(holes.filter((hole) => hole.number > 9)), totalPoints: total(holes),
    };
  });
}
