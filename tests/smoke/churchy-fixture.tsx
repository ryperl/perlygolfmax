import { createRoot } from 'react-dom/client';
import { useMemo, useState } from 'react';
import { OwnerScoresView } from '../../src/features/scoring';
import { churchyFixture } from '../../src/domain/churchy.test-support';
import type { ScoresClient } from '../../src/client/scoring';
import type { ScoreChange, ScoreWriteResult } from '../../src/domain/scoring';
import { calculateGameResults } from '../../src/domain/stableford';
import '../../src/app/styles.css';

const element = document.getElementById('churchy-fixture');
if (!element) throw new Error('Missing fictional Churchy root.');
const fixture = churchyFixture();

function memoryChurchy(enabled: boolean): ScoresClient {
    let round = fixture.round(undefined, enabled);
    const receipts = new Map<string, ScoreChange>();
    return {
      load: () => Promise.resolve(round),
      history: () => Promise.resolve({ changes: [] }),
      save: (_event, _round, playerId, holeNumber, score, expectedEtag, id, signal): Promise<ScoreWriteResult> => {
        signal.throwIfAborted();
        const replay = receipts.get(id);
        if (replay) return Promise.resolve({ round, change: replay });
        const card = round.cards.find((entry) => entry.playerId === playerId);
        if (!card || card.etag !== expectedEtag) throw new Error('Fictional card changed');
        const before = card.holes.find((entry) => entry.number === holeNumber)?.score;
        if (!before) throw new Error('Fictional hole missing');
        const change: ScoreChange = { id, eventId: round.eventId, roundId: round.roundId, playerId,
          holeNumber, before, after: score, expectedEtag, recordedAt: '2026-01-01T00:00:00Z',
          recordedBy: { kind: 'public-score', eventId: round.eventId } };
        const cards = round.cards.map((entry) => entry.playerId === playerId ? { ...entry, etag: id,
          holes: entry.holes.map((hole) => hole.number === holeNumber ? { ...hole, score } : hole) } : entry);
        if (!round.games) throw new Error('Fictional games missing');
        round = { ...round, cards, games: { ...round.games,
          results: calculateGameResults(round.games.configuration.games, fixture.snapshot, cards) } };
        receipts.set(id, change);
        return Promise.resolve({ round, change });
      },
      saveGames: () => {
        throw new Error('Use fictional unscored setup fixture for creation.');
      },
    };
}

export function Fixture() {
  const [enabled, setEnabled] = useState(true);
  const [generation, setGeneration] = useState(0);
  const [ready, setReady] = useState(false);
  const client = useMemo(() => memoryChurchy(enabled), [enabled]);
  return <div className="app"><main>
    <nav aria-label="Fictional Churchy server controls">
      <button onClick={() => { setEnabled((value) => !value); setGeneration((value) => value + 1); }}>Toggle experimental capability</button>
      <button onClick={() => { setReady(true); }}>Open fictional saved round</button>
    </nav>
    {ready && <OwnerScoresView key={generation} client={client} eventId={fixture.round().eventId} roundId={fixture.snapshot.id}
      onSessionExpired={() => undefined} />}
  </main></div>;
}

createRoot(element).render(<Fixture />);
