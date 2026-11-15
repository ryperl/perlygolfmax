import { createRoot } from 'react-dom/client';
import { useMemo, useRef, useState } from 'react';
import { OwnerScoresView } from '../../src/features/scoring';
import { PursePanel } from '../../src/features/purse';
import type { ScoresClient } from '../../src/client/scoring';
import { purseTestContext, purseTestId } from '../../src/domain/purse.test-support';
import type { PursePlan } from '../../src/domain/purse';
import { calculatePurse, isKpPool } from '../../src/domain/purse';
import type { PurseSelection, PurseWriteResult } from '../../src/domain/purse-settings';
import type { RoundScores, ScoreChange } from '../../src/domain/scoring';
import { preserveScoreExtras } from '../../src/domain/scoring';
import { calculateGameResults } from '../../src/domain/stableford';
import { sameKpEntry } from '../../src/domain/kp';
import '../../src/app/styles.css';

const f = purseTestContext();
const original = f.rounds[0];
const savedSnapshot = f.workspace.rounds[0];
if (!original || !savedSnapshot) throw new Error('Missing fictional KP snapshot');
const layout = original.layout.map((hole) => ({
  ...hole, par: hole.number <= 4 ? 3 : hole.par, length: [183, 178, 175, 200][hole.number - 1] ?? hole.length,
}));
const snapshot = { ...savedSnapshot, teeProfile: { ...savedSnapshot.teeProfile, holes: layout } };
const workspace = { ...f.workspace, rounds: [snapshot] };
const initial: RoundScores = { ...original, layout, kpEnabled: true,
  permissions: { role: 'owner', writePlayerIds: original.cards.map((card) => card.playerId), canManageGames: true } };

export function Fixture() {
  const [tab, setTab] = useState('round');
  const [blocked, setBlocked] = useState(false);
  const [plan, setPlan] = useState<PursePlan>(f.plan);
  const [revision, setRevision] = useState('purse-initial');
  const [round, setRound] = useState(initial);
  const saved = useRef(initial);
  const receipts = useRef(new Map<string, ScoreChange>());
  const client = useMemo<ScoresClient>(() => ({
    load: () => Promise.resolve(saved.current),
    history: () => Promise.resolve({ changes: [] }),
    saveGames: () => Promise.reject(new Error('Fictional smoke settings are readonly')),
    saveKp: (_event, _round, selection, etag, id) => {
      if ((saved.current.kp?.etag ?? null) !== etag) return Promise.reject(new Error('Fictional KP revision changed'));
      saved.current = { ...saved.current, kp: { ...selection, etag: id } };
      setRound(saved.current);
      return Promise.resolve(saved.current);
    },
    save: (_event, _round, playerId, holeNumber, score, expectedEtag, id) => {
      const replay = receipts.current.get(id);
      if (replay) return Promise.resolve({ round: saved.current, change: replay });
      const card = saved.current.cards.find((entry) => entry.playerId === playerId);
      const before = card?.holes.find((hole) => hole.number === holeNumber)?.score;
      if (!card || !before || card.etag !== expectedEtag) return Promise.reject(new Error('Fictional card changed'));
      const after = preserveScoreExtras(score, before);
      if (!sameKpEntry(before.kp, after.kp) && saved.current.kp?.status !== 'open') return Promise.reject(new Error('KP entries closed'));
      const change: ScoreChange = { id, eventId: initial.eventId, roundId: initial.roundId, playerId, holeNumber,
        before, after, expectedEtag, recordedAt: '2026-01-02T00:00:00Z', recordedBy: { tenantId: purseTestId(9100), objectId: purseTestId(9101) } };
      const cards = saved.current.cards.map((entry) => entry.playerId === playerId
        ? { ...entry, etag: id, updatedAt: change.recordedAt, holes: entry.holes.map((hole) => hole.number === holeNumber ? { ...hole, score: after } : hole) } : entry);
      const games = saved.current.games;
      saved.current = { ...saved.current, cards, setupLocked: true, lastUpdatedAt: change.recordedAt,
        ...(games ? { games: { ...games, results: calculateGameResults(games.configuration.games, snapshot, cards) } } : {}) };
      receipts.current.set(id, change);
      setRound(saved.current);
      return Promise.resolve({ round: saved.current, change });
    },
  }), []);
  const configuration = { eventId: initial.eventId, etag: revision, plan, resolutions: [] };
  const value = { workspace, roundScores: [round], configuration,
    view: { plan, resolutions: [], calculation: calculatePurse(plan, workspace, [round]) } };
  return <div className="app"><main>
    <nav aria-label="Fictional KP fixture navigation">
      <button disabled={blocked} onClick={() => { setTab('round'); }}>Fictional round</button>
      <button disabled={blocked} onClick={() => { setTab('purse'); }}>Fictional purse</button>
    </nav>
    {tab === 'round' ? <OwnerScoresView client={client} eventId={initial.eventId} roundId={initial.roundId}
      onSessionExpired={() => undefined} onNavigationBlockedChange={setBlocked} />
      : <PursePanel value={value} busy={false} onDirtyChange={setBlocked} onRefresh={() => Promise.resolve(value)}
        onSave={(next, resolutions, expectedEtag, id): Promise<PurseWriteResult> => {
          const before: PurseSelection = { plan, resolutions: [] };
          const nextConfiguration = { eventId: initial.eventId, etag: id, plan: next, resolutions };
          const pool = next.pools.find(isKpPool);
          saved.current = { ...saved.current, ...(pool ? { kpPot: { amountMinor: pool.amountMinor, currency: next.currency } } : {}) };
          setRound(saved.current);
          const current = { workspace, roundScores: [saved.current], configuration: nextConfiguration,
            view: { plan: next, resolutions, calculation: calculatePurse(next, workspace, [saved.current], resolutions) } };
          setPlan(next);
          setRevision(id);
          return Promise.resolve({ current, change: {
            id, eventId: initial.eventId, expectedEtag, before, after: { plan: next, resolutions },
            recordedAt: '2026-01-02T00:00:00Z', recordedBy: { tenantId: purseTestId(9100), objectId: purseTestId(9101) },
          } });
        }} />}
  </main></div>;
}
const element = document.getElementById('kp-fixture');
if (!element) throw new Error('Missing fictional KP root');
createRoot(element).render(<Fixture />);
