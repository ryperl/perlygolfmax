import { describe, expect, it } from 'vitest';
import { fictionalPurse } from '../../tests/smoke/purse-fixture-data';
import { playerWinningsBreakdown } from './winnings-breakdown';
import { publicPurseSummary } from './public-purse';
import { purseTestId } from './purse.test-support';
import { isPlayerWinningsBreakdown } from '../contracts/winnings-breakdown';
import { calculatePurse } from './purse';
import { eventSkinsFixture } from './event-skins.test-support';

describe('public player winnings explanation', () => {
  it('explains exact pooled-place shares and zero winnings without editing or private audit metadata', () => {
    const value = fictionalPurse(4, undefined, [4, 5, 5, 6]);
    const detail = playerWinningsBreakdown(value, purseTestId(2));
    expect(detail).toMatchObject({ amountMinor: 25, awards: [{ amountMinor: 25,
      parts: [{ kind: 'place', rank: 2, tiedEntrants: 2, tiePolicy: 'pooled', memberCount: 1 }] }] });
    expect(isPlayerWinningsBreakdown(detail)).toBe(true);
    expect(detail?.amountMinor).toBe(publicPurseSummary(value).players[1]?.amountMinor);
    expect(playerWinningsBreakdown(value, purseTestId(4))).toMatchObject({ amountMinor: 0, awards: [] });
    expect(playerWinningsBreakdown(value, purseTestId(999))).toBeNull();
    expect(JSON.stringify(detail)).not.toMatch(/recordedBy|measurementId|etag|handicap|cards|operation|resolutions/);
  });
  it('attributes team prizes to their actual saved members', () => {
    const value = fictionalPurse(4, 'two-net-aggregate', [4, 4, 5, 5]);
    const detail = playerWinningsBreakdown(value, purseTestId(1));
    expect(detail).toMatchObject({ amountMinor: 50, awards: [{ parts: [
      { kind: 'place', amountMinor: 50, teamName: 'Fictional team 1', memberCount: 2 },
    ] }] });
    expect(isPlayerWinningsBreakdown(detail)).toBe(true);
  });
  it('derives skins count and unit cents from the canonical awarded pot and retains rounding', () => {
    const f = eventSkinsFixture([{ kind: 'strokes', strokes: 3 }, { kind: 'strokes', strokes: 5 }], ['0', '0'], 3);
    const plan = { eventId: f.workspace.event.id, currency: 'USD' as const, funding: { kind: 'fixed' as const, budgetMinor: 10000 },
      pools: [{ id: purseTestId(6000), name: 'Fictional skins', source: { kind: 'event-skins' as const, version: 1 as const },
        awardUnit: 'pot' as const, amountMinor: 10000 }] };
    const value = { workspace: f.workspace, roundScores: f.rounds,
      configuration: { eventId: plan.eventId, etag: null, plan, resolutions: [] },
      view: { plan, resolutions: [], calculation: calculatePurse(plan, f.workspace, f.rounds) } };
    const detail = playerWinningsBreakdown(value, purseTestId(1));
    expect(detail).toMatchObject({ amountMinor: 9999, awards: [{ parts: [
      { kind: 'event-skins', amountMinor: 9999, skins: 3, perSkinMinor: 3333 },
    ] }] });
    expect(isPlayerWinningsBreakdown(detail)).toBe(true);
  });
  it('never promotes provisional shares to allocated winnings or unavailable totals to zero', () => {
    const value = fictionalPurse();
    if (!value.view) throw new Error('Missing fixture');
    const pending = { ...value, view: { ...value.view, calculation: { ...value.view.calculation,
      pools: value.view.calculation.pools.map((pool) => ({ ...pool, status: 'projected' as const })) } } };
    expect(playerWinningsBreakdown(pending, purseTestId(1))).toMatchObject({ amountMinor: 0, awards: [], pendingPools: 1 });
    const unavailable = playerWinningsBreakdown({ ...value, view: null }, purseTestId(1));
    expect(unavailable).toMatchObject({ amountMinor: null, needsReview: true, awards: [] });
  });
});
