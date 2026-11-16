import { describe, expect, it } from 'vitest';
import { fictionalPurse } from '../../tests/smoke/purse-fixture-data';
import { calculatePurse } from './purse';
import { purseReviewNotices, leaderboardReviewNotices, roundReviewNotices } from './event-review';
import { calculateEventSkins } from './event-skins';
import { calculateEventStandings } from './event-leaderboard';
import { eventSkinsFixture } from './event-skins.test-support';
import { isEventReviewNotices } from '../contracts/event-review';
import { purseTestId } from './purse.test-support';

describe('actionable organizer review notices', () => {
  it('keeps distinct same-named pools visible rather than merging their discrepancies', () => {
    const value = fictionalPurse();
    const plan = { eventId: value.workspace.event.id, currency: 'USD' as const,
      funding: { kind: 'fixed' as const, budgetMinor: 200 }, pools: [1, 2].map((index) => ({
        id: purseTestId(6100 + index), name: 'Fictional shared label', source: { kind: 'manual' as const },
        awardUnit: 'pot' as const, amountMinor: 100, recipientIds: [],
      })) };
    const notices = purseReviewNotices({ ...value, configuration: { ...value.configuration, plan },
      view: { plan, resolutions: [], calculation: calculatePurse(plan, value.workspace, value.roundScores) } });
    expect(notices.filter((notice) => notice.code === 'unassigned-awards')).toHaveLength(2);
    expect(isEventReviewNotices(notices)).toBe(true);
  });
  it('does not turn normally pooled prize ties or covered skins into discrepancies', () => {
    expect(purseReviewNotices(fictionalPurse(4, undefined, [4, 5, 5, 6]))).toEqual([]);
    const f = eventSkinsFixture([{ kind: 'strokes', strokes: 4 }, { kind: 'strokes', strokes: 4 }], ['0', '0']);
    expect(leaderboardReviewNotices({ workspace: f.workspace, roundScores: f.rounds,
      standings: calculateEventStandings(f.workspace, f.rounds), eventSkins: calculateEventSkins(f.workspace, f.rounds) })).toEqual([]);
    const pending = eventSkinsFixture([{ kind: 'unplayed' }, { kind: 'unplayed' }], ['0', '0']);
    expect(leaderboardReviewNotices({ workspace: pending.workspace, roundScores: pending.rounds,
      standings: calculateEventStandings(pending.workspace, pending.rounds), eventSkins: calculateEventSkins(pending.workspace, pending.rounds) })).toEqual([]);
  });
  it('flags manual prize ties, overbudget and unavailable sources using existing canonical results', () => {
    const value = fictionalPurse(4, undefined, [4, 5, 5, 6]);
    const saved = value.configuration.plan;
    if (!saved) throw new Error('Missing fixture');
    const plan = { ...saved, funding: { kind: 'fixed' as const, budgetMinor: 1 },
      pools: saved.pools.map((pool) => 'tiePolicy' in pool ? { ...pool, tiePolicy: 'organizer' as const } : pool) };
    const view = { ...value, configuration: { ...value.configuration, plan },
      view: { plan, resolutions: [], calculation: calculatePurse(plan, value.workspace, value.roundScores) } };
    expect(purseReviewNotices(view)).toContainEqual(expect.objectContaining({ code: 'prize-tie', label: 'Fictional awards' }));
    expect(purseReviewNotices(view)).toContainEqual({ code: 'budget-exceeded', label: 'Event purse' });
    expect(isEventReviewNotices(purseReviewNotices(view))).toBe(true);
    expect(purseReviewNotices({ ...view, view: null })).toContainEqual({ code: 'unavailable-inputs', label: 'Event purse' });
  });
  it('does not flag sparse/open KP by itself or accept private fields in public notices', () => {
    const value = fictionalPurse();
    const round = value.roundScores[0];
    if (!round) throw new Error('Missing fixture');
    expect(roundReviewNotices(round, 'Fictional round')).toEqual([]);
    expect(isEventReviewNotices([{ code: 'prize-tie', label: 'Fictional pool', actor: 'private' }])).toBe(false);
    expect(isEventReviewNotices([{ code: 'unknown', label: 'Fictional pool' }])).toBe(false);
  });
});
