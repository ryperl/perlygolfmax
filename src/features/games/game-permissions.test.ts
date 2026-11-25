import { describe, expect, it } from 'vitest';
import { fictionalRoundScores } from '../../client/scoring.test-support';
import { canManageGame, canManageRoundGames } from './game-permissions';
import type { NinesGameDefinition } from '../../domain/nines';

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

  it('offers Nines for editing before the first saved score, and not after, like the other money games', () => {
    const nines: NinesGameDefinition = { id: '00000000-0000-4000-8000-000000001500', name: 'Fictional Nines',
      kind: 'nines', version: 1, basis: 'gross', groupNumber: 1,
      playerIds: fictionalRoundScores.cards.slice(0, 3).map((card) => card.playerId), stakeMinor: null };
    expect(canManageGame({ ...fictionalRoundScores, setupLocked: false }, nines)).toBe(true);
    expect(canManageGame({ ...fictionalRoundScores, setupLocked: true }, nines)).toBe(false);
  });
});
