import type { NassauBetResult, PressMatchGameDefinition, NassauResults as Results } from '../../domain/nassau';

function money(value: number | null, pending = false): string {
  if (value === null) return pending ? 'Pending' : 'Unavailable';
  const magnitude = BigInt(value < 0 ? -value : value);
  return `${value < 0 ? '−' : ''}$${String(magnitude / 100n)}.${String(magnitude % 100n).padStart(2, '0')}`;
}

function betLabel(bet: NassauBetResult, single: boolean): string {
  return `${single ? 'Match' : bet.segment === 'front' ? 'Front' : bet.segment === 'back' ? 'Back' : 'Overall'}${bet.origin === 'primary' ? '' : ` · ${bet.origin} press`}`;
}

export function NassauResults({ game, result, players = [] }: {
  readonly game: PressMatchGameDefinition;
  readonly result: Results | undefined;
  readonly players?: readonly { readonly playerId: string; readonly displayName: string }[];
}) {
  function playerName(id: string): string {
    const side = game.sides.find((entry) => entry.playerIds.includes(id));
    return players.find((entry) => entry.playerId === id)?.displayName
      ?? (side ? `${side.name} · golfer ${String(side.playerIds.indexOf(id) + 1)}` : 'Golfer unavailable');
  }
  function netMoney(value: number | null, pending: boolean): string {
    if (value === null) return pending ? 'Pending' : 'Unavailable';
    return value > 0 ? `Due ${money(value)}` : value < 0 ? `Owes ${money(-value)}` : money(0);
  }
  return <section className="game-results" aria-label={`${game.name} matchboard`}>
    <h3>{game.name}</h3>
    <p>{game.basis !== 'net' ? 'Gross' : game.handicapRule === 'full-course-v1' ? 'Net · Full captured CH'
      : game.handicapRule === 'group-low-v1' ? 'Net · SO off lowest in saved group'
        : 'Net · 100% captured CH off the lowest within each match'} · Match play · Ties push</p>
    {!result ? <p>Saved match results unavailable. Refresh to retry.</p> : <>
      <p>Saved matches · {result.status}</p>
      <section aria-label={`${game.kind === 'match-play' ? 'Match Play' : 'Nassau'} planned settlement`}>
        <h4>Planned net settlement · USD</h4>
        <p>{result.settlement.status} · {result.settlement.resolvedBetCount} resolved bets · {result.settlement.pendingBetCount} pending bets</p>
        {result.settlement.status === 'partial' && <p>Partial amounts include resolved bets only, not a final settlement.</p>}
        <ul className="game-net-list">{result.settlement.players.map((player) => <li key={player.playerId}>
          <span>{playerName(player.playerId)}</span><strong>{netMoney(player.netMinor, result.settlement.status === 'pending')}</strong>
        </li>)}</ul>
        {(result.settlement.unallocatedMinor !== 0 || result.settlement.status !== 'complete') && <p>
          Unallocated {money(result.settlement.unallocatedMinor, result.settlement.status === 'pending')}. Pending bets are not settled.
        </p>}
        <p className="game-hint">Planned only · Not paid</p>
      </section>
      {result.matches.map((match) => <section key={match.id} aria-label={`${match.sideA.name} vs ${match.sideB.name}`}>
        <h4>{match.sideA.name} vs {match.sideB.name}</h4>
        <p>{match.sideA.playerIds.map(playerName).join(' + ')} vs {match.sideB.playerIds.map(playerName).join(' + ')}</p>
        <ul>{match.bets.map((bet) => {
          const parent = match.bets.find((entry) => entry.id === bet.parentBetId);
          return <li key={bet.id} className="nassau-bet"><details><summary>
            <strong>{betLabel(bet, game.kind === 'match-play')}</strong> · {bet.status === 'won'
              ? `${bet.winner === 'a' ? match.sideA.name : match.sideB.name} won` : bet.status === 'push' ? 'Push' : bet.status}
            {bet.currentPosition !== null && <> · {bet.currentPosition === 0 ? 'All square'
              : `${bet.currentPosition > 0 ? match.sideA.name : match.sideB.name} ${String(Math.abs(bet.currentPosition))} up`}</>}
            {bet.status === 'stale' && <strong> · Review required</strong>}
            </summary>
            <p>{game.kind === 'match-play' ? `Starts hole ${String(bet.startHole)} · Ends hole ${String(bet.endHole)}`
              : `Holes ${String(bet.startHole)}–${String(bet.endHole)}`} · {bet.holesResolved} resolved / {bet.remainingHoles} remaining · Stake per side {money(bet.stakeMinor)}</p>
            {parent && <small> · Press of {betLabel(parent, game.kind === 'match-play')} (holes {parent.startHole}–{parent.endHole})</small>}
            {bet.status === 'stale' && <strong> · Stale declaration; settlement unavailable</strong>}
            <small> · Unallocated {money(bet.settlement.unallocatedMinor, bet.settlement.status === 'pending')}</small>
          </details></li>;
        })}</ul>
      </section>)}
      {result.stalePresses.length > 0 && <p role="status">{result.stalePresses.length} stale press declaration(s). Saved declarations remain read-only; refresh and review match inputs.</p>}
    </>}
  </section>;
}
