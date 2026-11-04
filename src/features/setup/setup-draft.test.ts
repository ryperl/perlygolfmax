import { describe, expect, it } from 'vitest';
import { fictionalId, fictionalSetup, fictionalWorkspace } from '../../client/catalog.test-support';
import { inputFrom, sameRoundInput, sameSetupInput, setupProblems } from './setup-draft';

describe('setup draft presentation', () => {
  it('compares editable inputs, not scoring locks or captured-index observations', () => {
    const saved = inputFrom(fictionalWorkspace);
    expect(sameSetupInput(saved, fictionalSetup)).toBe(true);
    expect(sameSetupInput(saved, inputFrom({
      ...fictionalWorkspace,
      rounds: fictionalWorkspace.rounds.map((round) => ({ ...round, scoringStarted: true })),
    }))).toBe(true);
    expect(setupProblems(saved)).toEqual([]);
  });

  it('detects changed metadata, roster order, round count, tee and group membership', () => {
    for (const draft of [
      { ...fictionalSetup, name: 'Fictional new name' },
      { ...fictionalSetup, location: 'Fictional new location' },
      { ...fictionalSetup, playerIds: [...fictionalSetup.playerIds].reverse() },
      { ...fictionalSetup, rounds: [] },
      { ...fictionalSetup, rounds: fictionalSetup.rounds.map((round) => ({ ...round, teeProfileId: 905 })) },
      { ...fictionalSetup, rounds: fictionalSetup.rounds.map((round) => ({ ...round, groups: [] })) },
      { ...fictionalSetup, rounds: fictionalSetup.rounds.map((round) => ({
        ...round, groups: round.groups.map((group) => ({ ...group, playerIds: [...group.playerIds].reverse() })),
      })) },
    ]) expect(sameSetupInput(draft, fictionalSetup)).toBe(false);
    const round = fictionalSetup.rounds[0];
    if (!round) throw new Error('Missing fictional round.');
    expect(sameRoundInput(round, { ...round, name: 'Another fictional round' })).toBe(false);
    expect(sameRoundInput(round, { ...round, courseVersionId: 'b'.repeat(64) })).toBe(false);
  });

  it('gives specific next steps without treating optional location or unknown indices as required', () => {
    expect(setupProblems({ name: '', location: '', playerIds: [], rounds: [] })).toEqual([
      'Enter an event name.', 'Choose 4–8 players.', 'Add at least one round.',
    ]);
    expect(setupProblems({ ...fictionalSetup, location: '' })).toEqual([]);
    expect(setupProblems({
      ...fictionalSetup,
      rounds: fictionalSetup.rounds.map((round) => ({ ...round, name: '', courseId: '', courseVersionId: '', teeProfileId: 0, groups: [] })),
    })).toEqual(['Round 1: enter a round name.', 'Round 1: choose a saved course.', 'Round 1: assign 4 players to playing groups.']);
    expect(setupProblems({
      ...fictionalSetup, rounds: fictionalSetup.rounds.map((round) => ({ ...round, courseVersionId: '' })),
    })).toEqual(['Round 1: choose a published course version.']);
    expect(setupProblems({
      ...fictionalSetup, rounds: fictionalSetup.rounds.map((round) => ({ ...round, teeProfileId: 0 })),
    })).toEqual(['Round 1: choose a tee profile.']);
  });

  it('identifies unassigned players and oversized groups rather than saying setup is ready', () => {
    const playerIds = [...fictionalSetup.playerIds, fictionalId(5)];
    expect(setupProblems({ ...fictionalSetup, playerIds })).toEqual(['Round 1: assign 1 player to playing groups.']);
    expect(setupProblems({
      ...fictionalSetup, playerIds,
      rounds: fictionalSetup.rounds.map((round) => ({ ...round, groups: [{ number: 1, playerIds }] })),
    })).toEqual(['Round 1, group 1: move players to another group (maximum four).']);
    expect(setupProblems({
      ...fictionalSetup, rounds: [...fictionalSetup.rounds, ...fictionalSetup.rounds],
    })).toEqual(['Review player selections, round names, course versions, tees and group assignments.']);
  });
});
