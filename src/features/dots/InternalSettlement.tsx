import type { InternalGameSettlement } from '../../domain/dot-settlement';
import { formatMoney } from '../../domain/money';
import { PlayerName } from '../player-names';
import { playerInitials } from '../../domain/player-initials';
import './internal-settlement.css';

export function InternalSettlement({ settlement, gameNames = [], ranked = false, progress = [], sourceLabels = ['Base', 'Specials'], provisional = false,
  unit = 'dots' }: {
  readonly settlement: InternalGameSettlement;
  readonly gameNames?: readonly string[];
  readonly ranked?: boolean;
  readonly progress?: readonly { readonly playerId: string; readonly label: string }[];
  readonly sourceLabels?: readonly [string, string];
  readonly provisional?: boolean;
  /** What the game counts: Dots and Wolf earn dots; Nines earns points. */
  readonly unit?: 'dots' | 'points';
}) {
  const singular = unit === 'dots' ? 'dot' : 'point';
  const money = (minor: number | null) => minor === null ? 'Unavailable' : minor > 0 ? `Due ${formatMoney(minor, 'USD')}`
    : minor < 0 ? `Owes ${formatMoney(-minor, 'USD')}` : formatMoney(0, 'USD');
  const name = (id: string) => settlement.players.find((player) => player.playerId === id)?.displayName ?? 'Golfer unavailable';
  const pointsOnly = settlement.status === 'points-only';
  const sources = gameNames.join(' + ');
  const players = ranked ? [...settlement.players].sort((a, b) => a.totalDots === null ? b.totalDots === null ? 0 : 1
    : b.totalDots === null ? -1 : b.totalDots - a.totalDots) : settlement.players;
  // Number golfers with identical names in the order shown, which is the ranked order when ranked.
  const initials = playerInitials(players);
  const total = settlement.players.every((player) => player.totalDots !== null)
    ? settlement.players.reduce((sum, player) => sum + BigInt(player.totalDots ?? 0), 0n) : null;
  const [baseLabel, specialLabel] = sourceLabels;
  return <section className="game-results internal-settlement" aria-label={`Group ${String(settlement.groupNumber)} ${sources ? `${sources} ` : ''}internal settlement`}>
    <h3>Group {settlement.groupNumber}{sources && ` · ${sources}`}{ranked && ' · Combined standings'}</h3>
    <p className="internal-settlement-status">{pointsOnly ? `${settlement.players.length === 1 ? 'Solo stats only · No money' : 'No money configured · Points-only'}${provisional ? ' · Provisional' : ''}` : settlement.status === 'complete' ? 'Planned settlement · Not paid'
      : settlement.status === 'unavailable' ? 'Settlement unavailable' : 'Provisional settlement · Not paid'}</p>
    <div role="region" aria-label={`Combined earned ${unit} and planned money`}>
      <ol className="internal-settlement-list" aria-label={ranked ? 'Combined standings'
        : pointsOnly && settlement.players.length === 1 ? 'Solo earned dots' : 'Individual net settlement'}>
        {players.map((player) => {
          const canRank = ranked && settlement.status !== 'unavailable' && player.totalDots !== null;
          const position = canRank ? players.findIndex((other) => other.totalDots === player.totalDots) + 1 : null;
          const tied = canRank && players.filter((other) => other.totalDots === player.totalDots).length > 1;
          const progressLabel = progress.find((entry) => entry.playerId === player.playerId)?.label;
          return <li key={player.playerId} className={ranked ? 'internal-ranked' : undefined}><details>
            <summary>
              {ranked && <span className="internal-settlement-position" aria-label={position === null ? 'Unranked'
                : `${tied ? 'Tied position' : 'Position'} ${String(position)}`}>{position === null ? '—' : `${tied ? 'T' : ''}${String(position)}`}</span>}
              <span>
                <span className="internal-settlement-name">
                  <PlayerName name={player.displayName} initials={initials.get(player.playerId)} /></span>
                <span className="internal-settlement-points">{player.totalDots ?? '—'} {unit}</span>
                {(gameNames.length > 1 || player.baseDots !== 0 && player.specialDots !== 0)
                  && <small className="internal-settlement-source">{baseLabel} {player.baseDots ?? '—'} + {specialLabel} {player.specialDots ?? '—'}</small>}
                {progressLabel && <small className="internal-settlement-source">{progressLabel}</small>}
              </span>
              <strong className="internal-settlement-money">{pointsOnly ? 'Points-only' : money(settlement.status === 'unavailable' ? null : player.netMinor)}</strong>
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m3 6 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
            </summary>
            <div className="internal-settlement-calculation">
              <p>{pointsOnly ? `Earned ${unit} only; no money configured.` : `How calculated · One net amount across the ${settlement.players.length === 4 ? 'foursome' : `${String(settlement.players.length)} players`}.`}</p>
              {!pointsOnly && settlement.status !== 'unavailable' && total !== null && player.totalDots !== null && settlement.stakeMinor !== null
                && player.netMinor !== null && <p>({settlement.players.length} × {player.totalDots} − {String(total)}) × {formatMoney(settlement.stakeMinor, 'USD')}
                  {' = '}{money(player.netMinor)}</p>}
              {!pointsOnly && <ul>{settlement.pairwise.filter((pair) => pair.fromPlayerId === player.playerId || pair.toPlayerId === player.playerId)
                .map((pair, index) => <li key={index}>{pair.fromPlayerId === player.playerId ? 'Behind' : 'Ahead of'} {
                  name(pair.fromPlayerId === player.playerId ? pair.toPlayerId : pair.fromPlayerId)}: {formatMoney(pair.amountMinor, 'USD')}</li>)}</ul>}
              {!pointsOnly && <p>Comparisons explain this net amount, not additional payments.</p>}
            </div>
          </details></li>;
        })}
      </ol>
    </div>
    {!pointsOnly && <details className="internal-settlement-method"><summary>Rate and settlement method</summary>
      <p>{gameNames.length > 1 ? 'One combined settlement for these explicitly linked games.'
        : 'Independent game settlement; other unlinked games settle separately.'}</p>
      <p>{settlement.stakeMinor === null ? 'Rate unavailable.' : `${formatMoney(settlement.stakeMinor, 'USD')} per ${singular} difference against each other golfer.`}</p>
      <p>Total to settle: {settlement.totalToSettleMinor === null ? 'Unavailable' : formatMoney(settlement.totalToSettleMinor, 'USD')}
        {settlement.status !== 'complete' && ' · Provisional'}</p>
    </details>}
  </section>;
}
