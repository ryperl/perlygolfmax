import { createRoot } from 'react-dom/client';
import type { ScoresClient } from '../../src/client/scoring';
import type { RoundScores } from '../../src/domain/scoring';
import { OwnerScoresView } from '../../src/features/scoring';
import { fictionalGamesRound } from './games-fixture-data';
import '../../src/app/styles.css';

const root = document.getElementById('player-scores-fixture');
if (!root) throw new Error('Missing fictional player fixture root.');
const readonly = new URLSearchParams(window.location.search).has('readonly');
const own = fictionalGamesRound.cards.map((card) => card.playerId);
const other = fictionalGamesRound.cards.map((card, index) => ({
  ...card, playerId: `00000000-0000-4000-8000-${String(2000 + index).padStart(12, '0')}`,
  displayName: `Fictional visitor ${String(index + 1)}`,
}));
const round: RoundScores = {
  ...fictionalGamesRound, cards: [...other, ...fictionalGamesRound.cards],
  groups: [{ number: 1, playerIds: other.map((card) => card.playerId) }, { number: 2, playerIds: own }],
  permissions: readonly ? { role: 'viewer', writePlayerIds: [], canManageGames: false }
    : { role: 'player', ...(own[0] ? { viewerPlayerId: own[0] } : {}), writePlayerIds: own, canManageGames: false },
};
const unavailable = () => Promise.reject(new Error('Fictional layout fixture does not save.'));
const client: ScoresClient = {
  load: () => Promise.resolve(round), save: unavailable, saveGames: unavailable, history: unavailable,
};
createRoot(root).render(<div className="app"><main><OwnerScoresView client={client} eventId={round.eventId}
  roundId={round.roundId} onSessionExpired={() => undefined} /></main></div>);
