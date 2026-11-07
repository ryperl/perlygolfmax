import type { OverallHandicaps, PlayerCourseHandicap } from './scoring.js';
import type { RoundSnapshot } from './setup.js';
import { calculateCourseHandicap, calculatePlayingHandicap } from './stableford.js';

export function publishedCourseHandicaps(round: RoundSnapshot): readonly PlayerCourseHandicap[] {
  const tees = new Map(round.playerTees?.map((entry) => [entry.playerId, entry.profile]));
  return round.players.map((player) => {
    const result = player.handicapIndex === undefined ? 'uncaptured-handicap-index'
      : player.handicapIndex === null ? 'missing-handicap-index'
      : calculateCourseHandicap(player.handicapIndex.value, tees.get(player.playerId) ?? round.teeProfile);
    return typeof result === 'number' ? { playerId: player.playerId, courseHandicap: result }
      : { playerId: player.playerId, courseHandicap: null, unavailableReason: result };
  });
}

/** Publishes calculated round values without copying private index observations or audit metadata. */
export function publishedPlayingHandicaps(round: RoundSnapshot, allowancePercent: number): OverallHandicaps {
  const tees = new Map(round.playerTees?.map((entry) => [entry.playerId, entry.profile]));
  return {
    allowancePercent,
    players: round.players.map((player) => {
      const result = player.handicapIndex == null ? 'missing-handicap-index'
        : calculatePlayingHandicap(player.handicapIndex.value, tees.get(player.playerId) ?? round.teeProfile, allowancePercent);
      return typeof result === 'number' ? { playerId: player.playerId, playingHandicap: result }
        : { playerId: player.playerId, playingHandicap: null, unavailableReason: result };
    }),
  };
}
