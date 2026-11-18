import type { WolfGameDefinition, WolfHoleResult } from '../../domain/wolf';

export function WolfSoloProgress({ game, holes, players }: {
  readonly game: WolfGameDefinition;
  readonly holes: readonly WolfHoleResult[] | undefined;
  readonly players: readonly { readonly playerId: string; readonly displayName: string }[];
}) {
  if (game.version !== 2 || !holes) return null;
  const solo = new Set(holes.flatMap((hole) => hole.wolfId && (hole.mode === 'blind' || hole.mode === 'pig') ? [hole.wolfId] : []));
  const remaining = game.playerIds.filter((id) => !solo.has(id));
  return <details className="game-hint" aria-label="Saved solo Wolf turns">
    <summary>Solo Wolf / PIG turns: {game.playerIds.length - remaining.length}/{game.playerIds.length}</summary>
    <p>{remaining.length === 0 ? 'Everyone has a saved solo Wolf or PIG turn.'
      : `Solo Wolf / PIG still needed: ${remaining.map((id) => players.find((player) => player.playerId === id)?.displayName ?? 'Golfer unavailable').join(', ')}.`}
    {' '}Reminder only; play is not blocked.
    </p>
  </details>;
}
