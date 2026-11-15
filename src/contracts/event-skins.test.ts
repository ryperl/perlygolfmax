import { describe, expect, it } from 'vitest';
import { isEventSkinsChange, isEventSkinsConfiguration, isEventSkinsResults } from './event-skins.js';
import { isEventLeaderboardView } from './event-leaderboard.js';
import { isEventWorkspace } from './setup.js';
import { isPursePlan } from './purse.js';
import { calculateEventSkins } from '../domain/event-skins.js';
import { calculateEventStandings } from '../domain/event-leaderboard.js';
import { eventSkinsFixture, withoutEventSkins } from '../domain/event-skins.test-support.js';
import { purseTestId } from '../domain/purse.test-support.js';
import { publishedCourseHandicaps } from '../domain/playing-handicaps.js';
import { isRoundGameDefinition } from './games.js';
import { isRoundScores } from './scoring.js';

export function eventSkinsView() {
  const f = eventSkinsFixture();
  return { workspace: f.workspace, roundScores: f.rounds,
    standings: calculateEventStandings(f.workspace, f.rounds), eventSkins: calculateEventSkins(f.workspace, f.rounds) };
}
describe('event skins network boundary', () => {
  it('accepts a recomputed complete raw-score context and optional older unconfigured envelopes', () => {
    const value = eventSkinsView();
    expect(isEventWorkspace(value.workspace)).toBe(true);
    expect(isEventLeaderboardView(value)).toBe(true);
    const workspace = withoutEventSkins(value.workspace);
    expect(isEventLeaderboardView({ workspace, roundScores: [], standings: calculateEventStandings(workspace, []) })).toBe(true);
    expect(isEventLeaderboardView({ ...value, eventSkins: undefined })).toBe(false);
  });
  it('recomputes winners/counts from saved strokes and captured inputs, not reported ranks or points', () => {
    const value = eventSkinsView();
    expect(isEventSkinsResults({ ...value.eventSkins, awardedSkins: 99 }, value.workspace, value.roundScores)).toBe(false);
    expect(isEventLeaderboardView({ ...value, eventSkins: { ...value.eventSkins, status: 'final' } })).toBe(false);
    expect(isEventLeaderboardView({ ...value, eventSkins: { ...value.eventSkins, extra: true } })).toBe(false);
    expect(isEventLeaderboardView({ ...value, extra: true })).toBe(false);
    expect(isEventLeaderboardView({ ...value, roundScores: [...value.roundScores, ...value.roundScores] })).toBe(false);
    expect(isEventLeaderboardView({ ...value, roundScores: value.roundScores.map((round) => ({
      ...round, eventId: purseTestId(999), cards: round.cards.map((card) => ({ ...card, playerId: purseTestId(998) })),
    })) })).toBe(false);
  });
  it('allows scalar-only public and derived legacy account projections without leaking observations; tester access is excluded', () => {
    const value = eventSkinsView();
    const workspace = { ...value.workspace, publicAccess: true as const, canViewScores: true,
      event: { ...value.workspace.event, role: 'viewer' as const },
      rounds: value.workspace.rounds.map((round) => ({
        ...round, players: round.players.map(({ handicapIndex, ...player }) => ({
          ...player, handicapIndexValue: handicapIndex?.value ?? null,
        })),
      })) };
    const roundScores = value.roundScores.map((round) => ({
      ...round, permissions: { role: 'public' as const, canManageGames: false, writePlayerIds: round.cards.map((card) => card.playerId) },
      courseHandicaps: workspace.rounds.flatMap(publishedCourseHandicaps),
    }));
    expect(isEventLeaderboardView({ ...value, workspace, roundScores,
      eventSkins: calculateEventSkins(workspace, roundScores) })).toBe(true);
    const tester = { ...workspace, publicAccess: undefined, testerAccess: true as const };
    expect(isEventLeaderboardView({ ...value, workspace: tester, roundScores })).toBe(false);
  });
  it('rejects malformed configuration/status/role/purse JSON without coercion or exceptions', () => {
    for (const bad of [null, [], {}, '1', 1, { version: '1' }, { version: 2 }, { version: 1, enabled: true },
      { version: { toString: null } }]) expect(isEventSkinsConfiguration(bad)).toBe(false);
    expect(isEventSkinsConfiguration({ version: 1 })).toBe(true);
    const value = eventSkinsView();
    for (const bad of [null, {}, { toString: null }, 'final', 4]) {
      expect(() => isEventLeaderboardView({ ...value, roundScores: value.roundScores.map((round) => ({
        ...round, permissions: { role: bad, writePlayerIds: [], canManageGames: false },
      })) })).not.toThrow();
      expect(isEventLeaderboardView({ ...value, roundScores: value.roundScores.map((round) => ({
        ...round, permissions: { role: bad, writePlayerIds: [], canManageGames: false },
      })) })).toBe(false);
    }
    const plan = { eventId: purseTestId(1), currency: 'USD', funding: { kind: 'fixed', budgetMinor: 100 },
      pools: [{ id: purseTestId(2), name: 'Fictional skins', source: { kind: 'event-skins', version: 1 },
        awardUnit: 'pot', amountMinor: 100 }] };
    expect(isPursePlan(plan)).toBe(true);
    expect(isPursePlan({ ...plan, pools: plan.pools.map((pool) => ({ ...pool, recipientIds: [] })) })).toBe(false);
    expect(isPursePlan({ ...plan, pools: plan.pools.map((pool) => ({ ...pool, source: { ...pool.source, version: 2 } })) })).toBe(false);
    const ranked = { ...plan, pools: [{ id: purseTestId(2), name: 'Fictional ranks', source: { kind: 'overall' },
      awardUnit: 'per-golfer', prizes: [], tiePolicy: { toString: null } }] };
    expect(() => isPursePlan(ranked)).not.toThrow();
    expect(isPursePlan(ranked)).toBe(false);
    const badGame = { id: purseTestId(3), name: 'Fictional invalid game', kind: 'ball-drop', version: 1,
      basis: 'net', format: { toString: null }, teams: [] };
    expect(() => isRoundGameDefinition(badGame)).not.toThrow();
    expect(isRoundGameDefinition(badGame)).toBe(false);
    const first = value.roundScores[0];
    if (!first) throw new Error('Missing fictional round.');
    const badHandicaps = { ...first, overallHandicaps: { allowancePercent: 100, players: first.cards.map((card) => ({
      playerId: card.playerId, playingHandicap: null, unavailableReason: { toString: null },
    })) } };
    expect(() => isRoundScores(badHandicaps)).not.toThrow();
    expect(isRoundScores(badHandicaps)).toBe(false);
  });
  it('validates exact owner audit acknowledgements and rejects extra fields and invalid dates', () => {
    const change = { id: purseTestId(1), eventId: purseTestId(2), expectedEtag: 'old', before: null, after: { version: 1 },
      recordedAt: '2026-01-01T00:00:00Z', recordedBy: { tenantId: purseTestId(3), objectId: purseTestId(4) } };
    expect(isEventSkinsChange(change)).toBe(true);
    expect(isEventSkinsChange({ ...change, recordedAt: '2026-02-31T00:00:00Z' })).toBe(false);
    expect(isEventSkinsChange({ ...change, after: { version: 1, extra: true } })).toBe(false);
    expect(isEventSkinsChange({ ...change, extra: true })).toBe(false);
  });
});
