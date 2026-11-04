import { useState } from 'react';
import type { RoundScores } from '../../domain/scoring';
import { PlayerScorecardRecap } from './PlayerScorecardRecap';
import { ScorecardNine } from './ScorecardNine';
import { cardFor } from './entry-state';
import { summarizeCard } from './scorecard-presentation';

export function SavedScorecards({ round, groupNumber, busy, onGroupChange, onEnterScores }: {
  readonly round: RoundScores;
  readonly groupNumber: number;
  readonly busy: boolean;
  readonly onGroupChange: (groupNumber: number) => void;
  readonly onEnterScores: () => void;
}) {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [nine, setNine] = useState<'front' | 'back' | 'full'>('full');
  const group = round.groups.find((item) => item.number === groupNumber) ?? round.groups[0];
  if (!group) throw new Error('Saved round has no groups.');
  const cards = group.playerIds.map((id) => cardFor(round, id));
  const player = cards.find((card) => card.playerId === playerId);
  const layout = [...round.layout].sort((left, right) => left.number - right.number);
  const front = layout.filter((hole) => hole.number <= 9);
  const back = layout.filter((hole) => hole.number > 9);
  const rating = round.teeRatings?.find((item) => item.type === 'Total');
  return <section className="round-scorecards" aria-label="Round scorecards">
    <header className="round-card-heading">
      <div><p className="scorecard-eyebrow">{round.roundName}</p><h2>Round scorecard</h2>
        <p>{round.courseName}</p>
        <p className="scorecard-course">{round.teeName} / {round.teeCategory}{rating ? ` · Rating ${String(rating.course)} / Slope ${String(rating.slope)}` : ''}</p>
      </div>
      <button type="button" disabled={busy} onClick={onEnterScores}>{round.eventStatus === 'archived' ? 'View hole entry' : 'Enter scores'} · Group {group.number}</button>
    </header>
    <div className="scorecard-controls">
      {round.groups.length > 1 && <label>Group<select value={group.number} disabled={busy} onChange={(event) => {
        onGroupChange(Number(event.target.value)); setPlayerId(null);
      }}>{round.groups.map((item) => <option value={item.number} key={item.number}>Group {item.number}</option>)}</select></label>}
      <label>Scorecard<select value={player?.playerId ?? ''} onChange={(event) => { setPlayerId(event.target.value || null); }}>
        <option value="">Whole group</option>{cards.map((card) => <option value={card.playerId} key={card.playerId}>{card.displayName}</option>)}
      </select></label>
    </div>
    {player ? <>
      <button type="button" className="scorecard-back" onClick={() => { setPlayerId(null); }}>Back to group scorecard</button>
      <PlayerScorecardRecap round={round} card={player} />
    </> : <>
      {back.length > 0 && <div className="scorecard-nine-picker" role="group" aria-label="Holes to display">
        <button type="button" aria-pressed={nine === 'front'} onClick={() => { setNine('front'); }}>Front 9</button>
        <button type="button" aria-pressed={nine === 'back'} onClick={() => { setNine('back'); }}>Back 9</button>
        <button type="button" aria-pressed={nine === 'full'} onClick={() => { setNine('full'); }}>Full card</button>
      </div>}
      <div className="recap-sections">
        {(nine !== 'back' || back.length === 0) && <ScorecardNine label="Front nine" subtotal="Out" layout={front} fullLayout={layout} cards={cards} onPlayerSelect={setPlayerId} />}
        {nine !== 'front' && back.length > 0 && <ScorecardNine label="Back nine" subtotal="In" layout={back} fullLayout={layout} cards={cards} onPlayerSelect={setPlayerId} />}
      </div>
      {cards.some((card) => !summarizeCard(card, layout).complete) && <p className="scorecard-incomplete">* Incomplete recorded total.</p>}
    </>}
  </section>;
}
