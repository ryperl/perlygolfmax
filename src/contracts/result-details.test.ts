import { describe, expect, it } from 'vitest';
import { isEventSkinsDetails } from './event-skins-details';
import { isPlayerWinningsBreakdown } from './winnings-breakdown';
import { calculateEventSkinsDetails } from '../domain/event-skins';
import { eventSkinsFixture } from '../domain/event-skins.test-support';
import { playerWinningsBreakdown } from '../domain/winnings-breakdown';
import { fictionalPurse } from '../../tests/smoke/purse-fixture-data';
import { purseTestId } from '../domain/purse.test-support';

describe('purpose-specific public details allowlists', () => {
  it('rejects private additions, duplicate rows and contradictory gross/net comparisons', () => {
    const f = eventSkinsFixture();
    const value = calculateEventSkinsDetails(f.workspace, f.rounds);
    expect(isEventSkinsDetails({ ...value, recordedBy: {} })).toBe(false);
    expect(isEventSkinsDetails({ ...value, players: [...value.players, ...value.players] })).toBe(false);
    expect(isEventSkinsDetails({ ...value, holes: value.holes.map((hole) => ({ ...hole, players: hole.players.map((player) => ({
      ...player, net: 999,
    })) })) })).toBe(false);
    expect(isEventSkinsDetails({ ...value, holes: value.holes.map((hole) => ({ ...hole, privateAudit: [] })) })).toBe(false);
  });
  it('rejects payout total drift, unsafe cents, fabricated skin multiplication and private history', () => {
    const value = playerWinningsBreakdown(fictionalPurse(), purseTestId(1));
    if (!value) throw new Error('Missing fixture');
    for (const invalid of [{ ...value, history: [] }, { ...value, amountMinor: 999 }, { ...value, amountMinor: 0.1 },
      { ...value, awards: value.awards.map((award) => ({ ...award, parts: [{ kind: 'event-skins', amountMinor: award.amountMinor, skins: 2, perSkinMinor: award.amountMinor }] })) }]) {
      expect(isPlayerWinningsBreakdown(invalid)).toBe(false);
    }
  });
});
