import type { ChurchyGameDefinition } from '../../domain/churchy';
import type { RoundGameResult } from '../../domain/games';
import { DotSpecialReviewNotice, InternalSettlement } from '../dots';
import { gameDisplayName } from '../games';
import './churchy.css';

export function ChurchyResults({ game, result }: {
  readonly game: ChurchyGameDefinition;
  readonly result: RoundGameResult | undefined;
}) {
  const receipt = result?.churchy;
  const name = gameDisplayName(game);
  if (!receipt) return <p>Churchie results unavailable. Refresh saved scores.</p>;
  const names = (ids: readonly string[]) => ids.map((id) => result.players.find((player) => player.playerId === id)?.displayName ?? 'Golfer unavailable').join(' + ');
  const ranked = result.players.filter((player) => player.status !== 'unavailable' && player.totalPoints !== null)
    .sort((a, b) => (b.totalPoints ?? 0) - (a.totalPoints ?? 0));
  function money(minor: number | null) {
    return minor === null ? 'Unavailable' : `$${String(Math.floor(minor / 100))}.${String(minor % 100).padStart(2, '0')}`;
  }
  return <section className="churchy-results" aria-label={`${name} · Group ${String(game.groupNumber)} results`}>
    <h3>{name} · Group {game.groupNumber}</h3>
    <p>{game.handicapRule === 'full-course-v1' ? 'Full captured CH' : 'SO off lowest in saved group'} · Specials use personal gross.</p>
    <p>{receipt.status === 'complete' ? 'Saved earned dots'
      : receipt.status === 'unavailable' ? 'Unavailable comparisons: no final total or settlement.' : 'Provisional: pending holes are not ties.'}</p>
    <DotSpecialReviewNotice reviews={receipt.reviewRequired} players={result.players} />
    {game.version === 3 && game.orderMode === 'approach' && !receipt.order && <p className="game-hint">
      Partner order is not saved. Choose the approach order on hole {receipt.holes[0]?.number ?? '—'} in score entry.
    </p>}
    {game.version === 1 && <ol aria-label="Churchie standings">
      {ranked.map((player) => {
        const position = ranked.findIndex((other) => other.totalPoints === player.totalPoints) + 1;
        const tied = ranked.filter((other) => other.totalPoints === player.totalPoints).length > 1;
        return <li key={player.playerId}>{tied ? 'T' : ''}{position} · {player.displayName}: {player.totalPoints} earned dots
          {' '}· Churchie relative handicap {player.playingHandicap ?? 'unavailable'} · {player.holesScored}/{player.totalHoles} holes</li>;
      })}
    </ol>}
    {game.version === 1 && result.players.filter((player) => !ranked.includes(player)).map((player) => <p key={player.playerId}>
      {player.displayName}: {player.status === 'unavailable' ? 'unavailable' : 'awaiting saved results'} · Churchie relative handicap {player.playingHandicap ?? 'unavailable'}
    </p>)}
    {game.version !== 1 ? receipt.internalSettlement && result.version === game.version
      ? <InternalSettlement settlement={receipt.internalSettlement} gameNames={[name]} ranked
        provisional={receipt.status !== 'complete'}
        progress={result.players.map((player) => ({ playerId: player.playerId,
          label: `${String(player.holesScored)}/${String(player.totalHoles)} holes · ${game.handicapRule === 'full-course-v1' ? 'CH' : 'SO'} ${String(player.playingHandicap ?? 'unavailable')}`,
        }))} />
      : <p>Planned settlement unavailable. Refresh saved scores.</p> : <>
    <h4>Planned shared pot · {money(game.amountPerDotMinor)} per dot</h4>
    <p>{receipt.status === 'complete' ? 'Planned settlement' : 'Projected known earned dots only; not final settlement'}. Nothing collected or paid. Not a place-based purse prize.</p>
    {receipt.settlement.map((entry) => <p key={entry.playerId}>{names([entry.playerId])} · Pays into pot: {money(entry.paysMinor)}
      {' '}· Collects from pot: {money(entry.collectsMinor)}</p>)}
    </>}
    {(receipt.unawardedHigh !== 0 || receipt.unawardedLow !== 0) && <p>Unawarded High carry: {receipt.unawardedHigh ?? 'uncertain'} ·
      Low carry: {receipt.unawardedLow ?? 'uncertain'}. Final tied carries are not awarded.</p>}
  </section>;
}
