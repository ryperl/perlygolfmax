import type { EventLeaderboardView } from './event-leaderboard.js';
import { calculateEventStandings } from './event-leaderboard.js';
import { calculateEventSkins } from './event-skins.js';
import { eventSkinsFixture, publicEventSkinsFixture } from './event-skins.test-support.js';

export function publicLeaderboardFixture(count = 12, roundCount = 5): EventLeaderboardView {
  const f = publicEventSkinsFixture(eventSkinsFixture(
    Array.from({ length: count }, (_, index) => ({ kind: 'strokes', strokes: 3 + index })),
    Array.from({ length: count }, () => '0'), roundCount,
  ));
  const workspace = { ...f.workspace, overallCompetition: { kind: 'stroke-play' as const, basis: 'gross' as const } };
  const roundScores = f.rounds.map((round) => ({ ...round,
    cards: round.cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: { kind: 'strokes' as const, strokes: 3 + index },
    })) })),
  }));
  return { workspace, roundScores, standings: calculateEventStandings(workspace, roundScores),
    eventSkins: calculateEventSkins(workspace, roundScores) };
}
