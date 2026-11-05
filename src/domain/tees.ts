import type { CourseHole, TeeProfile } from './catalog.js';

export interface PlayerTeeSelection {
  readonly playerId: string;
  readonly teeProfileId: number;
}

export interface PlayerTeeProfile {
  readonly playerId: string;
  readonly profile: TeeProfile;
}

export function compatibleTeeLayouts(
  common: Pick<TeeProfile, 'holeCount' | 'holes'>, selected: Pick<TeeProfile, 'holeCount' | 'holes'>,
): boolean {
  const numbers = new Set(common.holes.map((hole) => hole.number));
  return common.holeCount === selected.holeCount && common.holes.length === selected.holes.length
    && selected.holes.every((hole) => numbers.has(hole.number))
    && new Set(selected.holes.map((hole) => hole.number)).size === numbers.size;
}

export function playerTee(
  round: { readonly teeProfile: TeeProfile; readonly playerTees?: readonly PlayerTeeProfile[] },
  playerId: string,
): TeeProfile {
  return round.playerTees?.find((entry) => entry.playerId === playerId)?.profile ?? round.teeProfile;
}

export function scorecardTee(
  round: { readonly playerTees?: readonly PlayerTeeProfile[] }, playerId: string,
): TeeProfile | undefined {
  return round.playerTees?.find((entry) => entry.playerId === playerId)?.profile;
}

export function scorecardHoles(
  round: { readonly layout: readonly CourseHole[]; readonly playerTees?: readonly PlayerTeeProfile[] },
  playerId: string,
): readonly CourseHole[] {
  return scorecardTee(round, playerId)?.holes ?? round.layout;
}

export function sameTeeSelections(
  left: readonly PlayerTeeSelection[] | undefined, right: readonly PlayerTeeSelection[] | undefined,
  commonProfileId: number,
): boolean {
  const a = (left ?? []).filter((entry) => entry.teeProfileId !== commonProfileId);
  const b = (right ?? []).filter((entry) => entry.teeProfileId !== commonProfileId);
  const expected = new Map(b.map((entry) => [entry.playerId, entry.teeProfileId]));
  return a.length === b.length && a.every((entry) => expected.get(entry.playerId) === entry.teeProfileId);
}
