import { createRoot } from 'react-dom/client';
import { useMemo, useState } from 'react';
import { EventTripView } from '../../src/features/event-trip';
import { OwnerScoresView } from '../../src/features/scoring';
import { roundToneFor } from '../../src/features/round-theme';
import type { ScoresClient } from '../../src/client/scoring';
import { eventSkinsFixture } from '../../src/domain/event-skins.test-support';
import '../../src/app/styles.css';

const f = eventSkinsFixture(undefined, undefined, 8);
const denied = () => Promise.reject(new Error('Fictional color fixture does not write scores.'));
export function Fixture() {
  const [selected, setSelected] = useState(f.workspace.rounds[0]?.id ?? '');
  const [blocked, setBlocked] = useState(false);
  const client = useMemo<ScoresClient>(() => ({
    load: (_event, roundId) => {
      const round = f.rounds.find((entry) => entry.roundId === roundId);
      return round ? Promise.resolve(round) : Promise.reject(new Error('Fictional round missing'));
    },
    save: denied, saveGames: denied, history: denied,
  }), []);
  return <div className="app"><main>
    <EventTripView workspace={f.workspace} view="rounds" />
    <OwnerScoresView client={client} eventId={f.workspace.event.id} roundId={selected}
      roundTone={roundToneFor(selected, f.workspace.rounds)} onNavigationBlockedChange={setBlocked} onSessionExpired={() => undefined}
      roundPicker={<label>Round<select value={selected} disabled={blocked} onChange={(event) => { setSelected(event.target.value); }}>
        {f.workspace.rounds.map((round) => <option key={round.id} value={round.id}>{round.name}</option>)}
      </select></label>} />
  </main></div>;
}
const root = document.getElementById('round-theme-fixture');
if (!root) throw new Error('Missing fictional round theme root');
createRoot(root).render(<Fixture />);
