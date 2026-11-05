import { createRoot } from 'react-dom/client';
import type { ScoresClient } from '../../src/client/scoring';
import { isRoundScores, isScoreWriteResult } from '../../src/contracts/scoring';
import { loadScoreLocation, saveScoreLocation, scoreLocationHref } from '../../src/app/score-resume';
import { OwnerScoresView } from '../../src/features/scoring';
import { fictionalResumeRound } from './score-resume-fixture-data';
import '../../src/app/styles.css';

const root = document.getElementById('score-resume-fixture');
if (!root) throw new Error('Missing fictional resume fixture root.');
const stored = loadScoreLocation();
if (stored.error) throw new Error(stored.error);
const unavailable = () => Promise.reject(new Error('Fictional public fixture cannot manage games or history.'));
const client: ScoresClient = {
  async load(_eventId, _roundId, signal) {
    const response = await fetch('/__resume-round', { signal });
    const value: unknown = await response.json();
    if (!response.ok || !isRoundScores(value)) throw new Error('Invalid fictional round response.');
    return value;
  },
  async save(eventId, roundId, playerId, holeNumber, score, etag, requestId, signal) {
    const response = await fetch('/__resume-save', {
      method: 'PUT', signal, body: JSON.stringify({ eventId, roundId, playerId, holeNumber, score, etag, requestId }),
    });
    const value: unknown = await response.json();
    if (!response.ok || !isScoreWriteResult(value)) throw new Error('Fictional save failed; remain on this hole.');
    return value;
  },
  saveGames: unavailable, history: unavailable,
};
createRoot(root).render(<div className="app"><main>
  <OwnerScoresView client={client} eventId={fictionalResumeRound.eventId} roundId={fictionalResumeRound.roundId}
    initialLocation={stored.location ?? { groupNumber: 2, holeNumber: 1, view: 'entry' }}
    onLocationChange={(location) => {
      const saved = { ...location, version: 1, eventId: fictionalResumeRound.eventId, roundId: fictionalResumeRound.roundId } as const;
      const error = saveScoreLocation(saved);
      if (error) throw new Error(error);
      history.replaceState(null, '', scoreLocationHref(saved));
    }}
    onSessionExpired={(message) => { throw new Error(message); }} />
</main></div>);
