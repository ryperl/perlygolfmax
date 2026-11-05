import { describe, expect, it } from 'vitest';
import { fictionalRoundScores } from '../../client/scoring.test-support';
import type { ScorePermissions } from '../../domain/scoring';
import { writablePlayerIds } from './score-access';

const ids = fictionalRoundScores.cards.map((card) => card.playerId);
const permissions: ScorePermissions = { role: 'tester', writePlayerIds: ids, canManageGames: false };
describe('tester score permission targets', () => {
  it('permits every explicitly published card in the active event, without owner promotion', () => {
    expect(writablePlayerIds({ ...fictionalRoundScores, permissions })).toEqual(ids);
    expect(permissions.role).toBe('tester');
  });
  it.each([
    { ...permissions, writePlayerIds: ids.slice(1) },
    { ...permissions, writePlayerIds: [...ids, 'fictional-foreign-player'] },
    { ...permissions, writePlayerIds: [...ids.slice(1), ids[1] ?? 'fictional-missing'] },
    { ...permissions, canManageGames: true },
    { ...permissions, viewerPlayerId: ids[0] ?? 'fictional-missing' },
  ])('fails closed for mismatched explicit tester authority (%j)', (invalid) => {
    expect(writablePlayerIds({ ...fictionalRoundScores, permissions: invalid })).toEqual([]);
  });
  it('rejects archived tester writes and preserves owner/player/viewer behavior', () => {
    expect(writablePlayerIds({ ...fictionalRoundScores, permissions, eventStatus: 'archived' })).toEqual([]);
    expect(writablePlayerIds(fictionalRoundScores)).toEqual(ids);
    expect(writablePlayerIds({ ...fictionalRoundScores, permissions: { role: 'viewer', writePlayerIds: ids, canManageGames: false } })).toEqual([]);
    expect(writablePlayerIds({ ...fictionalRoundScores, permissions: {
      role: 'player', viewerPlayerId: ids[0] ?? '', writePlayerIds: ids, canManageGames: false,
    } })).toEqual(ids);
  });
});
