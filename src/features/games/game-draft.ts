import { isRoundGameDefinition, isRoundGameDefinitions } from '../../contracts/games';
import type { RoundGameDefinition, StablefordPreset } from '../../domain/games';
import { defaultHandicapAllowancePercent, maximumPointsRows } from '../../domain/games';
import { stablefordPoints } from '../../domain/stableford';

export interface GameDraft {
  readonly id: string;
  readonly name: string;
  readonly preset: StablefordPreset;
  readonly basis: 'gross' | 'net';
  readonly allowance: string;
  readonly rows: readonly { readonly scoreToPar: number; readonly points: string }[];
  readonly better: string;
  readonly worse: string;
}

export function draftFromGame(game: RoundGameDefinition): GameDraft {
  return {
    id: game.id, name: game.name, preset: game.preset, basis: game.basis,
    allowance: String(game.handicapAllowancePercent),
    rows: game.points.rows.map((row) => ({ ...row, points: String(row.points) })),
    better: String(game.points.betterScorePoints), worse: String(game.points.worseScorePoints),
  };
}

export function newGameDraft(): GameDraft {
  return draftFromGame({
    id: crypto.randomUUID(), name: 'Standard Stableford', preset: 'standard', basis: 'gross',
    handicapAllowancePercent: defaultHandicapAllowancePercent, points: stablefordPoints('standard'),
  });
}

export function setPreset(draft: GameDraft, preset: StablefordPreset): GameDraft {
  const points = stablefordPoints(preset);
  return {
    ...draft, preset,
    name: ['Standard Stableford', 'Modified Stableford'].includes(draft.name)
      ? preset === 'standard' ? 'Standard Stableford' : 'Modified Stableford' : draft.name,
    rows: points.rows.map((row) => ({ ...row, points: String(row.points) })),
    better: String(points.betterScorePoints), worse: String(points.worseScorePoints),
  };
}

function integer(text: string): number | undefined {
  if (!/^-?\d+$/.test(text)) return undefined;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : undefined;
}

export function buildGame(draft: GameDraft): RoundGameDefinition | null {
  const allowance = draft.basis === 'gross' ? defaultHandicapAllowancePercent : integer(draft.allowance);
  const better = integer(draft.better);
  const worse = integer(draft.worse);
  if (allowance === undefined || better === undefined || worse === undefined) return null;
  const rows = [];
  for (const row of draft.rows) {
    const points = integer(row.points);
    if (points === undefined) return null;
    rows.push({ scoreToPar: row.scoreToPar, points });
  }
  const game = {
    id: draft.id, name: draft.name.trim(), preset: draft.preset, basis: draft.basis,
    handicapAllowancePercent: allowance,
    points: { rows, betterScorePoints: better, worseScorePoints: worse },
  };
  return isRoundGameDefinition(game) ? game : null;
}

export function replaceGame(
  base: readonly RoundGameDefinition[], game: RoundGameDefinition,
): readonly RoundGameDefinition[] | null {
  const games = base.some((candidate) => candidate.id === game.id)
    ? base.map((candidate) => candidate.id === game.id ? game : candidate)
    : [...base, game];
  return isRoundGameDefinitions(games) ? games : null;
}

export function addBand(draft: GameDraft, side: 'better' | 'worse'): GameDraft {
  if (draft.rows.length >= maximumPointsRows) return draft;
  const edge = side === 'better' ? draft.rows[0] : draft.rows.at(-1);
  if (!edge) return draft;
  const scoreToPar = edge.scoreToPar + (side === 'better' ? -1 : 1);
  if (!Number.isSafeInteger(scoreToPar)) return draft;
  const row = { scoreToPar, points: side === 'better' ? draft.better : draft.worse };
  return { ...draft, rows: side === 'better' ? [row, ...draft.rows] : [...draft.rows, row] };
}
