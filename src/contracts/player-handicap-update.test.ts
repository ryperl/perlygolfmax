import { describe, expect, it } from 'vitest';
import { isEventCapabilities } from './events.js';
import { isEventHandicapRefreshResult } from './player-handicap-update.js';

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const result = { eventId: id(1), playerId: id(2), etag: 'fictional-revision',
  updatedRoundIds: [id(3)], completedRoundIds: [id(4)] };

describe('player Handicap Index update contracts', () => {
  it('accepts empty or distinct round outcomes without exposing private observation metadata', () => {
    expect(isEventHandicapRefreshResult(result)).toBe(true);
    expect(isEventHandicapRefreshResult({ ...result, updatedRoundIds: [], completedRoundIds: [] })).toBe(true);
    for (const invalid of [
      null, { ...result, eventId: 'invalid' }, { ...result, playerId: '' }, { ...result, etag: '*' },
      { ...result, updatedRoundIds: [id(3), id(3)] }, { ...result, completedRoundIds: [id(3)] },
      { ...result, completedRoundIds: ['invalid'] }, { ...result, completedRoundIds: [id(4), id(4)] },
      { ...result, updatedRoundIds: Array.from({ length: 9 }, (_, index) => id(index + 10)) },
      { ...result, observation: { source: 'Fictional private provenance' } },
    ]) expect(isEventHandicapRefreshResult(invalid)).toBe(false);
  });

  it('keeps old capabilities valid and rejects malformed new support flags', () => {
    const old = { canCreateEvents: true, canManageCatalog: false };
    expect(isEventCapabilities(old)).toBe(true);
    expect(isEventCapabilities({ ...old, playerHandicapUpdatesSupported: true })).toBe(true);
    expect(isEventCapabilities({ ...old, playerHandicapUpdatesSupported: false })).toBe(true);
    expect(isEventCapabilities({ ...old, playerHandicapUpdatesSupported: 'true' })).toBe(false);
    expect(isEventCapabilities({ ...old, eventAdministrationSupported: true })).toBe(true);
    expect(isEventCapabilities({ ...old, eventAdministrationSupported: false })).toBe(true);
    expect(isEventCapabilities({ ...old, eventAdministrationSupported: 'true' })).toBe(false);
  });
});
