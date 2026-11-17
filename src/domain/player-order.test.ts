import { describe, expect, it } from 'vitest';
import { comparePlayerNames } from './player-order';

describe('player display ordering', () => {
  it('orders by surname rather than first name, ignoring case and retaining deterministic full-name/ID ties', () => {
    const players = [
      { id: 'z', displayName: 'Amy Baker' }, { id: 'b', displayName: 'Zoe adams' },
      { id: 'y', displayName: 'Aaron Baker' }, { id: 'a', displayName: 'Zoe adams' },
    ];
    const before = structuredClone(players);
    expect([...players].sort(comparePlayerNames).map((player) => player.id)).toEqual(['a', 'b', 'y', 'z']);
    expect(players).toEqual(before);
  });

  it('supports single names, hyphenated surnames, Last, First notation and generational suffixes', () => {
    const displayNames = ['Avery Smith-Jones', 'Zoe Adams Jr.', 'Morgan', 'Cruz, Ana', 'Ryan Baker, Sr.', 'Alex Young III'];
    expect(displayNames.map((displayName) => ({ id: displayName, displayName })).sort(comparePlayerNames)
      .map((player) => player.displayName)).toEqual([
      'Zoe Adams Jr.', 'Ryan Baker, Sr.', 'Cruz, Ana', 'Morgan', 'Avery Smith-Jones', 'Alex Young III',
    ]);
  });
});
