import { useState } from 'react';
import type { RoundScores } from '../../domain/scoring';
import { writablePlayerIds } from './score-access';
import { isTeamGameDefinition } from '../../domain/games';
import { gameScoringLabel } from '../games';
import { PlayerScorecardRecap } from './PlayerScorecardRecap';
import { ScorecardNine } from './ScorecardNine';
import { cardFor } from './entry-state';
import { scorecardGame, scorecardGameWarnings, summarizeCard } from './scorecard-presentation';

export function SavedScorecards({ round, groupNumber, busy, onGroupChange, onEnterScores }: {
  readonly round: RoundScores;
  readonly groupNumber: number;
  readonly busy: boolean;
  readonly onGroupChange: (groupNumber: number) => void;
  readonly onEnterScores: () => void;
}) {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [nine, setNine] = useState<'front' | 'back' | 'full'>('full');
  const [gameId, setGameId] = useState<string | null | undefined>(undefined);
  const game = scorecardGame(round, gameId);
  const games = round.games?.configuration.games ?? [];
  const group = round.groups.find((item) => item.number === groupNumber) ?? round.groups[0];
  if (!group) throw new Error('Saved round has no groups.');
  const cards = group.playerIds.map((id) => cardFor(round, id));
  const player = cards.find((card) => card.playerId === playerId);
  const layout = [...round.layout].sort((left, right) => left.number - right.number);
  const front = layout.filter((hole) => hole.number <= 9);
  const back = layout.filter((hole) => hole.number > 9);
  const rating = round.teeRatings?.find((item) => item.type === 'Total');
  const mixed = (round.playerTees?.length ?? 0) > 0;
  return <section className="round-scorecards" aria-label="Round scorecards">
    <header className="round-card-heading">
      <div><p className="scorecard-eyebrow">{round.roundName}</p><h2>Round scorecard</h2>
        <p>{round.courseName}</p>
        <p className="scorecard-course">{mixed ? 'Default tee: ' : ''}{round.teeName} / {round.teeCategory}{rating ? ` · Rating ${String(rating.course)} / Slope ${String(rating.slope)}` : ''}
          {mixed && ' · Personal tees shown per golfer'}</p>
      </div>
      {group.playerIds.some((id) => writablePlayerIds(round).includes(id)) &&
        <button type="button" disabled={busy} onClick={onEnterScores}>Enter scores · Group {group.number}</button>}
    </header>
    {games.length > 0 && <section className="scorecard-game-summary" aria-label="Round games">
      <h3>Round games</h3>
      <ul role="list">{games.map((entry) => <li key={entry.id}>
        {entry.name} · {gameScoringLabel(entry)}
      </li>)}</ul>
    </section>}
    <div className="scorecard-controls">
      {round.groups.length > 1 && <label>Group<select value={group.number} disabled={busy} onChange={(event) => {
        onGroupChange(Number(event.target.value)); setPlayerId(null);
      }}>{round.groups.map((item) => <option value={item.number} key={item.number}>Group {item.number}</option>)}</select></label>}
      <label>Scorecard<select value={player?.playerId ?? ''} onChange={(event) => { setPlayerId(event.target.value || null); }}>
        <option value="">Whole group</option>{cards.map((card) => <option value={card.playerId} key={card.playerId}>{card.displayName}</option>)}
      </select></label>
      {games.length > 0 && <label>Game<select value={game?.definition.id ?? ''} onChange={(event) => {
        setGameId(event.target.value || null);
      }}>
        <option value="">Strokes only</option>
        {games.map((entry) => <option value={entry.id} key={entry.id}>{entry.name} · {gameScoringLabel(entry)}</option>)}
      </select></label>}
    </div>
    {game?.definition.kind === 'ball-drop' ? <p className="scorecard-game-context">
      Counting balls: {game.definition.format === 'ball-drop-two-net' ? 'N net'
        : game.definition.format === 'ball-drop-two-gross' ? 'G gross' : 'N net · G gross'}
    </p> : game && isTeamGameDefinition(game.definition) && <p className="scorecard-game-unavailable">
      Team game · These golfer scorecards show individual component points, not full team credits. See Games or Leaderboard for team totals.
    </p>}
    {player ? <>
      <button type="button" className="scorecard-back" onClick={() => { setPlayerId(null); }}>Back to group scorecard</button>
      <PlayerScorecardRecap round={round} card={player} gameId={game?.definition.id ?? null} />
    </> : <>
      {scorecardGameWarnings(game, cards).map((warning) => <p className="scorecard-game-unavailable" key={warning}>{warning}</p>)}
      {back.length > 0 && <div className="scorecard-nine-picker" role="group" aria-label="Holes to display">
        <button type="button" aria-pressed={nine === 'front'} onClick={() => { setNine('front'); }}>Front 9</button>
        <button type="button" aria-pressed={nine === 'back'} onClick={() => { setNine('back'); }}>Back 9</button>
        <button type="button" aria-pressed={nine === 'full'} onClick={() => { setNine('full'); }}>Full card</button>
      </div>}
      <div className="recap-sections">
        {(nine !== 'back' || back.length === 0) && <ScorecardNine label="Front nine" subtotal="Out" layout={front} fullLayout={layout} cards={cards} game={game}
          playerTees={round.playerTees} defaultTeeLabel={`${round.teeName} / ${round.teeCategory}`} onPlayerSelect={setPlayerId} />}
        {nine !== 'front' && back.length > 0 && <ScorecardNine label="Back nine" subtotal="In" layout={back} fullLayout={layout} cards={cards} game={game}
          playerTees={round.playerTees} defaultTeeLabel={`${round.teeName} / ${round.teeCategory}`} onPlayerSelect={setPlayerId} />}
      </div>
      {(cards.some((card) => !summarizeCard(card, layout).complete) ||
        game?.result?.players.some((player) => group.playerIds.includes(player.playerId) && player.status === 'in-progress' && player.totalPoints !== null)) &&
        <p className="scorecard-incomplete">{game ? '* Incomplete total.' : '* Incomplete recorded total.'}</p>}
    </>}
  </section>;
}
