import { describe, expect, it } from 'vitest';
import { fictionalRoundScores } from '../../client/scoring.test-support';
import { canManageRoundGames } from './game-permissions';

describe('game management permissions', () => {
  it('admits only owners or explicitly capable public Quick rounds', () => {
    expect(canManageRoundGames(fictionalRoundScores)).toBe(true);
    for (const role of ['owner', 'public', 'player', 'viewer', 'tester'] as const) {
      const round = { ...fictionalRoundScores, quickRound: true as const,
        permissions: { role, writePlayerIds: [], canManageGames: true } };
      expect(canManageRoundGames(round)).toBe(role === 'owner' || role === 'public');
      expect(canManageRoundGames({ ...round, permissions: { ...round.permissions, canManageGames: false } })).toBe(false);
    }
    expect(canManageRoundGames({ ...fictionalRoundScores,
      permissions: { role: 'public', writePlayerIds: [], canManageGames: true } })).toBe(false);
  });
});
