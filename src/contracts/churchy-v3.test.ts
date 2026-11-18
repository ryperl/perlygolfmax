import { describe, expect, it } from 'vitest';
import { churchyV3CategoryFixture, churchyV3Fixture } from '../domain/churchy-v3.test-support.js';
import { isChurchyDefinition, isChurchyResult, isChurchySpecials } from './churchy.js';
import { isRoundGameDefinitions } from './games.js';
import { decodeRoundScores, isHoleScore, isRoundScores } from './scoring.js';
import { leanRoundScores } from './lean-round-scores.js';
import { strokeGameId } from '../domain/stroke-games.test-support.js';
import { isRecord } from './events.js';

function tamper(value: unknown, path: readonly (string | number)[], replacement: unknown): unknown {
  const [key, ...remaining] = path;
  if (key === undefined) return replacement;
  if (Array.isArray(value)) return value.map((entry: unknown, index: number) =>
    index === key ? tamper(entry, remaining, replacement) : entry);
  if (!isRecord(value)) throw new Error('Invalid fictional corruption path');
  return { ...value, [key]: tamper(value[key], remaining, replacement) };
}

describe('Churcie v3 strict definitions, receipts and coherent lean round transport', () => {
  it.each([[3, 'kp'], [5, 'blue-plate'], [5, 'long-drive']] as const)(
    'reconstructs %s default-tee categories independently of the first golfer’s personal tee (%s)', (par, category) => {
      const f = churchyV3CategoryFixture(par, 4, category);
      expect(isRoundScores(f.view)).toBe(true);
      expect(decodeRoundScores(leanRoundScores(f.view))).toEqual(f.view);
      const wrongDefault = f.view.layout.map((hole) => hole.number === 1 ? { ...hole, par: 4 } : hole);
      const tampered = { ...f.view, layout: wrongDefault };
      expect(isRoundScores(tampered)).toBe(false);
      expect(decodeRoundScores(leanRoundScores(tampered))).toBeNull();
    });

  it('accepts explicit tee/approach definitions and copied shared units without accepting Sticky as a second kind', () => {
    const f = churchyV3Fixture();
    expect(isChurchyDefinition(f.game)).toBe(true);
    expect(isChurchyDefinition({ ...f.game, orderMode: 'tee' })).toBe(true);
    expect(isRoundGameDefinitions([f.game])).toBe(true);
    for (const edit of [{ orderMode: undefined }, { orderMode: 'gps' }, { name: 'Churchy Game' },
      { specials: [{ kind: 'sticky', units: 1 }] }, { specials: [{ kind: 'other', units: -1 }] },
      { specials: [{ kind: 'dime', units: 1 }, { kind: 'dime', units: 2 }] }, { enabledSpecials: [] }]) {
      expect(isChurchyDefinition({ ...f.game, ...edit })).toBe(false);
    }
  });

  it('accepts canonical Dots declarations, Other and Murphy stages, rejects unknown keys and forged kinds', () => {
    const f = churchyV3Fixture();
    const record = { ...f.declaration(1, f.ids), players: [{ playerId: f.ids[0] ?? '',
      counts: { other: 2 }, calls: [{ id: strokeGameId(950), kind: 'murphy', result: 'pending', murphyPresses: 2 }] }] };
    expect(isChurchySpecials(record)).toBe(true);
    expect(isHoleScore({ kind: 'unplayed', churchy: record })).toBe(true);
    expect(isChurchySpecials({ ...record, sticky: true })).toBe(false);
    expect(isChurchySpecials({ ...record, rotation: { playerIds: [f.ids[0], f.ids[0], f.ids[2], f.ids[3]] } })).toBe(false);
    expect(isChurchySpecials({ ...record, players: [{ ...record.players[0],
      calls: [{ id: strokeGameId(950), kind: 'paree', result: 'pending', murphyPresses: 1 }] }] })).toBe(false);
  });

  it.each([[18, 1], [18, 10], [18, 7], [9, 7]] as const)(
    'round-trips full/lean results in actual %i-hole playing order starting %i without transmitting eager award evidence', (count, start) => {
      const f = churchyV3Fixture(count, start);
      const round = f.round();
      expect(isChurchyResult(round.games?.results[0], f.game)).toBe(true);
      expect(isRoundScores(round)).toBe(true);
      const wire = leanRoundScores(round);
      expect(wire.round.games?.results[0]?.churchy).not.toHaveProperty('awards');
      expect(wire.round.games?.results[0]?.churchy?.holes[0]).not.toHaveProperty('specials');
      expect(decodeRoundScores(wire)).toEqual(round);
      expect(decodeRoundScores(tamper(wire, ['round', 'games', 'results', 0, 'churchy', 'holes', 0, 'high', 'carry'], 999))).toBeNull();
    });

  it('rejects altered order/partners, raw/derived totals, duplicated canonical receipts and unsupported capabilities', () => {
    const f = churchyV3Fixture(9, 7);
    const round = f.round();
    for (const mutate of [
      (value: Record<string, unknown>) => { value.dotsSpecialKinds = ['not-a-special']; },
      (value: Record<string, unknown>) => { value.churchyRulesVersions = [1, 2, 4]; },
    ]) {
      const value = { ...round };
      mutate(value);
      expect(isRoundScores(value)).toBe(false);
    }
    const wire = leanRoundScores(round);
    for (const [path, replacement] of [
      [['round', 'games', 'results', 0, 'players', 0, 'totalPoints'], 999],
      [['round', 'games', 'results', 0, 'churchy', 'holes', 0, 'pairs'], []],
      [['round', 'games', 'results', 0, 'churchy', 'order', 'playerIds'], [...f.ids].reverse()],
      [['round', 'cards', 0, 'holes', 6, 'score', 'strokes'], 1],
    ] as const) {
      expect(decodeRoundScores(tamper(wire, path, replacement))).toBeNull();
    }
    expect(isRoundScores({ ...round, dotsSpecialKinds: ['other'] })).toBe(true);
    expect(isRoundScores({ ...round, dotsSpecialKinds: ['other', 'other'] })).toBe(false);
  });
});
