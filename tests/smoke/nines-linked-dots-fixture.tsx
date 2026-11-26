import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { RoundGamesPanel } from '../../src/features/games';
import { RoundLeaderboard } from '../../src/features/leaderboard';
import { strokeGameCards, strokeGameFixture, strokeGameId, strokeGamesRound } from '../../src/domain/stroke-games.test-support';
import { calculateGameResults } from '../../src/domain/stableford';
import { calculateInternalSettlements } from '../../src/domain/internal-games';
import { roundGameKinds } from '../../src/domain/games';
import type { RoundGameDefinition } from '../../src/domain/games';
import type { NinesGameDefinition } from '../../src/domain/nines';
import type { HoleScore, RoundScores, Scorecard } from '../../src/domain/scoring';
import '../../src/app/styles.css';
import '../../src/features/scoring/scoring.css';

const root = document.getElementById('nines-linked-dots-fixture');
if (!root) throw new Error('Missing fictional Nines + Dots fixture root.');

// Seven golfers: group 1 is a foursome shooting 4s; group 2 is the Nines threesome. In group 2,
// golfer 5 shoots 3s, golfer 6 4s, golfer 7 5s, except golfer 5 picks up on hole 5.
const fixture = strokeGameFixture(18, 7);
const foursome = Array.from({ length: 4 }, () => ({ kind: 'strokes' as const, strokes: 4 }));
let scoredCards: readonly Scorecard[] = fixture.cards;
for (const hole of fixture.snapshot.teeProfile.holes) {
  const first = hole.number === 5 ? { kind: 'picked-up' as const } : { kind: 'strokes' as const, strokes: 3 };
  scoredCards = strokeGameCards(scoredCards, hole.number,
    [...foursome, first, { kind: 'strokes', strokes: 4 }, { kind: 'strokes', strokes: 5 }]);
}
const [, , , , golfer5 = '', golfer6 = '', golfer7 = ''] = fixture.cards.map((card) => card.playerId);

// The Nines game is already saved at $0.25 a point; the test links a new Dots game to it.
const nines: NinesGameDefinition = { id: strokeGameId(1500), name: 'Nines', kind: 'nines', version: 1, basis: 'gross',
  groupNumber: 2, playerIds: [golfer5, golfer6, golfer7], stakeMinor: 25 };

/**
 * Golfer 6 made one Sandy on hole 1, as score entry records it on the group's first card. The Dots game
 * gets its ID when the form saves it, so the declaration is attached to whichever linked Dots game exists.
 */
function withSandy(cards: readonly Scorecard[], games: readonly RoundGameDefinition[]): readonly Scorecard[] {
  const dots = games.find((game) => game.kind === 'dots');
  if (!dots) return cards;
  const record = { number: 1, gameId: dots.id, gameEtag: 'fictional-games-v2',
    players: [{ playerId: golfer6, counts: { sandy: 1 }, calls: [] }], contests: [] };
  return cards.map((card) => card.playerId !== golfer5 ? card : { ...card, holes: card.holes.map((hole) =>
    hole.number !== 1 ? hole : { ...hole, score: { ...hole.score, dots: [record] } as HoleScore }) });
}

function withGames(round: RoundScores, games: readonly RoundGameDefinition[], etag: string): RoundScores {
  const cards = withSandy(scoredCards, games);
  const next: RoundScores = { ...round, cards, games: {
    configuration: { eventId: round.eventId, roundId: round.roundId, etag, games },
    results: calculateGameResults(games, fixture.snapshot, cards),
  } };
  return { ...next, internalSettlements: calculateInternalSettlements(games, next.games?.results ?? [], next) };
}

const base = strokeGamesRound({ ...fixture, cards: scoredCards });
// Setup is still open, and this app version can link Dots to Nines and play Dots in a group of three.
const initial = withGames({ ...base, setupLocked: false, supportedGameKinds: roundGameKinds, gameHandicapRules: 1,
  ninesLinkedDots: true, dotsIndividualPlayerCounts: [1, 2, 3, 4] }, [nines], 'fictional-games-v1');

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
