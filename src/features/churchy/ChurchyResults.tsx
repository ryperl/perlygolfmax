import type { ChurchyGameDefinition, ChurchyLane } from '../../domain/churchy';
import type { RoundGameResult } from '../../domain/games';
import './churchy.css';

export function ChurchyResults({ game, result }: {
  readonly game: ChurchyGameDefinition;
  readonly result: RoundGameResult | undefined;
}) {
  const receipt = result?.churchy;
  if (!receipt) return <p>Churchy results unavailable. Refresh saved scores.</p>;
  const names = (ids: readonly string[]) => ids.map((id) => result.players.find((player) => player.playerId === id)?.displayName ?? 'Golfer unavailable').join(' + ');
  const ranked = result.players.filter((player) => player.status !== 'unavailable' && player.totalPoints !== null)
    .sort((a, b) => (b.totalPoints ?? 0) - (a.totalPoints ?? 0));
  function lane(label: string, lane: ChurchyLane) {
    return `${label}: ${lane.status === 'won' ? `${names(lane.winners)} earn ${String(lane.dots)} each`
      : lane.status === 'tied' ? `tied; carry ${String(lane.carry)}` : lane.status}`;
  }
  function money(minor: number | null) {
    return minor === null ? 'Unavailable' : `$${String(Math.floor(minor / 100))}.${String(minor % 100).padStart(2, '0')}`;
  }
  return <section className="churchy-results" aria-label="Churchy Game results">
    <h3>Churchy Game · Experimental</h3>
    <p>Saved earned dots only, never netted. {receipt.status === 'complete' ? 'All holes resolved; not round finalization.'
      : receipt.status === 'unavailable' ? 'Unavailable comparisons: no final total or settlement.' : 'Provisional: pending holes are not ties.'}</p>
    <ol aria-label="Churchy standings">
      {ranked.map((player) => {
        const position = ranked.findIndex((other) => other.totalPoints === player.totalPoints) + 1;
        const tied = ranked.filter((other) => other.totalPoints === player.totalPoints).length > 1;
        return <li key={player.playerId}>{tied ? 'T' : ''}{position} · {player.displayName}: {player.totalPoints} earned dots
          {' '}· Churchy relative handicap {player.playingHandicap ?? 'unavailable'} · {player.holesScored}/{player.totalHoles} holes</li>;
      })}
    </ol>
    {result.players.filter((player) => !ranked.includes(player)).map((player) => <p key={player.playerId}>
      {player.displayName}: {player.status === 'unavailable' ? 'unavailable' : 'awaiting saved results'} · Churchy relative handicap {player.playingHandicap ?? 'unavailable'}
    </p>)}
    <h4>Planned shared pot · {money(game.amountPerDotMinor)} per dot</h4>
    <p>{receipt.status === 'complete' ? 'Planned settlement' : 'Projected known earned dots only; not final settlement'}. Nothing collected or paid. Not a place-based purse prize.</p>
    {receipt.settlement.map((entry) => <p key={entry.playerId}>{names([entry.playerId])} · Pays into pot: {money(entry.paysMinor)}
      {' '}· Collects from pot: {money(entry.collectsMinor)}</p>)}
    <p>Unawarded High carry: {receipt.unawardedHigh ?? 'uncertain'} · Unawarded Low carry: {receipt.unawardedLow ?? 'uncertain'}.
      Final tied carries are never awarded.</p>
    <details><summary>Saved hole receipts</summary>
      {receipt.holes.map((hole) => <article key={hole.number}>
        <h4>Hole {hole.number} · Stake {hole.stake}</h4>
        <p>{names(hole.pairs[0])} vs {names(hole.pairs[1])}</p>
        <p>{lane('High', hole.high)} · {lane('Low', hole.low)}</p>
        <p>Specials: {hole.specialStatus}{hole.specials.length === 0 && hole.specialStatus === 'complete' ? ' · None' : ''}</p>
        <ul>{hole.specials.map((award, index) => <li key={index}>{award.special} {award.outcome}
          {award.playerId ? ` by ${names([award.playerId])}` : ''} · {award.outcome === 'ineligible'
            ? 'No award: exact gross par required' : `${names(award.winners)} earn ${String(award.dots)} each`}</li>)}</ul>
        <p>{hole.awards.map((award) => `${names([award.playerId])}: ${award.dots === null ? 'pending/unavailable'
          : `${String(award.dots)} dots awarded${hole.dotStatus === 'complete' ? '' : ' (known awards only; incomplete)'}`}`).join(' · ')}</p>
      </article>)}
    </details>
  </section>;
}
