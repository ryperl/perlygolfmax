import { describe, expect, it } from 'vitest';
import { calculateRoundDifferentials } from '../domain/round-differential.js';
import { strokeGameFixture, strokeGameId } from '../domain/stroke-games.test-support.js';
import { isRoundDifferential, isRoundDifferentials } from './round-differential.js';

const available = {
  playerId: strokeGameId(1), method: 'estimated-18-hole', pcc: 0,
  status: 'available', differentialTenths: 139, adjustedGross: 88,
};
const pending = { ...available, status: 'pending', differentialTenths: null, adjustedGross: null, reason: 'incomplete-card' };
const unavailable = { ...pending, status: 'unavailable', reason: 'missing-handicap-index' };

describe('round differential allowlist contract', () => {
  it('accepts calculator-produced all-roster output, pending and explicit unavailable states', () => {
    const f = strokeGameFixture(18, 3);
    const values = calculateRoundDifferentials(f.snapshot, f.cards);
    expect(isRoundDifferentials(values, f.snapshot.players.map((player) => player.playerId))).toBe(true);
    expect(isRoundDifferential(available)).toBe(true);
    expect(isRoundDifferential(pending)).toBe(true);
    expect(isRoundDifferential(unavailable)).toBe(true);
    expect(isRoundDifferential({ ...available, differentialTenths: -15 })).toBe(true);
    expect(isRoundDifferential({ ...available, differentialTenths: 0 })).toBe(true);
  });

  it.each([
    { status: 'official' }, { method: 'official' }, { pcc: 1 }, { pcc: null },
    { playerId: 'private-actor' }, { differentialTenths: null }, { adjustedGross: null },
    { differentialTenths: 1.5 }, { differentialTenths: Infinity }, { differentialTenths: NaN },
    { differentialTenths: Number.MAX_SAFE_INTEGER + 1 }, { differentialTenths: -0 },
    { adjustedGross: 0 }, { adjustedGross: -1 }, { adjustedGross: 17 }, { adjustedGross: 271 }, { adjustedGross: 88.5 },
    { adjustedGross: Infinity }, { adjustedGross: Number.MAX_SAFE_INTEGER + 1 },
    { differentialTenths: 100_000 }, { differentialTenths: -100_000 },
    { reason: 'incomplete-card' }, { handicapIndex: { value: '12', recordedBy: 'private' } },
    { actor: 'private' }, { observationId: strokeGameId(9) }, { extra: undefined },
  ])('rejects invented fields, unsafe values and contradictory available state: %j', (patch) => {
    expect(isRoundDifferential({ ...available, ...patch })).toBe(false);
  });

  it.each([
    { ...pending, adjustedGross: 88 }, { ...pending, differentialTenths: 0 },
    { ...pending, reason: 'missing-handicap-index' }, { ...pending, reason: undefined },
    { ...unavailable, reason: 'incomplete-card' }, { ...unavailable, reason: 'future-reason' },
    { ...unavailable, differentialTenths: 0 }, { ...unavailable, status: 'available' },
  ])('rejects contradictory pending/unavailable states: %j', (value) => {
    expect(isRoundDifferential(value)).toBe(false);
  });

  it('rejects missing required fields, nonobjects and duplicate/case-aliased/foreign or incomplete roster rows', () => {
    for (const key of Object.keys(available)) {
      expect(isRoundDifferential(Object.fromEntries(Object.entries(available).filter(([field]) => field !== key)))).toBe(false);
    }
    for (const value of [null, [], 4, 'available', {}]) expect(isRoundDifferential(value)).toBe(false);
    expect(isRoundDifferentials([available, available])).toBe(false);
    const alias = { ...available, playerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
    expect(isRoundDifferentials([alias, { ...alias, playerId: alias.playerId.toUpperCase() }])).toBe(false);
    expect(isRoundDifferentials([available], [strokeGameId(2)])).toBe(false);
    expect(isRoundDifferentials([available], [available.playerId, strokeGameId(2)])).toBe(false);
    expect(isRoundDifferentials([available], [available.playerId, available.playerId])).toBe(false);
    expect(isRoundDifferentials([], [])).toBe(true);
    expect(isRoundDifferentials([available], [available.playerId])).toBe(true);
  });
});
