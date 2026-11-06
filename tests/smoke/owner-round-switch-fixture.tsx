import { createRoot } from 'react-dom/client';
import { useSyncExternalStore } from 'react';
import type { SetupClient } from '../../src/client/setup';
import type { ScoresClient } from '../../src/client/scoring';
import type { EventWorkspace } from '../../src/domain/setup';
import { calculateGameResults } from '../../src/domain/stableford';
import { OwnerRoundScoresPage } from '../../src/app/OwnerRoundScoresPage';
import { fictionalCapturedRound, fictionalGamesRound } from './games-fixture-data';
import '../../src/app/styles.css';

const secondId = '00000000-0000-4000-8000-000000000079';
const workspace: EventWorkspace = {
  event: { id: fictionalGamesRound.eventId, name: fictionalGamesRound.eventName, role: 'owner', status: 'active',
    etag: 'fictional-event', createdAt: '2026-01-01' },
  location: 'Fictional location', roster: fictionalCapturedRound.players, etag: 'fictional-event',
  rounds: [
    { ...fictionalCapturedRound, id: fictionalGamesRound.roundId, name: 'Fictional opening round', startDate: '2026-01-02' },
    { ...fictionalCapturedRound, id: secondId, name: 'Fictional earlier round', startDate: '2026-01-01' },
  ],
};
const setup: SetupClient = {
  load: () => Promise.resolve(workspace),
  save: () => Promise.reject(new Error('Fictional fixture does not save setup.')),
  refreshIndices: () => Promise.reject(new Error('Fictional fixture does not refresh indices.')),
};
const stored = new Map(workspace.rounds.map((round) => [round.id, {
  ...fictionalGamesRound, roundId: round.id, roundName: round.name,
  ...(fictionalGamesRound.games ? { games: { ...fictionalGamesRound.games,
    configuration: { ...fictionalGamesRound.games.configuration, roundId: round.id } } } : {}),
}]));
const scores: ScoresClient = {
  load: (_event, roundId) => {
    const value = stored.get(roundId);
    return value ? Promise.resolve(value) : Promise.reject(new Error('Unknown fictional round.'));
  },
  save: () => Promise.reject(new Error('Fictional fixture does not save scores.')),
  history: () => Promise.reject(new Error('Fictional fixture does not read audits.')),
  saveGames: (_event, roundId, games, etag, requestId) => {
    const previous = stored.get(roundId);
    const snapshot = workspace.rounds.find((round) => round.id === roundId);
    if (!previous || !snapshot) return Promise.reject(new Error('Unknown fictional game round.'));
    const round = { ...previous, games: { configuration: {
      eventId: previous.eventId, roundId, etag: 'fictional-game-saved', games,
    }, results: calculateGameResults(games, snapshot, previous.cards) } };
    stored.set(roundId, round);
    return Promise.resolve({ round, change: { id: requestId, eventId: previous.eventId, roundId,
      expectedEtag: etag, before: previous.games?.configuration.games ?? [], after: games,
      recordedAt: '2026-01-01T00:00:00Z',
      recordedBy: { tenantId: '00000000-0000-4000-8000-000000000080', objectId: '00000000-0000-4000-8000-000000000081' },
    } });
  },
};
function subscribe(changed: () => void) {
  window.addEventListener('hashchange', changed);
  return () => { window.removeEventListener('hashchange', changed); };
}
export function Fixture() {
  const roundId = useSyncExternalStore(subscribe, () =>
    new URLSearchParams(window.location.hash.split('?')[1]).get('round') ?? fictionalGamesRound.roundId);
  return <div className="app"><main><OwnerRoundScoresPage setup={setup} scores={scores}
    eventId={workspace.event.id} roundId={roundId} onSessionExpired={() => { throw new Error('Unexpected fictional expiry.'); }} /></main></div>;
}
const root = document.getElementById('owner-round-switch');
if (!root) throw new Error('Missing owner round-switch fixture.');
createRoot(root).render(<Fixture />);
