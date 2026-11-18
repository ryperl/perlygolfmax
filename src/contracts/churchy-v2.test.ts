import { describe, expect, expectTypeOf, it } from 'vitest';
import { isChurchyDefinition, isChurchyResult, isChurchySpecials } from './churchy.js';
import { isRoundGameDefinitions, isRoundGamesView } from './games.js';
import { churchyV2Fixture } from '../domain/churchy-v2.test-support.js';
import { churchyFixture } from '../domain/churchy.test-support.js';
import type { ChurchyGameDefinition, ChurchySpecials, ChurchySpecialsV1, ChurchySpecialsV2 } from '../domain/churchy.js';
import { churchySpecialsMatchGame } from '../domain/churchy.js';
import { calculateGameResults } from '../domain/stableford.js';
import { strokeGameCards, strokeGameId } from '../domain/stroke-games.test-support.js';

describe('Churchy v2 runtime and static contracts', () => {
  it('narrows versioned definitions/declarations while keeping the legacy declaration versionless', () => {
    function count(value: ChurchySpecials) {
      return value.version === 2 ? value.sandyCount + value.otherDots : value.version === 3 ? 0 : Number(value.sandy);
    }
    function enabled(value: ChurchyGameDefinition) {
      return value.version === 2 ? value.enabledSpecials.includes('eagle') : false;
    }
    expectTypeOf<ChurchySpecialsV2>().not.toExtend<{ readonly sandy: boolean }>();
    expectTypeOf<ChurchySpecialsV1>().not.toExtend<{ readonly version: 1 }>();
    expect(count(churchyFixture().extras)).toBe(0);
    expect(count({ ...churchyV2Fixture().extras, sandyCount: 2, otherDots: 3 })).toBe(5);
    expect(enabled(churchyV2Fixture().game)).toBe(true);
  });

  it('requires an exact v2 shape and unique configured named specials, never an editable value or Other switch', () => {
    const f = churchyV2Fixture();
    expect(isChurchyDefinition(f.game)).toBe(true);
    expect(isChurchyDefinition({ ...f.game, enabledSpecials: [] })).toBe(true);
    const { enabledSpecials, ...missing } = f.game;
    expect(enabledSpecials.length).toBeGreaterThan(0);
    for (const invalid of [missing, { ...f.game, version: 1 }, { ...f.game, version: 3 },
      { ...f.game, enabledSpecials: ['birdie', 'birdie'] }, { ...f.game, enabledSpecials: ['other'] },
      { ...f.game, enabledSpecials: [{ kind: 'eagle', dots: 4 }] }, { ...f.game, enabledSpecials: null },
      { ...f.game, amountPerDotMinor: Number.MAX_SAFE_INTEGER + 1 },
      { ...f.game, amountPerDotMinor: .5 }, { ...f.game, specialValues: { birdie: 3 } }]) {
      expect(isChurchyDefinition(invalid)).toBe(false);
    }
    expect(isChurchyDefinition(churchyFixture().game)).toBe(true);
  });

  it('validates safe whole counts and exact v2 declarations, rejecting legacy fields and mismatched versions', () => {
    const f = churchyV2Fixture();
    expect(isChurchySpecials({ ...f.extras, sandyCount: Number.MAX_SAFE_INTEGER, otherDots: Number.MAX_SAFE_INTEGER })).toBe(true);
    for (const count of [-1, .1, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY, '1', null, undefined]) {
      expect(isChurchySpecials({ ...f.extras, sandyCount: count })).toBe(false);
      expect(isChurchySpecials({ ...f.extras, otherDots: count })).toBe(false);
    }
    for (const invalid of [{ ...f.extras, sandy: false }, { ...f.extras, version: 1 },
      { ...f.extras, reason: 'Unneeded' }, { ...f.extras, sticky: 1 }, { ...f.extras, eagle: true },
      { ...f.extras, murphyPresses: 1 }, { ...f.extras, murphy: true, murphyPresses: 3 }]) {
      expect(isChurchySpecials(invalid)).toBe(false);
    }
    expect(churchySpecialsMatchGame(churchyFixture().extras, f.game)).toBe(false);
    for (const selected of [{ paree: true }, { murphy: true }, { sandyCount: 1 }, { pully: true }, { sticky: true }]) {
      expect(churchySpecialsMatchGame({ ...f.extras, ...selected }, { ...f.game, enabledSpecials: [] })).toBe(false);
    }
  });

  it('allows one independent Churchy per group, rejects duplicate group/version and incompatible formats, and leaves Ball Drop alone', () => {
    const f = churchyV2Fixture();
    const second = { ...f.game, id: strokeGameId(703), groupNumber: 2, playerIds: f.cards.slice(4).map((card) => card.playerId) };
    expect(isRoundGameDefinitions([f.game, second, f.ballDrop])).toBe(true);
    expect(isRoundGameDefinitions([f.game, { ...f.game, id: second.id }])).toBe(false);
    expect(isRoundGameDefinitions([f.game, { ...churchyFixture().game, id: second.id }])).toBe(false);
    const wolf = { id: strokeGameId(704), name: 'Fictional Wolf', kind: 'wolf', version: 2, basis: 'net',
      groupNumber: 1, playerIds: f.game.playerIds, allowPig: true, stakeMinor: 0 };
    const dots = { id: strokeGameId(705), name: 'Fictional Dots', kind: 'dots', version: 1, mode: 'individual',
      groupNumber: 1, playerIds: f.game.playerIds, stakeMinor: 0, specials: [] };
    for (const other of [wolf, dots]) {
      expect(isRoundGameDefinitions([other])).toBe(true);
      expect(isRoundGameDefinitions([f.game, other])).toBe(false);
      expect(isRoundGameDefinitions([other, f.game])).toBe(false);
      expect(isRoundGameDefinitions([f.game, { ...other, groupNumber: 2, playerIds: second.playerIds }])).toBe(true);
    }
  });

  it('validates derived v2 summaries against the bound game, exact cents and immutable source split', () => {
    const f = churchyV2Fixture();
    const game = { ...f.game, amountPerDotMinor: 50 };
    const results = calculateGameResults([game], f.snapshot, strokeGameCards(f.cards, 1, [
      { kind: 'strokes', strokes: 2, churchy: { ...f.extras, sticky: true, otherDots: 5 } },
      { kind: 'strokes', strokes: 3, churchy: { ...f.extras, sandyCount: 3 } },
    ]));
    const result = results[0];
    if (!result?.churchy?.internalSettlement) throw new Error('Missing fictional settlement');
    expect(isChurchyResult(result, game)).toBe(true);
    expect(isRoundGamesView({ configuration: { eventId: strokeGameId(900), roundId: f.snapshot.id,
      etag: f.extras.gameEtag, games: [game] }, results })).toBe(true);
    expect(isChurchyResult(result, { ...game, amountPerDotMinor: 100 })).toBe(false);
    expect(isChurchyResult(result, { ...game, enabledSpecials: [] })).toBe(false);
    expect(isChurchyResult(result, churchyFixture().game)).toBe(false);
    const settlement = result.churchy.internalSettlement;
    for (const altered of [
      { ...settlement, totalToSettleMinor: 1 }, { ...settlement, groupNumber: 2 },
      { ...settlement, stakeMinor: 100 }, { ...settlement, pairwise: [] },
      { ...settlement, players: settlement.players.map((player) => ({ ...player, baseDots: player.totalDots, specialDots: 0 })) },
    ]) expect(isChurchyResult({ ...result, churchy: { ...result.churchy, internalSettlement: altered } }, game)).toBe(false);
    expect(isChurchyResult({ ...result, churchy: { ...result.churchy,
      settlement: result.churchy.settlement.map((entry) => ({ ...entry, paysMinor: 0, collectsMinor: 0 })) } }, game)).toBe(false);
  });

  it('rejects forged/disabled/duplicate awards, wrong partners and inconsistent earned totals', () => {
    const f = churchyV2Fixture();
    const result = calculateGameResults([f.game], f.snapshot, strokeGameCards(f.cards, 1, [{ kind: 'strokes', strokes: 3 }]))[0];
    const data = result?.churchy;
    const first = data?.holes[0];
    if (!result || !data || !first) throw new Error('Missing fictional receipt');
    const birdie = first.specials.find((award) => award.special === 'Birdie');
    if (!birdie) throw new Error('Missing fictional birdie');
    for (const specials of [
      [{ ...birdie, dots: 1 }], [{ ...birdie, dots: 4 }], [birdie, birdie],
      [birdie, { ...birdie, special: 'Eagle', dots: 4 }],
      [birdie, { ...birdie, special: 'Sweep', playerId: null, dots: 1 }],
      [{ ...birdie, winners: f.game.playerIds.slice(2) }],
      [{ ...birdie, special: 'Other', dots: Number.MAX_SAFE_INTEGER + 1 }],
      [{ ...birdie, special: 'Sticky', outcome: 'missed', dots: 1 }],
      [{ ...birdie, special: 'Sandy', outcome: 'ineligible', dots: 1, winners: [] }],
    ]) expect(isChurchyResult({ ...result, churchy: { ...data,
      holes: [{ ...first, specials }, ...data.holes.slice(1)] } }, f.game)).toBe(false);
    expect(isChurchyResult({ ...result, churchy: { ...data, holes: [{ ...first, awards:
      first.awards.map((award) => ({ ...award, dots: 500 })) }, ...data.holes.slice(1)] } }, f.game)).toBe(false);
  });

  it('accepts zero, points-only, pending manual-only and explicitly unavailable receipts without inventing results', () => {
    const f = churchyV2Fixture();
    const blank = f.cards.map((card) => ({ ...card, holes: card.holes.map((hole) => ({ ...hole, score: { kind: 'unplayed' as const } })) }));
    const manual = strokeGameCards(blank, 1, [{ kind: 'unplayed', churchy: { ...f.extras, sticky: true, otherDots: 4 } }]);
    for (const game of [f.game, { ...f.game, amountPerDotMinor: 0 }]) {
      for (const cards of [f.cards, blank, manual]) {
        expect(isChurchyResult(calculateGameResults([game], f.snapshot, cards)[0], game)).toBe(true);
      }
    }
    const missing = { ...f.snapshot, players: f.snapshot.players.map((player) => ({ ...player, handicapIndex: null })) };
    expect(isChurchyResult(calculateGameResults([f.game], missing, f.cards)[0], f.game)).toBe(true);
    const moneyOverflow = { ...f.game, amountPerDotMinor: Number.MAX_SAFE_INTEGER };
    expect(isChurchyResult(calculateGameResults([moneyOverflow], f.snapshot,
      strokeGameCards(f.cards, 1, [{ kind: 'strokes', strokes: 3 }]))[0], moneyOverflow)).toBe(true);
    const countOverflow = strokeGameCards(f.cards, 1, [{ kind: 'strokes', strokes: 4,
      churchy: { ...f.extras, otherDots: Number.MAX_SAFE_INTEGER, sticky: true } }]);
    expect(isChurchyResult(calculateGameResults([f.game], f.snapshot, countOverflow)[0], f.game)).toBe(true);
    const totalOverflow = strokeGameCards(strokeGameCards(f.cards, 1, [{ kind: 'strokes', strokes: 4,
      churchy: { ...f.extras, otherDots: Number.MAX_SAFE_INTEGER } }]), 2, [{ kind: 'strokes', strokes: 4,
      churchy: { ...f.extras, otherDots: 1 } }]);
    expect(isChurchyResult(calculateGameResults([f.game], f.snapshot, totalOverflow)[0], f.game)).toBe(true);
  });
});
