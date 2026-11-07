import type { RoundScores, Scorecard } from '../../domain/scoring';
import { scorecardHoles, scorecardTee } from '../../domain/tees';
import { ScorecardNine } from './ScorecardNine';
import { scorecardGame, scorecardGameWarnings, summarizeCard } from './scorecard-presentation';
import './scorecard-recap.css';
import { gameScoringLabel } from '../games';

export function PlayerScorecardRecap({ round, card, gameId }: {
  readonly round: RoundScores;
  readonly card: Scorecard;
  readonly gameId?: string | null | undefined;
}) {
  const tee = scorecardTee(round, card.playerId);
  const layout = [...scorecardHoles(round, card.playerId)].sort((left, right) => left.number - right.number);
  const front = layout.filter((hole) => hole.number <= 9);
  const back = layout.filter((hole) => hole.number > 9);
  const summary = summarizeCard(card, layout);
  const game = scorecardGame(round, gameId);
  const totalRating = (tee?.ratings ?? round.teeRatings)?.find((rating) => rating.type === 'Total');
  return <section className="player-scorecard-recap" aria-label={`${card.displayName} full scorecard`}>
    <header className="recap-heading">
      <div><h3>{card.displayName}</h3><p>{round.roundName} — {round.courseName}</p>
        <p>{tee?.name ?? round.teeName} / {tee?.category ?? round.teeCategory}{totalRating ? ` · Course rating ${String(totalRating.course)} · Slope ${String(totalRating.slope)}` : ''}
          {(round.playerTees?.length ?? 0) > 0 ? tee ? ' · personal tee' : ' · default tee' : ''}</p>
        {game && <p className="scorecard-game-context">{game.definition.name} · {game.definition.kind === 'ball-drop' || game.definition.kind === 'skins'
          ? gameScoringLabel(game.definition) : `${game.definition.basis === 'net' ? 'Net' : 'Gross'} points`}</p>}
      </div>
      <p className="recap-total">{summary.complete ? 'Gross total' : 'Recorded total'}:
        <strong>{summary.total ?? '—'}</strong>
        {!summary.complete && <span>Incomplete</span>}
      </p>
    </header>
    {scorecardGameWarnings(game, [card]).map((warning) => <p className="scorecard-game-unavailable" key={warning}>{warning}</p>)}
    <div className="recap-sections">
      <ScorecardNine label="Front nine" subtotal="Out" layout={front} fullLayout={layout} cards={[card]} game={game} />
      {back.length > 0 && <ScorecardNine label="Back nine" subtotal="In" layout={back} fullLayout={layout} cards={[card]} game={game} />}
    </div>
    {(!summary.complete || game?.result?.players.some((player) => player.playerId === card.playerId && player.status === 'in-progress' && player.totalPoints !== null)) &&
      <p className="scorecard-incomplete">{game ? '* Incomplete total.' : '* Incomplete recorded total.'}</p>}
    {summary.missing && <p role="alert">Some saved hole data is unavailable. Refresh before relying on this scorecard.</p>}
  </section>;
}
