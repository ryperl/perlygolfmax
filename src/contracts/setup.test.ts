import { describe, expect, it } from 'vitest';
import { isHandicapIndex, isIndexObservation, isManualIndexInput, isPlayerProfile } from './catalog';
import { isEventSetupInput, isEventWorkspace } from './setup';

const ids = [1, 2, 3, 4].map((value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`);
const input = {
  name: 'Fictional Open', location: 'Fictional City', playerIds: ids,
  rounds: [{
    id: '00000000-0000-4000-8000-000000000010', name: 'Fictional Round',
    courseId: 'ghin:801:803', courseVersionId: 'a'.repeat(64), teeProfileId: 701,
    groups: [{ number: 1, playerIds: ids }],
  }],
};

describe('private setup and index contracts', () => {
  it('accepts multiple explicit rounds without interpreting a handicap policy', () => {
    expect(isEventSetupInput(input)).toBe(true);
    expect(isEventSetupInput({ ...input, rounds: [...input.rounds, { ...input.rounds[0], id: '00000000-0000-4000-8000-000000000011' }] })).toBe(true);
    expect(isEventSetupInput({ ...input, rounds: [] })).toBe(false);
    expect(isEventSetupInput({ ...input, rounds: [...input.rounds, ...input.rounds] })).toBe(false);
  });

  it('requires saved players, explicit tee and complete nonduplicated manual foursomes', () => {
    const round = input.rounds[0];
    expect(isEventSetupInput({ ...input, playerIds: ids.slice(0, 3) })).toBe(false);
    expect(isEventSetupInput({ ...input, playerIds: [...ids, ids[0]] })).toBe(false);
    expect(isEventSetupInput({ ...input, rounds: [{ ...round, teeProfileId: undefined }] })).toBe(false);
    expect(isEventSetupInput({ ...input, rounds: [{ ...round, groups: [{ number: 5, playerIds: ids }] }] })).toBe(false);
    expect(isEventSetupInput({ ...input, rounds: [{ ...round, groups: [{ number: 1, playerIds: [...ids, ids[0]] }] }] })).toBe(false);
    expect(isEventSetupInput({ ...input, rounds: [{ ...round, groups: [{ number: 1, playerIds: ids.slice(0, 3) }] }] })).toBe(false);
  });

  it('keeps unknown indices distinct from zero and accepts explicit plus notation without calculation', () => {
    const player = { id: ids[0], displayName: 'Fictional Golfer', createdAt: '2026-01-01', currentIndex: null, etag: 'fictional' };
    expect(isPlayerProfile(player)).toBe(true);
    for (const value of ['0', '0.0', '14.2', '+2.4']) expect(isHandicapIndex(value)).toBe(true);
    for (const value of [null, 0, '-2.4', '2.44', 'NaN', ' 2.4', '100']) expect(isHandicapIndex(value)).toBe(false);
    expect(isIndexObservation({
      id: ids[1], value: '+2.4', effectiveDate: '2026-01-01', source: 'Fictional manual entry',
      recordedAt: '2026-01-01T12:00:00Z', recordedBy: { tenantId: ids[2], objectId: ids[3] }, previousObservationId: null,
    })).toBe(true);
    expect(isPlayerProfile({ ...player, currentIndex: 0 })).toBe(false);
    expect(isManualIndexInput({ value: '+2.4', effectiveDate: '2026-01-01', source: 'Fictional manual entry' })).toBe(true);
    expect(isManualIndexInput({ value: 0, effectiveDate: '2026-01-01', source: 'Fictional' })).toBe(false);
    expect(isManualIndexInput({ value: '12.3', effectiveDate: '2026-02-31', source: 'Fictional' })).toBe(false);
    expect(isManualIndexInput({ value: '12.3', effectiveDate: '2026-01-01', source: '' })).toBe(false);
  });

  it('rejects malformed or mixed-revision workspaces without throwing at the network boundary', () => {
    const workspace = {
      event: { id: ids[0], name: 'Fictional Event', createdAt: '2026-01-01', role: 'owner', status: 'active', etag: 'current' },
      location: '', roster: [], rounds: [], etag: 'current',
    };
    expect(isEventWorkspace(workspace)).toBe(true);
    expect(isEventWorkspace({ ...workspace, etag: 'stale' })).toBe(false);
    for (const round of [null, 1, 'invalid', {}, []]) {
      expect(isEventWorkspace({ ...workspace, roster: ids.map((playerId) => ({ playerId, displayName: 'Fictional' })), rounds: [round] })).toBe(false);
    }
  });
});
