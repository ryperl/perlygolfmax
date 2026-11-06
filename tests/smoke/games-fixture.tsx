import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { RoundGamesPanel } from '../../src/features/games';
import { RoundLeaderboard } from '../../src/features/leaderboard';
import { GroupHoleEntry } from '../../src/features/scoring/GroupHoleEntry';
import type { GroupHoleEntryRow } from '../../src/features/scoring/GroupHoleEntry';
import type { HoleDraft } from '../../src/features/scoring/entry-state';
import { fictionalGamesRound, fictionalTeamGamesRound } from './games-fixture-data';
import { SavedScorecards } from '../../src/features/scoring/SavedScorecards';
import '../../src/app/styles.css';
import '../../src/features/scoring/scoring.css';

const root = document.getElementById('games-fixture');
if (!root) throw new Error('Missing fictional Games fixture root.');
export function EntryPreview() {
  const [values, setValues] = useState<Readonly<Record<string, string>>>({});
  const [number, setNumber] = useState(1);
  const [saves, setSaves] = useState(0);
  const hole = fictionalGamesRound.layout.find((item) => item.number === number);
  if (!hole) throw new Error('Missing fictional entry hole.');
  const rows: readonly GroupHoleEntryRow[] = fictionalGamesRound.cards.map((card) => {
    const text = values[`${String(number)}:${card.playerId}`];
    const draft: HoleDraft | undefined = text === undefined ? undefined : { text, baseEtag: null, status: 'draft' };
    return { playerId: card.playerId, displayName: card.displayName, saved: { kind: 'unplayed' },
      canReview: false, ...(draft ? { draft } : {}) };
  });
  return <section aria-label="Fictional entry preview"><GroupHoleEntry groups={fictionalGamesRound.groups} groupNumber={1}
    layout={fictionalGamesRound.layout} hole={hole} rows={rows} busy={false} readOnly={false}
    unsavedCount={rows.filter((row) => row.draft !== undefined).length} onGroupChange={() => undefined} onHoleChange={setNumber}
    onEdit={(playerId, text) => { setValues((previous) => ({ ...previous, [`${String(number)}:${playerId}`]: text })); }}
    onReview={() => undefined} onDiscard={() => undefined} onDiscardAll={() => { setValues({}); }} onSave={() => { setSaves((previous) => previous + 1); }} />
    <p aria-label="Fictional save count">{saves}</p>
  </section>;
}
const teamPreview = new URLSearchParams(window.location.search).has('teams');
const round = teamPreview ? fictionalTeamGamesRound : fictionalGamesRound;
createRoot(root).render(<div className="app"><main><section className="owner-scores"><div>
  <RoundGamesPanel round={round} busy={false} onDirtyChange={() => undefined}
    onSave={() => Promise.resolve(null)} onRefresh={() => Promise.resolve(round)} />
</div>{teamPreview ? <SavedScorecards round={round} groupNumber={1} busy={false} onGroupChange={() => undefined}
  onEnterScores={() => undefined} /> : <EntryPreview />}
  <RoundLeaderboard round={round} busy={false} onManageGames={() => undefined} /></section></main></div>);
