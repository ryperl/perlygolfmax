import { describe, expect, it } from 'vitest';
import { dotsModeChange } from './dots-mode-change';
import type { DotsModeChangeOptions } from './dots-mode-change';
import type { GameDraft } from '../games/game-draft';
import { buildGame, newGameDraft, setGameKind } from '../games/game-draft';

const ids = ['00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000012',
  '00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000014'];
const allCompatible = () => true;
const options = (overrides: Partial<DotsModeChangeOptions> = {}): DotsModeChangeOptions => ({
  existing: false, smallGroup: false, v2Supported: true, v3Supported: true, compatible: allCompatible, ...overrides,
});

describe('dotsModeChange', () => {
  it('lets a group of three choose linked only when it can link to Nines', () => {
    const smallGroup = options({ smallGroup: true });
    expect(dotsModeChange({}, 'linked', smallGroup)).toBeNull();
    expect(dotsModeChange({}, 'linked', { ...smallGroup, ninesLink: true })).toMatchObject({ dotsMode: 'linked' });
    expect(dotsModeChange({}, 'fixed', { ...smallGroup, ninesLink: true })).toBeNull();
  });

  it('keeps only individual-compatible specials when linking to Nines', () => {
    const draft = { dotsSpecials: [{ kind: 'birdie', units: 1 }, { kind: 'assassin', units: 1 }] } as const;
    const compatible: DotsModeChangeOptions['compatible'] = (kind, mode) => kind !== 'assassin' || mode !== 'individual';
    const patch = dotsModeChange(draft, 'linked', options({ smallGroup: true, ninesLink: true, compatible }));
    expect(patch?.dotsSpecials).toEqual([{ kind: 'birdie', units: 1 }]);
  });

  it('starts new rotating games on version 3 with tee-flip order when supported', () => {
    expect(dotsModeChange({}, 'rotating-6', options())).toEqual({ dotsMode: 'rotating', dotsRotationHoles: 6,
      dotsVersion: 3, dotsOrderMode: 'tee-flip', dotsSpecials: [] });
  });

  it('keeps a chosen first-team method when switching between rotation lengths', () => {
    expect(dotsModeChange({ dotsMode: 'rotating', dotsVersion: 3, dotsOrderMode: 'approach' }, 'rotating-3', options()))
      .toMatchObject({ dotsVersion: 3, dotsOrderMode: 'approach', dotsRotationHoles: 3 });
  });

  it('sets version 2 explicitly when only version-2 rotation is supported, even after choosing individual first', () => {
    const individual = dotsModeChange({}, 'fixed', options({ v3Supported: false }));
    expect(individual).toMatchObject({ dotsVersion: 1 });
    const rotating = dotsModeChange({ ...individual, dotsMode: 'fixed' }, 'rotating-3', options({ v3Supported: false }));
    expect(rotating).toMatchObject({ dotsMode: 'rotating', dotsVersion: 2, dotsRotationHoles: 3 });
    expect(rotating).not.toHaveProperty('dotsOrderMode');
  });

  it('builds a saveable version-2 game after that sequence', () => {
    let draft: GameDraft = { ...setGameKind(newGameDraft(), 'dots', 4), name: 'Dots', groupNumber: 1, dotsPlayers: ids, dotsPlayerIds: ids };
    const option = options({ v3Supported: false });
    draft = { ...draft, ...dotsModeChange(draft, 'fixed', option) };
    draft = { ...draft, ...dotsModeChange(draft, 'rotating-3', option) };
    expect(buildGame(draft, ids)).toMatchObject({ kind: 'dots', version: 2, mode: 'rotating', rotationHoles: 3 });
  });

  it('turns off High/Low when a version-2 game moves to six-hole rotation', () => {
    expect(dotsModeChange({ dotsMode: 'rotating', dotsVersion: 2, dotsHighLow: true }, 'rotating-6',
      options({ existing: true, v3Supported: false }))).toMatchObject({ dotsVersion: 2, dotsHighLow: false });
  });

  it('keeps saved version-2 games on version 2 even when version 3 is supported', () => {
    expect(dotsModeChange({ dotsMode: 'rotating', dotsVersion: 2 }, 'rotating-6', options({ existing: true })))
      .toMatchObject({ dotsVersion: 2 });
  });

  it('refuses changes that saved rules or the app version do not allow', () => {
    expect(dotsModeChange({ dotsMode: 'individual', dotsVersion: 1 }, 'rotating-3', options({ existing: true }))).toBeNull();
    expect(dotsModeChange({ dotsMode: 'rotating', dotsVersion: 2 }, 'fixed', options({ existing: true }))).toBeNull();
    expect(dotsModeChange({ dotsMode: 'rotating', dotsVersion: 3 }, 'individual', options({ existing: true }))).toBeNull();
    expect(dotsModeChange({ dotsMode: 'rotating', dotsVersion: 3 }, 'rotating-6', options({ existing: true, v3Supported: false }))).toBeNull();
    expect(dotsModeChange({}, 'rotating-3', options({ v2Supported: false }))).toBeNull();
    expect(dotsModeChange({}, 'fixed', options({ smallGroup: true }))).toBeNull();
    expect(dotsModeChange({ dotsMode: 'fixed' }, 'fixed', options())).toBeNull();
    expect(dotsModeChange({}, 'unknown', options())).toBeNull();
  });

  it('drops specials that the new mode does not support and clears High/Low when leaving rotation', () => {
    const compatible: DotsModeChangeOptions['compatible'] = (kind, mode) => !(kind === 'assassin' && mode === 'individual');
    expect(dotsModeChange({ dotsMode: 'rotating', dotsHighLow: true,
      dotsSpecials: [{ kind: 'assassin', units: 1 }, { kind: 'birdie', units: 1 }] }, 'individual', options({ compatible })))
      .toEqual({ dotsMode: 'individual', dotsVersion: 1, dotsHighLow: false, dotsSpecials: [{ kind: 'birdie', units: 1 }] });
  });
});
