import type { NassauBetResult, NassauGameDefinition, NassauResults as Results } from '../../domain/nassau';

function money(value: number | null, pending = false): string {
  if (value === null) return pending ? 'Pending' : 'Unavailable';
  const magnitude = BigInt(value < 0 ? -value : value);
  return `${value < 0 ? '−' : ''}$${String(magnitude / 100n)}.${String(magnitude % 100n).padStart(2, '0')}`;
}

function betLabel(bet: NassauBetResult): string {
  return `${bet.segment === 'front' ? 'Front' : bet.segment === 'back' ? 'Back' : 'Overall'}${bet.origin === 'primary' ? '' : ` · ${bet.origin} press`}`;
}

export function NassauResults({ game, result, players = [] }: {
  readonly game: NassauGameDefinition;
  readonly result: Results | undefined;
  readonly players?: readonly { readonly playerId: string; readonly displayName: string }[];
}) {
  function playerName(id: string): string {
    const side = game.sides.find((entry) => entry.playerIds.includes(id));
    return players.find((entry) => entry.playerId === id)?.displayName
      ?? (side ? `${side.name} · golfer ${String(side.playerIds.indexOf(id) + 1)}` : 'Golfer unavailable');
  }
  return <section className="game-results" aria-label={`${game.name} matchboard`}>
    <h3>{game.name}</h3>
    <p>{game.basis === 'net' ? 'Net · 100% captured CH off the lowest within each match' : 'Gross'} · Match play · Ties push</p>
    {!result ? <p>Saved match results unavailable. Refresh to retry.</p> : <>
      <p>Saved matches · {result.status}</p>
      {result.matches.map((match) => <section key={match.id} aria-label={`${match.sideA.name} vs ${match.sideB.name}`}>
        <h4>{match.sideA.name} vs {match.sideB.name}</h4>
        <p>{match.sideA.playerIds.map(playerName).join(' + ')} vs {match.sideB.playerIds.map(playerName).join(' + ')}</p>
        <ul>{match.bets.map((bet) => {
          const parent = match.bets.find((entry) => entry.id === bet.parentBetId);
          return <li key={bet.id}>
            <strong>{betLabel(bet)}</strong> · Holes {bet.startHole}–{bet.endHole} · {bet.status === 'won'
              ? `${bet.winner === 'a' ? match.sideA.name : match.sideB.name} won` : bet.status === 'push' ? 'Push' : bet.status}
            {bet.currentPosition !== null && <> · {bet.currentPosition === 0 ? 'All square'
              : `${bet.currentPosition > 0 ? match.sideA.name : match.sideB.name} ${String(Math.abs(bet.currentPosition))} up`}</>}
            {' '}· {bet.holesResolved} resolved / {bet.remainingHoles} remaining · Stake per side {money(bet.stakeMinor)}
            {parent && <small> · Press of {betLabel(parent)} (holes {parent.startHole}–{parent.endHole})</small>}
            {bet.status === 'stale' && <strong> · Stale declaration; settlement unavailable</strong>}
            <small> · Unallocated {money(bet.settlement.unallocatedMinor, bet.settlement.status === 'pending')}</small>
          </li>;
        })}</ul>
      </section>)}
      {result.stalePresses.length > 0 && <p role="status">{result.stalePresses.length} stale press declaration(s). Saved declarations remain read-only; refresh and review match inputs.</p>}
      <section aria-label="Nassau planned settlement">
        <h4>Planned net settlement · USD</h4>
        <p>{result.settlement.status} · {result.settlement.resolvedBetCount} resolved bets · {result.settlement.pendingBetCount} pending bets</p>
        {result.settlement.status === 'partial' && <p>Partial amounts include resolved bets only, not a final settlement.</p>}
        <ul>{result.settlement.players.map((player) => <li key={player.playerId}>
          {playerName(player.playerId)} · Net {money(player.netMinor, result.settlement.status === 'pending')}
          {' · '}Pays {money(player.paysMinor, result.settlement.status === 'pending')} · Collects {money(player.collectsMinor, result.settlement.status === 'pending')}
        </li>)}</ul>
        <p>Unallocated {money(result.settlement.unallocatedMinor, result.settlement.status === 'pending')}. Planned only; no payments. Pending bets are not settled.</p>
      </section>
    </>}
  </section>;
}
