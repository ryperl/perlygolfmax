import { describe, expect, it } from 'vitest';
import { fictionalId, fictionalSetup, fictionalWorkspace } from '../../client/catalog.test-support';
import { inputFrom, sameRoundInput, sameSetupInput, setupProblems } from './setup-draft';

describe('setup draft presentation', () => {
  it.each([1, 2, 3])('allows a complete %i-player event draft without placeholder golfers', (count) => {
    const playerIds = fictionalSetup.playerIds.slice(0, count);
    const draft = { ...fictionalSetup, playerIds, rounds: fictionalSetup.rounds.map((round) => ({
      ...round, groups: [{ number: 1, playerIds }],
    })) };
    expect(setupProblems(draft)).toEqual([]);
    expect(setupProblems({ ...draft, playerIds: [] })).toContain('Choose at least one player.');
  });
  it('preserves explicit permission and sparse personal tees through captured round drafts and detects changed assignments', () => {
    const round = fictionalWorkspace.rounds[0];
    if (!round) throw new Error('Missing fictional round.');
    const workspace = { ...fictionalWorkspace, allowPerGolferTees: true, rounds: [{
      ...round, playerTees: [{ playerId: fictionalId(1), profile: { ...round.teeProfile, id: 990 } }],
    }] };
    const draft = inputFrom(workspace);
    expect(draft.allowPerGolferTees).toBe(true);
    expect(draft.rounds[0]?.playerTeeSelections).toEqual([{ playerId: fictionalId(1), teeProfileId: 990 }]);
    expect(sameSetupInput(draft, { ...draft, allowPerGolferTees: false })).toBe(false);
    const first = draft.rounds[0];
    if (!first) throw new Error('Missing fictional round input.');
    expect(sameRoundInput(first, { ...first, playerTeeSelections: [] })).toBe(false);
    expect(inputFrom(fictionalWorkspace).allowPerGolferTees).toBe(false);
  });
  it('uses explicit null for disabled saves, preserves saved competition and compares bindings without order sensitivity', () => {
    const disabled = inputFrom(fictionalWorkspace);
    expect(disabled.overallCompetition).toBeNull();
    const competition = { kind: 'stableford', credit: 'team', roundGames: [
      { roundId: fictionalId(70), gameId: fictionalId(500) }, { roundId: fictionalId(71), gameId: fictionalId(501) },
    ] } as const;
    const enabled = inputFrom({ ...fictionalWorkspace, overallCompetition: competition });
    expect(enabled.overallCompetition).toEqual(competition);
    expect(sameSetupInput(disabled, enabled)).toBe(false);
    expect(sameSetupInput(enabled, { ...enabled, overallCompetition: { ...competition, roundGames: [...competition.roundGames].reverse() } })).toBe(true);
    expect(sameSetupInput(enabled, { ...enabled, overallCompetition: { ...competition, credit: 'individual' } })).toBe(false);
    expect(sameSetupInput(disabled, { ...disabled, overallCompetition: { kind: 'stroke-play', basis: 'gross' } })).toBe(false);
    expect(setupProblems({ ...enabled, overallCompetition: { kind: 'stroke-play', basis: 'net', handicapAllowancePercent: 0 } }))
      .toContain('Review the overall competition settings. Net allowance must be a whole percentage from 1 to 100.');
  });
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
      'Enter an event name.', 'Choose at least one player.', 'Add at least one round.',
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
