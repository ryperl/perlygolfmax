import { createRoot } from 'react-dom/client';
import { useMemo, useRef, useState } from 'react';
import { EventLeaderboardPage } from '../../src/app/EventLeaderboardPage';
import type { EventLeaderboardClient } from '../../src/client/event-leaderboard';
import { eventSkinsFixture, publicEventSkinsFixture, withoutEventSkins } from '../../src/domain/event-skins.test-support';
import { calculateEventSkins, calculateEventSkinsDetails } from '../../src/domain/event-skins';
import type { EventSkinsChange } from '../../src/domain/event-skins';
import { calculateEventStandings } from '../../src/domain/event-leaderboard';
import type { EventWorkspace } from '../../src/domain/setup';
import { PursePanel } from '../../src/features/purse';
import type { PursePlan } from '../../src/domain/purse';
import { calculatePurse } from '../../src/domain/purse';
import type { EventPurseView } from '../../src/domain/purse-settings';
import { purseTestId } from '../../src/domain/purse.test-support';
import { fictionalPurseSave } from './purse-fixture-data';
import '../../src/app/styles.css';

const source = eventSkinsFixture(undefined, undefined, 3);
const f = { ...source, rounds: source.rounds.map((round) => ({ ...round, cards: round.cards.map((card, index) => ({
  ...card, holes: card.holes.map((hole) => hole.number === 2 ? { ...hole, score: { kind: 'strokes' as const, strokes: 4 + index } } : hole),
})) })) };
const initial: EventWorkspace = { ...withoutEventSkins(f.workspace), eventSkinsSupported: true };
export function Fixture() {
  const saved = useRef(initial);
  const [workspace, setWorkspace] = useState(initial);
  const receipts = useRef(new Map<string, EventSkinsChange>());
  const [tab, setTab] = useState('skins');
  const [plan, setPlan] = useState<PursePlan | null>(null);
  const [etag, setEtag] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const owner = useMemo<EventLeaderboardClient>(() => ({
    details: () => Promise.resolve(calculateEventSkinsDetails(saved.current, f.rounds)),
    load: () => {
      const workspace = saved.current;
      const rounds = workspace.eventSkins ? f.rounds : [];
      return Promise.resolve({ workspace, roundScores: rounds, standings: calculateEventStandings(workspace, rounds),
        ...(workspace.eventSkins ? { eventSkins: calculateEventSkins(workspace, rounds) } : {}) });
    },
    configureEventSkins: (eventId, after, expectedEtag, id) => {
      const replay = receipts.current.get(id);
      if (replay) return Promise.resolve(replay);
      if (eventId !== saved.current.event.id || expectedEtag !== saved.current.etag) return Promise.reject(new Error('Fictional event changed.'));
      const change: EventSkinsChange = { eventId, after, expectedEtag, id, before: saved.current.eventSkins ?? null,
        recordedAt: '2026-01-01T00:00:00Z', recordedBy: { tenantId: purseTestId(7001), objectId: purseTestId(7002) } };
      const { eventSkins, ...base } = saved.current;
      void eventSkins;
      saved.current = { ...base, etag: id, event: { ...base.event, etag: id }, ...(after ? { eventSkins: after } : {}) };
      receipts.current.set(id, change);
      return Promise.resolve(change);
    },
  }), []);
  const readonly = useMemo<EventLeaderboardClient>(() => ({
    details: () => Promise.resolve(calculateEventSkinsDetails(saved.current, f.rounds)),
    load: async (id, signal) => {
      const value = await owner.load(id, signal);
      const projection = publicEventSkinsFixture({ workspace: value.workspace, rounds: value.roundScores });
      return { ...value, workspace: projection.workspace, roundScores: projection.rounds };
    },
  }), [owner]);
  const value: EventPurseView = { workspace, roundScores: f.rounds,
    configuration: { eventId: f.workspace.event.id, plan, etag, resolutions: [] },
    view: plan ? { plan, resolutions: [], calculation: calculatePurse(plan, workspace, f.rounds) } : null };
  return <div className="app"><main>
    <nav aria-label="Fictional event skins fixture">
      <button disabled={blocked} onClick={() => { setWorkspace(saved.current); setTab('skins'); }}>Fictional event skins</button>
      <button disabled={blocked} onClick={() => { setWorkspace(saved.current); setTab('purse'); }}>Fictional purse</button>
      <button disabled={blocked} onClick={() => { setWorkspace(saved.current); setTab('public'); }}>Public read-only</button>
    </nav>
    {tab === 'purse' ? <PursePanel value={value} busy={false} onDirtyChange={setBlocked} onRefresh={async () => Promise.resolve(value)}
      onSave={async (next, resolutions, expected, id) => {
        saved.current = { ...saved.current, purseConfigured: true };
        const result = fictionalPurseSave({ ...value, workspace: saved.current }, next, resolutions, expected, id);
        setWorkspace(saved.current); setPlan(next); setEtag(result.current.configuration.etag);
        return Promise.resolve(result);
      }} />
      : <EventLeaderboardPage key={tab} eventSkins client={tab === 'public' ? readonly : owner}
        eventId={f.workspace.event.id} onSessionExpired={() => undefined} />}
  </main></div>;
}
const root = document.getElementById('event-skins-fixture');
if (!root) throw new Error('Missing fictional event skins root.');
createRoot(root).render(<Fixture />);
