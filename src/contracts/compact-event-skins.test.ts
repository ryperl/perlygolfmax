import { describe, expect, it } from 'vitest';
import { compactSkinsDetails, compactSkinsSummary, expandSkinsDetails, expandSkinsSummary } from './compact-event-skins';
import { publicLeaderboardFixture } from '../domain/public-leaderboard.test-support';
import { publicLeaderboardSummary } from '../domain/public-leaderboard';
import { calculateEventSkinsDetails, calculateEventSkins } from '../domain/event-skins';
import { eventSkinsFixture, withoutEventSkins } from '../domain/event-skins.test-support';
import { calculateEventStandings } from '../domain/event-leaderboard';

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
describe('compact public event skins wire format', () => {
  it('reduces twelve-golfer five-round summary by70% and detail by75%, losslessly, within single-response budgets', () => {
    const full = publicLeaderboardFixture();
    const summary = publicLeaderboardSummary(full, 'event-skins');
    if (summary.kind !== 'event-skins') throw new Error('Missing fixture');
    const details = calculateEventSkinsDetails(full.workspace, full.roundScores);
    const wire = compactSkinsSummary(summary);
    const detailWire = compactSkinsDetails(details);
    expect(expandSkinsSummary(JSON.parse(JSON.stringify(wire)))).toEqual(summary);
    expect(expandSkinsDetails(JSON.parse(JSON.stringify(detailWire)))).toEqual(details);
    expect(bytes(wire)).toBeLessThan(bytes(summary) * .3);
    expect(bytes(wire)).toBeLessThan(8 * 1024);
    expect(bytes(detailWire)).toBeLessThan(bytes(details) * .25);
    expect(bytes(detailWire)).toBeLessThan(48 * 1024);
    expect(JSON.stringify(wire)).not.toMatch(/handicap|cards|roundScores|etag|recordedBy|teeProfile/);
    expect(JSON.stringify(detailWire)).not.toMatch(/handicap|cards|roundScores|etag|recordedBy|teeProfile/);
  });
  it('retains pending, unavailable, X7, plus/missing inputs and disabled states without recalculating golf rules', () => {
    for (const f of [
      eventSkinsFixture([{ kind: 'unplayed' }, { kind: 'strokes', strokes: 4 }], ['0', '0']),
      eventSkinsFixture([{ kind: 'strokes', strokes: 3 }, { kind: 'strokes', strokes: 4 }], ['0', null]),
      eventSkinsFixture([{ kind: 'strokes', strokes: 3 }, { kind: 'picked-up', reportedStrokes: 7 }], ['+18', null]),
      eventSkinsFixture([{ kind: 'strokes', strokes: 3 }, { kind: 'strokes', strokes: 3 }], ['0', '0']),
    ]) {
      const workspace = { ...f.workspace, event: { ...f.workspace.event, role: 'viewer' as const } };
      const full = { workspace, roundScores: f.rounds, standings: calculateEventStandings(workspace, f.rounds),
        eventSkins: calculateEventSkins(workspace, f.rounds) };
      const summary = publicLeaderboardSummary(full, 'event-skins');
      if (summary.kind !== 'event-skins') throw new Error('Missing fixture');
      expect(expandSkinsSummary(compactSkinsSummary(summary))).toEqual(summary);
      const details = calculateEventSkinsDetails(workspace, f.rounds);
      expect(expandSkinsDetails(compactSkinsDetails(details))).toEqual(details);
      const disabled = calculateEventSkinsDetails(withoutEventSkins(workspace), []);
      expect(expandSkinsDetails(compactSkinsDetails(disabled))).toEqual(disabled);
      const legacy = publicLeaderboardSummary({ workspace: withoutEventSkins(workspace),
        roundScores: full.roundScores, standings: full.standings }, 'event-skins');
      if (legacy.kind !== 'event-skins') throw new Error('Missing fixture');
      expect(expandSkinsSummary(compactSkinsSummary(legacy))).toEqual(legacy);
    }
  });
  it('rejects private additions, bad references, truncated/extra cells and contradictory scores', () => {
    const full = publicLeaderboardFixture();
    const summary = publicLeaderboardSummary(full, 'event-skins');
    if (summary.kind !== 'event-skins') throw new Error('Missing fixture');
    const wire = compactSkinsSummary(summary);
    const result = wire.results;
    if (!result) throw new Error('Missing fixture');
    for (const value of [
      { ...wire, audit: [] }, { ...wire, version: 2 },
      { ...wire, results: { ...result, holes: result.holes.map((row) => [999, ...row.slice(1)]) } },
      { ...wire, results: { ...result, holes: result.holes.map((row) => [...row, 'extra']) } },
      { ...wire, results: { ...result, players: result.players.map((row) => row.slice(0, 3)) } },
    ]) expect(expandSkinsSummary(value)).toBeNull();
    const detail = compactSkinsDetails(calculateEventSkinsDetails(full.workspace, full.roundScores));
    for (const value of [
      { ...detail, actors: [] },
      { ...detail, players: [...detail.players, ...detail.players] },
      { ...detail, holes: detail.holes.map((row) => [0.5, ...row.slice(1)]) },
      { ...detail, holes: detail.holes.map((row) => [...row, 'extra']) },
    ]) expect(expandSkinsDetails(value)).toBeNull();
    const tamper = (edit: (row: unknown[]) => void) => {
      const value: unknown = JSON.parse(JSON.stringify(detail));
      if (typeof value !== 'object' || value === null || !('holes' in value) || !Array.isArray(value.holes)) throw new Error('Missing fixture');
      const hole: unknown = value.holes[0];
      if (!Array.isArray(hole) || !Array.isArray(hole[7]) || !Array.isArray(hole[7][0])) throw new Error('Missing fixture');
      edit(hole[7][0]);
      return value;
    };
    expect(expandSkinsDetails(tamper((row) => { row[4] = 999; }))).toBeNull();
    expect(expandSkinsDetails(tamper((row) => { row[1] = -1; }))).toBeNull();
    expect(expandSkinsDetails(tamper((row) => { row[6] = 999; }))).toBeNull();
    expect(expandSkinsDetails(tamper((row) => { row[0] = 999; }))).toBeNull();
    expect(expandSkinsDetails(tamper((row) => { row.push({ recordedBy: 'not-public' }); }))).toBeNull();
  });
});
