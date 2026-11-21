import { scoreEntryText } from '../../contracts/scoring';
import type { CourseHole } from '../../domain/catalog';
import type { HoleScore, PlayerCourseHandicap, Scorecard } from '../../domain/scoring';
import type { PlayerTeeProfile } from '../../domain/tees';
import { ballDropContribution, ballDropScoreText, cardTotalText, pointsTotalText, scorecardBallDropTeams, scorecardGamePlayer, scorecardHandicapStrokes, scorecardStrokeHandicap } from './scorecard-presentation';
import type { RoundGroup } from '../../domain/setup';
import type { ScorecardGame } from './scorecard-presentation';
import { gameDisplayName, gameUnavailableMessage } from '../games';
import { gameResultTotal, gameResultUnit } from '../../domain/games';
import { CourseHandicap } from './CourseHandicap';
import { MatchPlayRows } from './MatchPlayScorecard';
import './scorecard-recap.css';

function scoreMark(score: HoleScore | undefined, par: number) {
  if (!score || score.kind !== 'strokes') return { className: '', description: '' };
  const relative = score.strokes - par;
  if (relative <= -2) return { className: 'score-eagle', description: 'eagle or better' };
  if (relative === -1) return { className: 'score-birdie', description: 'birdie' };
  if (relative === 0) return { className: '', description: 'par' };
  return relative === 1 ? { className: 'score-bogey', description: 'bogey' }
    : { className: 'score-double', description: 'double bogey or more' };
}

function StrokeDots({ count, holeNumber, basis }: { readonly count: number | undefined; readonly holeNumber: number; readonly basis: 'CH' | 'SO' }) {
  if (count === undefined || count <= 0) return null;
  const description = `Hole ${String(holeNumber)}: ${String(count)} handicap stroke${count === 1 ? '' : 's'} received (${basis === 'SO' ? 'SO' : 'tee Course Handicap'})`;
  return <span className="score-stroke-dots" role="img" aria-label={description} title={description}>
    {Array.from({ length: count > 3 ? 1 : count }, (_, index) => <span className="score-stroke-dot" key={index} aria-hidden="true" />)}
    {count > 3 && <span className="score-stroke-count" aria-hidden="true">x{count}</span>}
  </span>;
}

function CourseRows({ layout, fullLayout, showTotal, prefix = '' }: {
  readonly layout: readonly CourseHole[];
  readonly fullLayout: readonly CourseHole[];
  readonly showTotal: boolean;
  readonly prefix?: string;
}) {
  return <>
    <tr className="recap-par"><th scope="row">{prefix}Par</th>{layout.map((hole) => <td key={hole.number}>{hole.par}</td>)}
      <td>{layout.reduce((sum, hole) => sum + hole.par, 0)}</td>{showTotal && <td>{fullLayout.reduce((sum, hole) => sum + hole.par, 0)}</td>}</tr>
    <tr className="recap-course-row"><th scope="row">{prefix}Yards</th>{layout.map((hole) => <td key={hole.number}>{hole.length}</td>)}
      <td>{layout.reduce((sum, hole) => sum + hole.length, 0)}</td>{showTotal && <td>{fullLayout.reduce((sum, hole) => sum + hole.length, 0)}</td>}</tr>
    <tr className="recap-course-row"><th scope="row">{prefix}Stroke index</th>{layout.map((hole) => <td key={hole.number}>{hole.allocation}</td>)}
      <td>—</td>{showTotal && <td>—</td>}</tr>
  </>;
}

export function ScorecardNine({ label, subtotal, layout, fullLayout, cards, game, onPlayerSelect, playerTees, defaultTeeLabel, courseHandicaps, teeStrokeAllocation, matchPlayers = cards, groups = [] }: {
  readonly label: string;
  readonly subtotal: 'Out' | 'In';
  readonly layout: readonly CourseHole[];
  readonly fullLayout: readonly CourseHole[];
  readonly cards: readonly Scorecard[];
  readonly game?: ScorecardGame | undefined;
  readonly onPlayerSelect?: (playerId: string) => void;
  readonly playerTees?: readonly PlayerTeeProfile[] | undefined;
  readonly defaultTeeLabel?: string;
  readonly courseHandicaps?: readonly PlayerCourseHandicap[];
  readonly teeStrokeAllocation?: boolean | undefined;
  readonly matchPlayers?: readonly Pick<Scorecard, 'playerId' | 'displayName'>[];
  readonly groups?: readonly RoundGroup[];
}) {
  const showTotal = subtotal === 'In' || fullLayout.length === layout.length;
  const mixed = (playerTees?.length ?? 0) > 0;
  const unit = game?.definition.kind === 'dots' ? 'dots' : game ? gameResultUnit(game.definition) : 'points';
  const ballDrop = game?.definition.kind === 'ball-drop';
  const matchPlay = game?.definition.kind === 'match-play' || game?.definition.kind === 'nassau';
  const teams = scorecardBallDropTeams(game, cards);
  return <section className="recap-nine">
    <h4>{label}</h4>
    <div className="recap-scroll" role="region" aria-label={`${label} scorecard`} tabIndex={0}>
      <table className="recap-table">
        <caption>{label} scorecard</caption>
        <thead><tr><th scope="col">Hole</th>{layout.map((hole) => <th scope="col" key={hole.number}>{hole.number}</th>)}
          <th scope="col">{subtotal}</th>{showTotal && <th scope="col">Total</th>}</tr></thead>
        <tbody>
          {!mixed && <CourseRows layout={layout} fullLayout={fullLayout} showTotal={showTotal} />}
          {cards.map((card) => {
            const tee = playerTees?.find((entry) => entry.playerId === card.playerId)?.profile;
            const playerFullLayout = tee?.holes ?? fullLayout;
            const playerLayout = layout.map((hole) => playerFullLayout.find((item) => item.number === hole.number) ?? hole);
            const courseHandicap = courseHandicaps?.find((entry) => entry.playerId === card.playerId);
            const strokeHandicap = scorecardStrokeHandicap(game, card.playerId, courseHandicaps, groups);
            const strokeCounts = scorecardHandicapStrokes(strokeHandicap.value, playerFullLayout, tee?.strokeAllocation ?? teeStrokeAllocation);
            const saved = new Map(card.holes.map((hole) => [hole.number, hole.score]));
            const player = ballDrop || matchPlay ? undefined : scorecardGamePlayer(game, card.playerId);
            const holePoints = new Map(player?.strokeGame ? player.strokeGame.holes.map((hole) => [hole.number, hole.value])
              : player?.holes.map((hole) => [hole.number, hole.points]));
            const available = player !== undefined && player.status !== 'unavailable';
            const completeNine = layout.every((hole) => typeof holePoints.get(hole.number) === 'number');
            const hasMatch = game?.definition.kind === 'match-play'
              && game.definition.sides.some((side) => side.playerIds.includes(card.playerId));
            return <Fragment key={card.playerId}>
              {mixed && <tr><th colSpan={layout.length + (showTotal ? 3 : 2)} scope="rowgroup">
                {card.displayName} · {tee ? `${tee.name} / ${tee.category} · personal tee` : `${defaultTeeLabel ?? 'Common tee'} · default tee`}
              </th></tr>}
              {mixed && <CourseRows layout={playerLayout} fullLayout={playerFullLayout} showTotal={showTotal} prefix={`${card.displayName} · `} />}
              <tr className={`recap-score-row${game && !ballDrop && (!matchPlay || hasMatch) ? ' recap-has-game' : ''}`}>
              <th scope="row">{onPlayerSelect ? <button type="button" className="scorecard-player-link"
                aria-label={`Open scorecard for ${card.displayName}`} onClick={() => { onPlayerSelect(card.playerId); }}>{card.displayName}</button> : card.displayName}
                {courseHandicaps && <> <CourseHandicap className="scorecard-handicap"
                  value={courseHandicap} /></>}
                {strokeHandicap.basis === 'SO' && <small className="scorecard-handicap"
                  aria-label={strokeHandicap.value == null ? 'Strokes off the low player unavailable'
                    : `Strokes off the low player: ${String(strokeHandicap.value)}`}>SO {strokeHandicap.value ?? '—'}</small>}
                {(strokeHandicap.basis === 'SO' && strokeHandicap.value == null
                  || typeof strokeHandicap.value === 'number' && strokeHandicap.value > 0 && !strokeCounts)
                  && <small className="scorecard-strokes-unavailable">Stroke dots unavailable</small>}</th>
              {playerLayout.map((hole) => {
                const score = saved.get(hole.number);
                const mark = scoreMark(score, hole.par);
                const text = score ? scoreEntryText(score) || '—' : '?';
                const contribution = score?.kind === 'strokes' ? ballDropContribution(game, card.playerId, hole.number) : undefined;
                const description = contribution ? `${contribution.teamName}: counting ${contribution.basis} ball` : undefined;
                return <td key={hole.number} className={contribution ? 'recap-counting-score' : undefined}><span className="scorecard-hole-score">
                  <span className={`score-mark ${mark.className}${text.length > 2 ? ' score-token' : ''}`}
                  title={mark.description || undefined}
                  aria-label={score ? `Hole ${String(hole.number)}: ${score.kind === 'unplayed' ? 'unplayed' : text}${mark.description ? `, ${mark.description}` : ''}` : `Hole ${String(hole.number)}: score unavailable`}>{text}</span>
                  <StrokeDots count={strokeCounts?.get(hole.number)} holeNumber={hole.number} basis={strokeHandicap.basis} />
                  </span>
                  {contribution && <span className="recap-counting-marker" aria-label={description} title={description}>
                    {contribution.basis === 'net' ? 'N' : 'G'}
                  </span>}
                </td>;
              })}
              <td className="recap-subtotal">{cardTotalText(card, layout)}</td>{showTotal && <td className="recap-subtotal">{cardTotalText(card, fullLayout)}</td>}
            </tr>
            {game && matchPlay && <MatchPlayRows game={game} card={card} players={matchPlayers} layout={layout} showTotal={showTotal} />}
            {game && !ballDrop && !matchPlay && <tr className="recap-game-row" aria-label={`${card.displayName} · ${gameDisplayName(game.definition)} ${unit}`}>
              <th scope="row" aria-label={`${card.displayName} game ${unit}`}
                title={!available ? gameUnavailableMessage(player?.strokeGame?.unavailableReason ?? player?.unavailableReason) : undefined}>
                {game.definition.kind === 'wolf' && game.definition.version === 1 ? 'DOT BALANCE' : unit === 'dots' ? 'Earned dots' : unit === 'points' ? 'Points' : unit === 'strokes' ? `${game.definition.basis === 'net' ? 'Net' : 'Gross'} strokes` : unit === 'skins' ? 'Skins' : 'Team to par'}
                {game.definition.kind === 'dots' && <small>Total includes round bonuses</small>}
                {game.definition.kind === 'churchy' && player && 'playingHandicap' in player
                  && <small>Churchie relative handicap {player.playingHandicap ?? 'unavailable'}</small>}
                {player && 'teamId' in player && <small>{player.displayName}</small>}{!available && <small>Unavailable</small>}</th>
              {layout.map((hole) => {
                const points = holePoints.get(hole.number);
                const description = !available ? 'unavailable' : typeof points === 'number' ? String(points) : 'pending';
                return <td key={hole.number} aria-label={`${card.displayName}, hole ${String(hole.number)} game ${unit}: ${description}`}>
                  {available ? points ?? '—' : '—'}
                </td>;
              })}
              <td className="recap-subtotal">{pointsTotalText(!available ? null : player.strokeGame
                ? subtotal === 'Out' ? player.strokeGame.frontTotal : player.strokeGame.backTotal
                : subtotal === 'Out' ? player.frontPoints : player.backPoints, completeNine)}</td>
              {showTotal && <td className="recap-subtotal">{pointsTotalText(available ? gameResultTotal(player) : null, player?.status === 'complete')}</td>}
            </tr>}
            </Fragment>;
          })}
          {teams.map((team) => {
            const holes = new Map(team.strokeGame?.holes.map((hole) => [hole.number, hole.value]));
            const available = team.status !== 'unavailable';
            const completeNine = layout.every((hole) => typeof holes.get(hole.number) === 'number');
            const shown = cards.filter((card) => team.playerIds.includes(card.playerId)).length;
            return <tr className="recap-game-row recap-team-row" key={team.teamId}
              aria-label={`${team.displayName} · ${game?.definition.name ?? 'Ball Drop'} team to par`}>
              <th scope="row" title={!available ? gameUnavailableMessage(team.strokeGame?.unavailableReason ?? team.unavailableReason) : undefined}>
                Ball Drop<small>{team.displayName}</small>
                {shown < team.playerIds.length && <small>{shown}/{team.playerIds.length} golfers shown</small>}
                {!available && <small>Unavailable</small>}
              </th>
              {layout.map((hole) => {
                const value = holes.get(hole.number);
                const description = !available ? 'unavailable' : typeof value === 'number' ? ballDropScoreText(value) : 'pending';
                return <td key={hole.number} aria-label={`${team.displayName}, hole ${String(hole.number)} team to par: ${description}`}>
                  {available ? ballDropScoreText(value) : '—'}
                </td>;
              })}
              <td className="recap-subtotal">{ballDropScoreText(available
                ? subtotal === 'Out' ? team.strokeGame?.frontTotal : team.strokeGame?.backTotal : null, completeNine)}</td>
              {showTotal && <td className="recap-subtotal">{ballDropScoreText(available ? team.strokeGame?.total : null, team.status === 'complete')}</td>}
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  </section>;
}
import { Fragment } from 'react';
