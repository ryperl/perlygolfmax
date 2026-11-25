import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { RoundGamesPanel } from '../../src/features/games';
import { RoundLeaderboard } from '../../src/features/leaderboard';
import { strokeGameCards, strokeGameFixture, strokeGameId, strokeGamesRound } from '../../src/domain/stroke-games.test-support';
import { calculateGameResults } from '../../src/domain/stableford';
import { calculateInternalSettlements } from '../../src/domain/internal-games';
import { roundGameKinds } from '../../src/domain/games';
import type { RoundGameDefinition } from '../../src/domain/games';
import type { RoundScores, Scorecard } from '../../src/domain/scoring';
import '../../src/app/styles.css';
import '../../src/features/scoring/scoring.css';

const root = document.getElementById('nines-fixture');
if (!root) throw new Error('Missing fictional Nines fixture root.');

// Three golfers: golfer 1 shoots 3s, golfer 2 4s, golfer 3 5s, except golfer 1 picks up on hole 5.
const fixture = strokeGameFixture(18, 3);
let cards: readonly Scorecard[] = fixture.cards;
for (const hole of fixture.snapshot.teeProfile.holes) {
  const first = hole.number === 5 ? { kind: 'picked-up' as const } : { kind: 'strokes' as const, strokes: 3 };
  cards = strokeGameCards(cards, hole.number, [first, { kind: 'strokes', strokes: 4 }, { kind: 'strokes', strokes: 5 }]);
}

function withGames(round: RoundScores, games: readonly RoundGameDefinition[], etag: string): RoundScores {
  const next: RoundScores = { ...round, games: {
    configuration: { eventId: round.eventId, roundId: round.roundId, etag, games },
    results: calculateGameResults(games, fixture.snapshot, round.cards),
  } };
  return { ...next, internalSettlements: calculateInternalSettlements(games, next.games?.results ?? [], next) };
}

const base = strokeGamesRound({ ...fixture, cards });
// Setup is still open (no lock), and this app version understands every game kind, including Nines.
const initial = withGames({ ...base, setupLocked: false, supportedGameKinds: roundGameKinds, gameHandicapRules: 1 }, [], 'fictional-games-v1');

export function Fixture() {
  const [round, setRound] = useState<RoundScores>(initial);
  return <div className="app"><main><section className="owner-scores">
    <RoundGamesPanel round={round} busy={false} onDirtyChange={() => undefined} onRefresh={() => Promise.resolve(round)}
      onSave={(games, expectedEtag, requestId) => {
        const next = withGames(round, games, 'fictional-games-v2');
        setRound(next);
        return Promise.resolve({ round: next, change: {
          id: requestId, eventId: round.eventId, roundId: round.roundId, expectedEtag,
          before: round.games?.configuration.games ?? [], after: games, recordedAt: '2026-01-01T00:00:00Z',
          recordedBy: { tenantId: strokeGameId(501), objectId: strokeGameId(502) },
        } });
      }} />
    <RoundLeaderboard round={round} busy={false} onManageGames={() => undefined} />
  </section></main></div>;
}

createRoot(root).render(<Fixture />);
