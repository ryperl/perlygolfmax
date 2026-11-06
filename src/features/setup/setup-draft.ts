import { boundedText, isCourseId, isVersionId } from '../../contracts/catalog';
import { isEventSetupInput, isOverallCompetition } from '../../contracts/setup';
import type { EventSetupInput, EventWorkspace, RoundSetupInput, RoundSnapshot } from '../../domain/setup';
import { sameOverallCompetition } from '../../domain/setup';
import { sameTeeSelections } from '../../domain/tees';

export function roundInput(round: RoundSnapshot): RoundSetupInput {
  return {
    id: round.id, name: round.name, courseId: round.courseId, courseVersionId: round.courseVersionId,
    teeProfileId: round.teeProfile.id, groups: round.groups,
    playerTeeSelections: (round.playerTees ?? []).map((entry) => ({ playerId: entry.playerId, teeProfileId: entry.profile.id })),
  };
}

export function inputFrom(workspace: EventWorkspace): EventSetupInput {
  return {
    name: workspace.event.name, location: workspace.location,
    playerIds: workspace.roster.map((player) => player.playerId),
    rounds: workspace.rounds.map(roundInput),
    overallCompetition: workspace.overallCompetition ?? null,
    allowPerGolferTees: workspace.allowPerGolferTees ?? false,
  };
}

export function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function sameRoundInput(left: RoundSetupInput, right: RoundSetupInput): boolean {
  return left.id === right.id && left.name === right.name && left.courseId === right.courseId
    && left.courseVersionId === right.courseVersionId && left.teeProfileId === right.teeProfileId
    && sameTeeSelections(left.playerTeeSelections, right.playerTeeSelections, left.teeProfileId)
    && left.groups.length === right.groups.length && left.groups.every((group, index) => {
      const other = right.groups[index];
      return other !== undefined && group.number === other.number
        && (group.startingHole ?? 1) === (other.startingHole ?? 1) && sameIds(group.playerIds, other.playerIds);
    });
}

export function sameSetupInput(left: EventSetupInput, right: EventSetupInput): boolean {
  return left.name === right.name && left.location === right.location && sameIds(left.playerIds, right.playerIds)
    && (left.allowPerGolferTees ?? false) === (right.allowPerGolferTees ?? false)
    && sameOverallCompetition(left.overallCompetition, right.overallCompetition)
    && left.rounds.length === right.rounds.length
    && left.rounds.every((round, index) => {
      const other = right.rounds[index];
      return other !== undefined && sameRoundInput(round, other);
    });
}

export function setupProblems(draft: EventSetupInput): readonly string[] {
  const problems: string[] = [];
  if (draft.overallCompetition != null && !isOverallCompetition(draft.overallCompetition)) {
    problems.push('Review the overall competition settings. Net allowance must be a whole percentage from 1 to 100.');
  }
  if (!boundedText(draft.name)) problems.push('Enter an event name.');
  if (draft.location !== '' && !boundedText(draft.location, 200)) problems.push('Review the general location.');
  if (draft.playerIds.length < 1) problems.push('Choose at least one player.');
  if (draft.rounds.length === 0) problems.push('Add at least one round.');
  for (const [index, round] of draft.rounds.entries()) {
    const label = `Round ${String(index + 1)}`;
    if (!boundedText(round.name)) problems.push(`${label}: enter a round name.`);
    if (!isCourseId(round.courseId)) problems.push(`${label}: choose a saved course.`);
    else if (!isVersionId(round.courseVersionId)) problems.push(`${label}: choose a published course version.`);
    else if (!Number.isSafeInteger(round.teeProfileId) || round.teeProfileId <= 0) problems.push(`${label}: choose a tee profile.`);
    const unassigned = draft.playerIds.filter((id) => !round.groups.some((group) => group.playerIds.includes(id)));
    if (unassigned.length > 0) problems.push(`${label}: assign ${String(unassigned.length)} ${unassigned.length === 1 ? 'player' : 'players'} to playing groups.`);
    for (const group of round.groups) {
      if (group.startingHole !== undefined && (!Number.isSafeInteger(group.startingHole) || group.startingHole < 1 || group.startingHole > 18)) {
        problems.push(`${label}, group ${String(group.number)}: choose a starting hole from 1 to 18.`);
      }
      if (group.playerIds.length > 4) problems.push(`${label}, group ${String(group.number)}: move players to another group (maximum four).`);
    }
  }
  return isEventSetupInput(draft) ? [] : problems.length > 0 ? problems
    : ['Review player selections, round names, course versions, tees and group assignments.'];
}
