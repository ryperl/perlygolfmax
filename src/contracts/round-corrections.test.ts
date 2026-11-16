import { describe, expect, it } from 'vitest';
import { isRoundCorrectionReadModel, isRoundCorrectionWriteRequest, isRoundCorrectionWriteResult } from './round-corrections';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('round correction contracts', () => {
  it('validates correction write request/read model/result', () => {
    const request = {
      expected: { eventEtag: 'event-v1', roundEtag: 'round-v1', gamesEtag: 'games-v1', inputRevision: id(9) },
      correction: {
        teeProfileId: 101,
        players: [{ playerId: id(1), handicapIndexValue: null }, { playerId: id(2), handicapIndexValue: '12.3' }],
        groups: [{ number: 1, playerIds: [id(1), id(2)] }],
        playerTeeSelections: [{ playerId: id(2), teeProfileId: 102 }],
        gameTeams: [{ gameId: id(5), teams: [{ id: id(6), name: 'Team A', playerIds: [id(1), id(2)] }] }],
      },
      reason: 'Organizer corrected captured tee and handicaps.',
      reviewSummary: 'Review KP and purse.',
    };
    expect(isRoundCorrectionWriteRequest(request)).toBe(true);
    const model = {
      eventId: id(10), roundId: id(11), eventEtag: 'event-v2', roundEtag: 'round-v2', inputRevision: id(12),
      allowPerGolferTees: true, teeProfileId: 101,
      compatibleTees: [{
        id: 101, name: 'Blue', category: 'Men', holeCount: 9, totalYardage: 2700, totalMeters: 2700, totalPar: 36,
        strokeAllocation: true, shorter: null, eligibleSides: null,
        ratings: [
          { type: 'Total', course: 70, slope: 120, bogey: 90 },
          { type: 'Front', course: 35, slope: 120, bogey: 45 },
          { type: 'Back', course: 35, slope: 120, bogey: 45 },
        ],
        holes: Array.from({ length: 9 }, (_, i) => ({ number: i + 1, sourceId: i + 1, length: 300, par: 4, allocation: i + 1 })),
      }],
      players: [{ playerId: id(1), displayName: 'Fictional One', handicapIndex: null }],
      playerTeeSelections: [],
      groups: [{ number: 1, playerIds: [id(1)] }],
      gameTeams: [],
      warnings: [{ code: 'purse-review-required', message: 'Review purse payouts.' }],
    };
    expect(isRoundCorrectionReadModel(model)).toBe(true);
    expect(isRoundCorrectionWriteResult({ applied: true, receiptId: id(50), model })).toBe(true);
    expect(isRoundCorrectionWriteRequest({ ...request, correction: { ...request.correction, players: [] } })).toBe(false);
    expect(isRoundCorrectionWriteRequest({
      ...request,
      correction: { ...request.correction, players: [{ playerId: id(1), handicapIndexValue: '101.2' }] },
    })).toBe(false);
    expect(isRoundCorrectionReadModel({ ...model, warnings: [{ code: 'unknown', message: 'x' }] })).toBe(false);
  });
});
