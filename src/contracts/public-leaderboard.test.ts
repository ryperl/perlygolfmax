import { describe, expect, it } from 'vitest';
import { publicLeaderboardFixture } from '../domain/public-leaderboard.test-support';
import { publicLeaderboardSummary } from '../domain/public-leaderboard';
import { isEventLeaderboardView } from './event-leaderboard';
import { isPublicLeaderboardSummary } from './public-leaderboard';

const full = publicLeaderboardFixture();
const overall = publicLeaderboardSummary(full, 'overall');
const skins = publicLeaderboardSummary(full, 'event-skins');
describe('purpose-bound public leaderboard summaries', () => {
  it('keeps saved rankings/progress and per-round skins exactly while removing raw scoring/setup and the unused other board', () => {
    expect(isEventLeaderboardView(full)).toBe(true);
    expect(isPublicLeaderboardSummary(overall)).toBe(true);
    expect(isPublicLeaderboardSummary(skins)).toBe(true);
    if (overall.kind !== 'overall' || skins.kind !== 'event-skins') throw new Error('Missing fictional board');
    expect(overall.standings.players).toEqual(full.standings.players);
    expect(overall.standings.players[0]).toMatchObject({ rank: 1, subtotal: 270, relativeToPar: -90, holesScored: 90 });
    expect(skins.eventSkins?.players).toEqual(full.eventSkins?.players);
    expect(skins.eventSkins?.awardedSkins).toBe(90);
    expect(JSON.stringify(overall)).not.toMatch(/roundScores|teeProfile|handicap|cards|eventSkins|gameId/);
    expect(JSON.stringify(skins)).not.toMatch(/roundScores|teeProfile|handicap|cards|contenderIds|netStrokes|standings/);
    const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
    expect(bytes(overall)).toBeLessThan(bytes(full) / 10);
    expect(bytes(overall)).toBeLessThan(24 * 1024);
    expect(bytes(skins)).toBeLessThan(bytes(full) / 3);
  });
  it.each([
    { ...overall, roundScores: full.roundScores },
    { ...overall, eventSkins: full.eventSkins },
    { ...overall, workspace: { ...overall.workspace, event: { ...overall.workspace.event, role: 'owner' } } },
    { ...overall, workspace: { ...overall.workspace, event: { ...overall.workspace.event, status: 'archived' } } },
    { ...skins, roundScores: [] },
    { ...skins, standings: full.standings },
  ])('rejects private/unused data and wrong event authority shape %#', (invalid) => {
    expect(isPublicLeaderboardSummary(invalid)).toBe(false);
  });
  it('rejects malformed or mixed standings cells, duplicate identities and raw hole extras', () => {
    if (overall.kind !== 'overall' || skins.kind !== 'event-skins' || !skins.eventSkins) throw new Error('Missing fictional board');
    for (const invalid of [
      { ...overall, standings: { ...overall.standings, players: [...overall.standings.players, ...overall.standings.players] } },
      { ...overall, standings: { ...overall.standings, players: overall.standings.players.map((player) => ({ ...player,
        cells: player.cells.map((cell) => ({ ...cell, subtotal: Infinity })) })) } },
      { ...overall, standings: { ...overall.standings, players: overall.standings.players.map((player) => ({ ...player, cells: [] })) } },
      { ...skins, eventSkins: { ...skins.eventSkins, awardedSkins: 0 } },
      { ...skins, eventSkins: { ...skins.eventSkins, holes: skins.eventSkins.holes.map((hole) => ({ ...hole, netStrokes: 1 })) } },
    ]) expect(isPublicLeaderboardSummary(invalid)).toBe(false);
  });
});
