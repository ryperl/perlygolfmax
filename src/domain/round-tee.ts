import type { TeeProfile } from './catalog.js';

export type RoundSide = 'full' | 'front' | 'back';

export function roundTee(tee: TeeProfile, side: RoundSide = 'full'): TeeProfile | undefined {
  if (side === 'full') return tee;
  if (tee.holeCount !== 18 || tee.holes.length !== 18) return undefined;
  const first = side === 'front' ? 1 : 10;
  const holes = tee.holes.filter((hole) => hole.number >= first && hole.number < first + 9)
    .sort((a, b) => a.number - b.number);
  const rating = tee.ratings.find((entry) => entry.type === (side === 'front' ? 'Front' : 'Back'));
  if (holes.length !== 9 || !rating) return undefined;
  const ranked = [...holes].sort((a, b) => a.allocation - b.allocation);
  const yards = holes.reduce((sum, hole) => sum + hole.length, 0);
  return {
    ...tee, holeCount: 9, totalYardage: yards, totalMeters: Math.round(yards * 0.9144),
    totalPar: holes.reduce((sum, hole) => sum + hole.par, 0),
    ratings: tee.ratings.map((entry) => entry.type === 'Total' ? { ...rating, type: 'Total' } : entry),
    holes: holes.map((hole) => ({ ...hole, allocation: ranked.findIndex((entry) => entry.number === hole.number) + 1 })),
  };
}
