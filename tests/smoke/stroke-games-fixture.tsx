import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { RoundGamesPanel } from '../../src/features/games';
import { RoundLeaderboard } from '../../src/features/leaderboard';
import { SavedScorecards } from '../../src/features/scoring/SavedScorecards';
import { strokeGameCards, strokeGameFixture, strokeGameId, strokeGamesRound } from '../../src/domain/stroke-games.test-support';
import { calculateGameResults } from '../../src/domain/stableford';
import type { RoundScores } from '../../src/domain/scoring';
import '../../src/app/styles.css';
import '../../src/features/scoring/scoring.css';

const root = document.getElementById('stroke-games-fixture');
if (!root) throw new Error('Missing fictional stroke game fixture root.');
const fixture = strokeGameFixture(18);
const cards = strokeGameCards(fixture.cards, 3, [{ kind: 'strokes', strokes: 3 }]);
const saved = strokeGamesRound({ ...fixture, cards });

export function Fixture() {
  const [round, setRound] = useState<RoundScores>(saved);
  const [readonly, setReadonly] = useState(false);
  const displayed = readonly ? { ...round, permissions: {
    role: 'public' as const, writePlayerIds: round.cards.map((card) => card.playerId), canManageGames: false,
  } } : round;
  function pending(value: boolean) {
    const nextCards = value ? strokeGameCards(cards, 1, [{ kind: 'unplayed' }]) : cards;
    setRound((previous) => {
      if (!previous.games) throw new Error('Missing fictional games');
      return { ...previous, cards: nextCards, games: {
        ...previous.games, results: calculateGameResults(previous.games.configuration.games, fixture.snapshot, nextCards),
      } };
    });
  }
  return <div className="app"><main><section className="owner-scores">
    <nav aria-label="Fictional server controls">
      <button type="button" onClick={() => { pending(true); }}>Earlier saved hole pending</button>
      <button type="button" onClick={() => { pending(false); }}>Resolve earlier saved hole</button>
      <button type="button" onClick={() => { setReadonly((value) => !value); }}>Toggle public results</button>
    </nav>
    <RoundGamesPanel round={displayed} busy={false} onDirtyChange={() => undefined} onRefresh={() => Promise.resolve(displayed)}
      onSave={(games, expectedEtag, requestId) => {
        const next: RoundScores = { ...round, games: {
          configuration: { eventId: round.eventId, roundId: round.roundId, etag: 'fictional-games-v2', games },
          results: calculateGameResults(games, fixture.snapshot, round.cards),
        } };
        setRound(next);
        return Promise.resolve({ round: next, change: {
          id: requestId, eventId: round.eventId, roundId: round.roundId, expectedEtag,
          before: round.games?.configuration.games ?? [], after: games, recordedAt: '2026-01-01T00:00:00Z',
          recordedBy: { tenantId: strokeGameId(501), objectId: strokeGameId(502) },
        } });
      }} />
    <RoundLeaderboard round={displayed} busy={false} onManageGames={() => undefined} />
    <SavedScorecards round={displayed} groupNumber={1} busy={false} onGroupChange={() => undefined} onEnterScores={() => undefined} />
  </section></main></div>;
}

createRoot(root).render(<Fixture />);
