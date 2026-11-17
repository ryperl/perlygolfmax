import type { GamePlayerResult, RoundGameResult, StrokeGameHole, StrokePlayGameDefinition } from './games.js';

function exact(value: bigint): number | null {
  return value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(value);
}

export function aggregateStrokePlayResults(
  game: StrokePlayGameDefinition, players: readonly GamePlayerResult[],
): RoundGameResult {
  return { gameId: game.id, kind: game.kind, version: 1, players: players.map((player): GamePlayerResult => {
    const holes = (player.strokeGame?.holes ?? []).map((hole): StrokeGameHole => {
      const relative = game.basis === 'gross' ? hole.grossToPar : hole.netToPar;
      const value = hole.status === 'complete' && relative !== null && hole.par !== null
        ? exact(BigInt(relative) + BigInt(hole.par)) : null;
      return { ...hole, value, countingPlayerIds: [],
        status: hole.status === 'complete' && value === null ? 'unavailable' : hole.status };
    });
    const numeric = holes.filter((hole) => hole.value !== null);
    const sum = (selected: readonly StrokeGameHole[]) => selected.length
      ? exact(selected.reduce((total, hole) => total + BigInt(hole.value ?? 0), 0n)) : null;
    const front = numeric.filter((hole) => hole.number <= 9);
    const back = numeric.filter((hole) => hole.number > 9);
    const frontTotal = sum(front);
    const backTotal = sum(back);
    const total = sum(numeric);
    const relativeToPar = numeric.length ? exact(numeric.reduce((total, hole) =>
      total + BigInt(hole.value ?? 0) - BigInt(hole.par ?? 0), 0n)) : null;
    const reason = player.unavailableReason
      ?? (holes.some((hole) => hole.status === 'unavailable')
        || numeric.length > 0 && (total === null || relativeToPar === null)
        || front.length > 0 && frontTotal === null || back.length > 0 && backTotal === null
        ? 'arithmetic-range' : holes.some((hole) => hole.status === 'ineligible') ? 'invalid-stroke-score' : undefined);
    return {
      ...player, holesScored: holes.filter((hole) => hole.grossToPar !== null).length,
      status: reason ? 'unavailable' : numeric.length === holes.length ? 'complete' : 'in-progress',
      strokeGame: { kind: game.kind, version: 1, holes, frontTotal, backTotal, total, relativeToPar,
        ...(reason ? { unavailableReason: reason } : {}) },
    };
  }) };
}
