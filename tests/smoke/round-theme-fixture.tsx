import { createRoot } from 'react-dom/client';
import { useMemo, useState } from 'react';
import { EventTripView } from '../../src/features/event-trip';
import { OwnerScoresView } from '../../src/features/scoring';
import { roundToneFor } from '../../src/features/round-theme';
import type { ScoresClient } from '../../src/client/scoring';
import { eventSkinsFixture } from '../../src/domain/event-skins.test-support';
import type { RoundScores } from '../../src/domain/scoring';
import { calculateGameResults, stablefordPoints } from '../../src/domain/stableford';
import { kpContext } from '../../src/domain/kp';
import '../../src/app/styles.css';

const f = eventSkinsFixture(undefined, undefined, 8);
const snapshots = f.workspace.rounds.map((round) => ({ ...round, teeProfile: { ...round.teeProfile,
  totalPar: 68, holes: round.teeProfile.holes.map((hole) => ({ ...hole, par: hole.number <= 4 ? 3 : hole.par })),
  ratings: round.teeProfile.ratings.map((rating) => ({ ...rating, course: rating.type === 'Total' ? 68 : rating.type === 'Front' ? 32 : 36 })),
} }));
const workspace = { ...f.workspace, rounds: snapshots };
const rounds: readonly RoundScores[] = f.rounds.map((round, index) => {
  const snapshot = snapshots[index];
  if (!snapshot) throw new Error('Missing fictional palette snapshot');
  const cards = round.cards.map((card, cardIndex) => ({ ...card, holes: card.holes.map((hole) => ({ ...hole,
    score: hole.number === 1 && cardIndex === 0 ? { kind: 'strokes' as const, strokes: 2,
      kp: { kind: 'measured' as const, inches: 51, onGreen: true as const,
        measurementId: `00000000-0000-4000-8000-${String(9500 + index).padStart(12, '0')}` } } : hole.score,
  })) }));
  const games = [{ id: '00000000-0000-4000-8000-000000009000', name: 'Fictional palette game', basis: 'gross' as const,
    preset: 'standard' as const, handicapAllowancePercent: 95, points: stablefordPoints('standard') }];
  return { ...round, cards, layout: snapshot.teeProfile.holes, teeRatings: snapshot.teeProfile.ratings, kpEnabled: true,
    permissions: { role: 'owner', writePlayerIds: cards.map((card) => card.playerId), canManageGames: true },
    kp: { version: 1, status: 'open', etag: 'fictional-kp', context: kpContext(snapshot.teeProfile.holes, cards.map((card) => card.playerId)), decisions: [] },
    games: { configuration: { eventId: round.eventId, roundId: round.roundId, etag: 'fictional-game', games },
      results: calculateGameResults(games, snapshot, cards) } };
});
const denied = () => Promise.reject(new Error('Fictional color fixture does not write scores.'));
export function Fixture() {
  const [selected, setSelected] = useState(f.workspace.rounds[0]?.id ?? '');
  const [blocked, setBlocked] = useState(false);
  const client = useMemo<ScoresClient>(() => ({
    load: (_event, roundId) => {
      const round = rounds.find((entry) => entry.roundId === roundId);
      return round ? Promise.resolve(round) : Promise.reject(new Error('Fictional round missing'));
    },
    save: denied, saveGames: denied, history: denied,
  }), []);
  return <div className="app"><main>
    <EventTripView workspace={workspace} view="rounds" />
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
