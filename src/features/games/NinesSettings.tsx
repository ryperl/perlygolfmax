import { useId } from 'react';
import { ninesPlayerCount } from '../../domain/nines';
import type { RoundGroup } from '../../domain/setup';
import type { GameDraft } from './game-draft';
import { ninesDraftProblem } from './game-draft';

interface NinesSettingsProps {
  readonly draft: GameDraft;
  readonly groups: readonly RoundGroup[];
  readonly playerIds: readonly string[];
  readonly playerName: (playerId: string) => string;
  readonly onChange: (draft: GameDraft) => void;
}

/** Nines-only settings: the saved group of three, and an optional stake per point. */
export function NinesSettings({ draft, groups, playerIds, playerName, onChange }: NinesSettingsProps) {
  const stakeHint = useId();
  const eligibleGroups = groups.filter((group) => group.playerIds.length === ninesPlayerCount);
  const golfers = draft.ninesPlayers ?? [];
  const problem = ninesDraftProblem(draft, playerIds, groups);

  function chooseGroup(value: string) {
    const group = eligibleGroups.find((entry) => entry.number === Number(value));
    if (group) onChange({ ...draft, groupNumber: group.number, ninesPlayers: group.playerIds });
  }

  return <section aria-label="Nines setup">
    <label>Playing group of three
      <select value={draft.groupNumber ?? ''} onChange={(event) => { chooseGroup(event.target.value); }}>
        <option value="">Choose a saved group of three</option>
        {eligibleGroups.map((group) => <option key={group.number} value={group.number}>Group {group.number}</option>)}
      </select>
    </label>
    {golfers.length === ninesPlayerCount && <p>{golfers.map(playerName).join(' · ')}</p>}
    <label>Stake per point (USD)
      <input inputMode="decimal" value={draft.stake ?? ''} aria-describedby={stakeHint} placeholder="Points only"
        onChange={(event) => { onChange({ ...draft, stake: event.target.value }); }} />
    </label>
    <small id={stakeHint}>Each golfer settles the point difference with each other golfer once. Leave blank for points only.</small>
    <p>Each hole awards 9 points: 5 for the best score, 3 for second, 1 for the worst. Ties share their places
      (4/4/1, 5/2/2, 3/3/3). A pickup, X7 or DNF ranks worst. A hole scores once all three have saved a score.</p>
    {problem && <p role="status">{problem}</p>}
  </section>;
}
