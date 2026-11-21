import { createRoot } from 'react-dom/client';
import type { ScoresClient } from '../../src/client/scoring';
import type { GameChange } from '../../src/domain/games';
import type { RoundScores } from '../../src/domain/scoring';
import { calculateGameResults } from '../../src/domain/stableford';
import { publishedCourseHandicaps } from '../../src/domain/playing-handicaps';
import { strokeGameFixture, strokeGameId } from '../../src/domain/stroke-games.test-support';
import { OwnerScoresView } from '../../src/features/scoring/OwnerScoresView';
import '../../src/app/styles.css';

const f = strokeGameFixture(18);
const snapshot = { ...f.snapshot, groups: f.snapshot.groups.map((group) => ({ ...group, startingHole: 10 })),
  players: f.snapshot.players.map((player, index) => ({ ...player,
    handicapIndex: { ...player.handicapIndex, value: ['11', '4', '8', '3'][index] ?? '0' } })) };
let round: RoundScores = {
  eventId: strokeGameId(900), eventName: 'Fictional handicap rules', eventStatus: 'active', roundId: snapshot.id,
  roundName: snapshot.name, courseName: snapshot.course.name, teeName: snapshot.teeProfile.name,
  teeCategory: snapshot.teeProfile.category, layout: snapshot.teeProfile.holes, groups: snapshot.groups,
  courseHandicaps: publishedCourseHandicaps(snapshot), teeStrokeAllocation: true, gameHandicapRules: 1,
  cards: f.cards.map((card) => ({ ...card, etag: null, updatedAt: null,
    holes: card.holes.map((hole) => ({ ...hole, score: { kind: 'unplayed' } })) })),
  setupLocked: false, lastUpdatedAt: null, supportedGameKinds: ['stableford', 'ball-drop', 'skins', 'stroke-play'],
  permissions: { role: 'owner', writePlayerIds: f.cards.map((card) => card.playerId), canManageGames: true },
};
let revision = 0;
const receipts = new Map<string, GameChange>();
const client: ScoresClient = {
  load: () => Promise.resolve(round),
  history: () => Promise.resolve({ changes: [] }),
  save: () => Promise.reject(new Error('This fictional fixture does not save strokes.')),
  saveGames: (eventId, roundId, games, etag, requestId) => {
    const saved = receipts.get(requestId);
    if (saved) return Promise.resolve({ round, change: saved });
    if (etag !== (round.games?.configuration.etag ?? null)) return Promise.reject(new Error('Fictional revision changed.'));
    const change: GameChange = { id: requestId, eventId, roundId, before: round.games?.configuration.games ?? [],
      after: games, expectedEtag: etag, recordedAt: '2026-01-01T00:00:00Z', recordedBy: { tenantId: strokeGameId(501), objectId: strokeGameId(502) } };
    round = { ...round, games: { configuration: { eventId, roundId, etag: `fictional-games-${String(++revision)}`, games },
      results: calculateGameResults(games, snapshot, round.cards) } };
    receipts.set(requestId, change);
    return Promise.resolve({ round, change });
  },
};
const root = document.getElementById('game-handicaps-fixture');
if (!root) throw new Error('Missing fictional game handicap fixture root.');
createRoot(root).render(<main className="app"><OwnerScoresView client={client} eventId={round.eventId} roundId={round.roundId}
  onSessionExpired={() => undefined} /></main>);
