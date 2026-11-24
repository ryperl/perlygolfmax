import { describe, expect, it } from 'vitest';
import type { GameDraft } from './game-draft';
import { buildGame, dotsDraftProblem, newGameDraft, setGameKind } from './game-draft';

const ids = ['00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000022',
  '00000000-0000-4000-8000-000000000023', '00000000-0000-4000-8000-000000000024'];
const wolfId = '00000000-0000-4000-8000-000000000031';

function dots(patch: Partial<GameDraft> = {}): GameDraft {
  return { ...setGameKind(newGameDraft(), 'dots', 4), name: 'Fictional Dots', groupNumber: 1,
    dotsPlayers: ids, dotsPlayerIds: ids, dotsSpecials: [{ kind: 'birdie', units: 1 }], ...patch };
}

describe('dotsDraftProblem', () => {
  it('reports nothing for valid drafts in each mode', () => {
    const valid = [
      dots(),
      dots({ dotsMode: 'fixed', stake: '.50' }),
      dots({ dotsMode: 'linked', linkedGameId: wolfId }),
      dots({ dotsMode: 'rotating', dotsVersion: 3, dotsRotationHoles: 6, dotsOrderMode: 'approach', dotsHighLow: true, stake: '1' }),
      dots({ dotsPlayers: [ids[0] ?? ''], dotsPlayerIds: [ids[0] ?? ''], stake: '0' }),
    ];
    for (const draft of valid) {
      expect(dotsDraftProblem(draft, ids)).toBeNull();
      expect(buildGame(draft, ids)).not.toBeNull();
    }
  });

  it.each<[string, Partial<GameDraft>, string]>([
    ['blank name', { name: '  ' }, 'Enter a game name.'],
    ['long name', { name: 'x'.repeat(257) }, '256 characters or fewer'],
    ['no golfers', { dotsPlayers: [], dotsPlayerIds: [] }, 'Choose a saved playing group.'],
    ['golfer left the round', { dotsPlayerIds: [...ids.slice(0, 3), '00000000-0000-4000-8000-000000000099'] }, 'no longer matches the round'],
    ['partners in a small group', { dotsMode: 'fixed', dotsPlayerIds: ids.slice(0, 3), dotsPlayers: ids.slice(0, 3) }, 'need a saved foursome'],
    ['version 1 rotating', { dotsMode: 'rotating', dotsVersion: 1 }, 'cannot change mode'],
    ['version 3 individual', { dotsMode: 'individual', dotsVersion: 3 }, 'cannot change mode'],
    ['zero units', { dotsSpecials: [{ kind: 'birdie', units: 0 }] }, 'whole number of dots'],
    ['duplicate special', { dotsSpecials: [{ kind: 'birdie', units: 1 }, { kind: 'birdie', units: 2 }] }, 'only once'],
    ['individual Assassin', { dotsSpecials: [{ kind: 'assassin', units: 1 }] }, 'Assassin needs partners'],
    ['standalone legacy Sweep', { dotsMode: 'fixed', dotsSpecials: [{ kind: 'sweep', units: 1 }] }, 'needs a linked Wolf game'],
    ['v2 six-hole High/Low', { dotsMode: 'rotating', dotsVersion: 2, dotsRotationHoles: 6, dotsHighLow: true }, 'only for Modified Sixes'],
    ['unlinked', { dotsMode: 'linked' }, 'Choose the earned Wolf game to link.'],
    ['bad rate', { stake: '1.234' }, 'dollars and cents'],
    ['solo with rate', { dotsPlayers: [ids[0] ?? ''], dotsPlayerIds: [ids[0] ?? ''], stake: '1' }, 'Solo Dots is stats only'],
    ['incomplete fixed teams', { dotsMode: 'fixed', dotsPlayers: [ids[0] ?? '', ids[0] ?? '', ids[2] ?? '', ids[3] ?? ''] }, 'two fixed teams'],
  ])('explains %s, which buildGame rejects', (_label, patch, message) => {
    const draft = dots(patch);
    expect(buildGame(draft, ids)).toBeNull();
    expect(dotsDraftProblem(draft, ids)).toContain(message);
  });

  it('asks for a playing group when none is chosen', () => {
    const { groupNumber, ...draft } = dots();
    void groupNumber;
    expect(buildGame(draft, ids)).toBeNull();
    expect(dotsDraftProblem(draft, ids)).toBe('Choose a saved playing group.');
  });

  it('ignores other game kinds', () => {
    expect(dotsDraftProblem({ ...newGameDraft(), name: '' }, ids)).toBeNull();
  });
});
