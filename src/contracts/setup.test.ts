import { describe, expect, it } from 'vitest';
import { isHandicapIndex, isIndexObservation, isManualIndexInput, isPlayerProfile } from './catalog';
import { isEventSetupInput, isEventWorkspace, isOverallCompetition } from './setup';
import { maximumEventSetupBytes } from '../domain/setup.js';

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
  it('accepts legacy purse availability omission and explicit booleans, not truthy malformed values', () => {
    const workspace = { event: { id: ids[0], name: 'Fictional Event', createdAt: '2026-01-01', role: 'owner', status: 'active', etag: 'current' },
      location: '', roster: [], rounds: [], etag: 'current' };
    for (const purseConfigured of [true, false]) expect(isEventWorkspace({ ...workspace, purseConfigured })).toBe(true);
    for (const purseConfigured of [null, 1, 'true', {}]) expect(isEventWorkspace({ ...workspace, purseConfigured })).toBe(false);
    expect(isEventWorkspace(workspace)).toBe(true);
  });
  it('accepts legacy groups and explicit integer starting holes from 1 through 18', () => {
    expect(isEventSetupInput(input)).toBe(true);
    for (const startingHole of [1, 10, 18]) {
      expect(isEventSetupInput({ ...input, rounds: input.rounds.map((round) => ({
        ...round, groups: round.groups.map((group) => ({ ...group, startingHole })),
      })) })).toBe(true);
    }
    for (const startingHole of [0, -1, 19, 1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '10', null]) {
      expect(isEventSetupInput({ ...input, rounds: input.rounds.map((round) => ({
        ...round, groups: round.groups.map((group) => ({ ...group, startingHole })),
      })) })).toBe(false);
    }
  });

  it('requires a public workspace to be active viewer-only with scores, no account binding or tester flag', () => {
    const workspace = {
      event: { id: ids[0], name: 'Fictional Event', createdAt: '2026-01-01', role: 'viewer', status: 'active', etag: 'current' },
      location: '', roster: [], rounds: [], etag: 'current', publicAccess: true, canViewScores: true,
    };
    expect(isEventWorkspace(workspace)).toBe(true);
    for (const invalid of [
      { ...workspace, publicAccess: false }, { ...workspace, canViewScores: false },
      { ...workspace, viewerPlayerId: ids[0] }, { ...workspace, testerAccess: true },
      { ...workspace, event: { ...workspace.event, role: 'owner' } },
      { ...workspace, event: { ...workspace.event, status: 'archived' } },
    ]) expect(isEventWorkspace(invalid)).toBe(false);
  });
  it('validates tester workspace as active viewer-only with score access but no bound golfer', () => {
    const workspace = {
      event: { id: ids[0], name: 'Fictional Event', createdAt: '2026-01-01', role: 'viewer', status: 'active', etag: 'current' },
      location: '', roster: [], rounds: [], etag: 'current', testerAccess: true, canViewScores: true,
    };
    expect(isEventWorkspace(workspace)).toBe(true);
    expect(isEventWorkspace({ ...workspace, testerAccess: false })).toBe(false);
    expect(isEventWorkspace({ ...workspace, canViewScores: false })).toBe(false);
    expect(isEventWorkspace({ ...workspace, viewerPlayerId: ids[0] })).toBe(false);
    expect(isEventWorkspace({ ...workspace, event: { ...workspace.event, role: 'owner' } })).toBe(false);
    expect(isEventWorkspace({ ...workspace, event: { ...workspace.event, status: 'archived' } })).toBe(false);
  });
  it.each([1, 2, 3])('accepts %i golfers with complete playing-group assignments, never an empty roster', (count) => {
    const playerIds = ids.slice(0, count);
    const rounds = input.rounds.map((round) => ({ ...round, groups: [{ number: 1, playerIds }] }));
    expect(isEventSetupInput({ ...input, playerIds, rounds })).toBe(true);
    expect(isEventSetupInput({ ...input, playerIds: [], rounds })).toBe(false);
    expect(isEventSetupInput({ ...input, playerIds, rounds: rounds.map((round) => ({ ...round, groups: [] })) })).toBe(false);
  });
  it('preserves legacy omission, accepts explicit disable only on writes and shares the setup byte cap', () => {
    expect(maximumEventSetupBytes).toBe(12288);
    expect(isEventSetupInput(input)).toBe(true);
    expect(isEventSetupInput({ ...input, overallCompetition: null })).toBe(true);
    const workspace = {
      event: { id: ids[0], name: 'Fictional Event', createdAt: '2026-01-01', role: 'owner', status: 'active', etag: 'current' },
      location: '', roster: [], rounds: [], etag: 'current',
    };
    expect(isEventWorkspace(workspace)).toBe(true);
    expect(isEventWorkspace({ ...workspace, overallCompetition: null })).toBe(false);
    expect(isEventWorkspace({ ...workspace, overallCompetition: { kind: 'stroke-play', basis: 'gross' } })).toBe(true);
  });

  it('strictly validates one overall competition, exact basis fields and bounded unique round bindings', () => {
    const binding = { roundId: ids[0], gameId: ids[1] };
    for (const overallCompetition of [
      { kind: 'stableford', credit: 'individual', roundGames: [] },
      { kind: 'stableford', credit: 'team', roundGames: [binding] },
      { kind: 'stroke-play', basis: 'gross' },
      { kind: 'stroke-play', basis: 'net', handicapAllowancePercent: 95 },
      { kind: 'stroke-play', basis: 'net', handicapAllowancePercent: 100 },
      { kind: 'stroke-play', basis: 'net', handicapAllowancePercent: 1 },
    ]) {
      expect(isOverallCompetition(overallCompetition)).toBe(true);
      expect(isEventSetupInput({ ...input, overallCompetition })).toBe(true);
    }
    for (const overallCompetition of [
      null, [], {}, { kind: 'stableford', credit: 'other', roundGames: [] },
      { kind: 'stableford', credit: 'team', roundGames: [binding, binding] },
      { kind: 'stableford', credit: 'team', roundGames: [{ ...binding, points: 2 }] },
      { kind: 'stableford', credit: 'team', roundGames: [{ roundId: 'invalid', gameId: ids[1] }] },
      { kind: 'stableford', credit: 'team', roundGames: [binding], points: [] },
      { kind: 'stableford', credit: 'team', roundGames: Array.from({ length: 9 }, (_, index) => ({
        roundId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, gameId: ids[1],
      })) },
      { kind: 'stroke-play', basis: 'gross', handicapAllowancePercent: 95 },
      { kind: 'stroke-play', basis: 'gross', credit: 'team' },
      { kind: 'stroke-play', basis: 'net' },
      ...[0, 101, 95.5, '95', NaN].map((handicapAllowancePercent) => ({
        kind: 'stroke-play', basis: 'net', handicapAllowancePercent,
      })),
    ]) expect(isOverallCompetition(overallCompetition)).toBe(false);
  });

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
    expect(isEventSetupInput({ ...input, rounds: [{ ...round, groups: [{ number: 5, playerIds: ids }] }] })).toBe(true);
    expect(isEventSetupInput({ ...input, rounds: [{ ...round, groups: [{ number: 1, playerIds: [...ids, ids[0]] }] }] })).toBe(false);
    expect(isEventSetupInput({ ...input, rounds: [{ ...round, groups: [{ number: 1, playerIds: ids.slice(0, 3) }] }] })).toBe(false);
  });

  it('requires at least two groups for eight distinct golfers and rejects an overfilled group', () => {
    const playerIds = Array.from({ length: 8 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
    const round = input.rounds[0];
    expect(isEventSetupInput({ ...input, playerIds, rounds: [{ ...round, groups: [{ number: 1, playerIds }] }] })).toBe(false);
    expect(isEventSetupInput({ ...input, playerIds, rounds: [{ ...round, groups: [
      { number: 1, playerIds: playerIds.slice(0, 5) }, { number: 2, playerIds: playerIds.slice(5) },
    ] }] })).toBe(false);
    expect(isEventSetupInput({ ...input, playerIds, rounds: [{ ...round, groups: [
      { number: 1, playerIds: playerIds.slice(0, 4) }, { number: 2, playerIds: playerIds.slice(4) },
    ] }] })).toBe(true);
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
