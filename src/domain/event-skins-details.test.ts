import { describe, expect, it } from 'vitest';
import { calculateEventSkins, calculateEventSkinsDetails } from './event-skins';
import { eventSkinsFixture } from './event-skins.test-support';
import { isEventSkinsDetails } from '../contracts/event-skins-details';

describe('saved skins comparisons', () => {
  it.each([
    [3, 4, '0', '18', 'won', 'covered', true, 3, 3],
    [4, 5, '0', '18', 'covered', 'covered', false, 4, 4],
    [3, 3, '18', '0', 'won', 'beaten', false, 2, 3],
  ] as const)('explains %i/%i with HI %s/%s using the authoritative decision', (a, b, hiA, hiB, outcomeA, outcomeB, priority, netA, netB) => {
    const f = eventSkinsFixture([{ kind: 'strokes', strokes: a }, { kind: 'strokes', strokes: b }], [hiA, hiB]);
    const detail = calculateEventSkinsDetails(f.workspace, f.rounds);
    const summary = calculateEventSkins(f.workspace, f.rounds);
    expect(detail.holes[0]).toMatchObject({ status: summary.holes[0]?.status, winnerId: summary.holes[0]?.winnerId,
      contenderIds: summary.holes[0]?.contenderIds, grossUnderParPriority: priority,
      players: [{ gross: a, net: netA, outcome: outcomeA }, { gross: b, net: netB, outcome: outcomeB }] });
    expect(isEventSkinsDetails(detail)).toBe(true);
    expect(JSON.stringify(summary)).not.toContain('"entries"');
  });
  it('shows X7 only as reported gross, keeps missing inputs unavailable and never leaks foreign scores', () => {
    const f = eventSkinsFixture([{ kind: 'strokes', strokes: 9 }, { kind: 'picked-up', reportedStrokes: 7 }], ['0', null]);
    expect(calculateEventSkinsDetails(f.workspace, f.rounds).holes[0]?.players[1])
      .toMatchObject({ gross: 7, net: null, outcome: 'ineligible' });
    const missing = eventSkinsFixture([{ kind: 'strokes', strokes: 3 }, { kind: 'strokes', strokes: 4 }], ['0', null]);
    const detail = calculateEventSkinsDetails(missing.workspace, missing.rounds);
    expect(detail.holes[0]?.players.every((player) => player.outcome === 'unavailable')).toBe(true);
    expect(isEventSkinsDetails(detail)).toBe(true);
    const foreign = calculateEventSkinsDetails(f.workspace, f.rounds.map((round) => ({ ...round, eventId: 'foreign' })));
    expect(foreign.holes.every((hole) => hole.players.every((player) => player.gross === null))).toBe(true);
    expect(isEventSkinsDetails(foreign)).toBe(true);
  });
  it('keeps the complete twelve-player five-round comparison within one 256 KiB read', () => {
    const f = eventSkinsFixture(Array.from({ length: 12 }, () => ({ kind: 'strokes' as const, strokes: 4 })),
      Array.from({ length: 12 }, () => '0'), 5, 18);
    const detail = calculateEventSkinsDetails(f.workspace, f.rounds.map((round) => ({ ...round,
      cards: round.cards.map((card) => ({ ...card, holes: card.holes.map((hole) => ({
        ...hole, score: { kind: 'strokes' as const, strokes: 4 },
      })) })),
    })));
    expect(detail.holes).toHaveLength(90);
    expect(detail.holes.every((hole) => hole.players.length === 12)).toBe(true);
    expect(detail.holes.every((hole) => hole.contenderIds.length === 12)).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(detail)).length).toBeLessThanOrEqual(256 * 1024);
    expect(isEventSkinsDetails(detail)).toBe(true);
    expect(JSON.stringify(detail)).not.toMatch(/handicapIndex|measurementId|recordedBy|updatedAt|configuration|etag/);
  });
});
