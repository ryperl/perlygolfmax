import { describe, expect, it } from 'vitest';
import type { NassauGameDefinition, NassauHoleRecord, NassauManualPress, NassauRoundContext } from '../domain/nassau.js';
import { calculateNassau, calculateNassauFromHandicaps, nassauMatchId } from '../domain/nassau.js';
import { publishedCourseHandicaps } from '../domain/playing-handicaps.js';
import { strokeGameFixture, strokeGameId } from '../domain/stroke-games.test-support.js';
import { isNassauDefinition, isNassauHoleRecord, isNassauManualPress, isNassauResults,
  nassauDefinitionMatchesRound, nassauRecordsMatchGame } from './nassau.js';

function fixture() {
  const f = strokeGameFixture(18);
  const game: NassauGameDefinition = {
    id: strokeGameId(950), name: 'Fictional Nassau', kind: 'nassau', version: 1, basis: 'net', groupNumber: 1,
    variant: 'singles', sides: f.snapshot.players.slice(0, 2).map((player, index) => ({
      id: strokeGameId(960 + index), name: `Fictional side ${String(index + 1)}`, playerIds: [player.playerId],
    })),
    stakes: { currency: 'USD', frontMinor: 0, backMinor: 101, overallMinor: 300 }, automaticPresses: true,
  };
  const matchId = nassauMatchId(game.id, 0, 1);
  const record: NassauHoleRecord = {
    number: 3, gameId: game.id, gameEtag: 'fictional-game-revision',
    outcomes: [{ matchId, outcome: 'side-b' }], presses: [],
  };
  const manual: NassauManualPress = {
    id: strokeGameId(980), matchId, parentBetId: `${matchId}:front`, declaredAfterHole: 2, startHole: 3,
    pressingSide: 'b', proof: 'nassau-v1:[]',
  };
  return { ...f, game, matchId, record, manual };
}

describe('Nassau runtime definition contracts', () => {
  it('accepts each match-play variant with exactly its explicit sides, including reversed 1v2', () => {
    const f = fixture();
    const players = f.snapshot.players;
    const side = (index: number, selected: readonly number[]) => ({ id: strokeGameId(960 + index),
      name: `Fictional side ${String(index + 1)}`, playerIds: selected.map((index) => players[index]?.playerId ?? '') });
    for (const [variant, sides] of [
      ['singles', [side(0, [0]), side(1, [1])]],
      ['three-way', [side(0, [0]), side(1, [1]), side(2, [2])]],
      ['one-v-two', [side(0, [0]), side(1, [1, 2])]],
      ['one-v-two', [side(0, [0, 1]), side(1, [2])]],
      ['two-v-two-best-ball', [side(0, [0, 1]), side(1, [2, 3])]],
      ['two-v-two-aggregate', [side(0, [0, 1]), side(1, [2, 3])]],
    ] as const) {
      const game = { ...f.game, variant, sides };
      expect(isNassauDefinition(game)).toBe(true);
      expect(nassauDefinitionMatchesRound(game, f.snapshot)).toBe(true);
    }
  });

  it('rejects stroke-play Nassau, generic Stableford fields, malformed money and duplicated membership', () => {
    const f = fixture();
    const first = f.game.sides[0];
    expect(first).toBeDefined();
    for (const value of [
      null, {}, { ...f.game, variant: 'stroke-play' }, { ...f.game, format: 'individual' }, { ...f.game, teams: [] },
      { ...f.game, handicapAllowancePercent: 95 }, { ...f.game, automaticPresses: 1 },
      { ...f.game, basis: 'stableford' }, { ...f.game, id: 'not-a-uuid' },
      { ...f.game, sides: [first, first] }, { ...f.game, name: '' },
      { ...f.game, stakes: { ...f.game.stakes, frontMinor: -1 } },
      { ...f.game, stakes: { ...f.game.stakes, frontMinor: 1.5 } },
      { ...f.game, stakes: { ...f.game.stakes, frontMinor: Number.MAX_SAFE_INTEGER + 1 } },
      { ...f.game, stakes: { ...f.game.stakes, currency: 'EUR' } },
      { ...f.game, stakes: { frontMinor: 100, backMinor: 100, currency: 'USD' } },
    ]) expect(isNassauDefinition(value)).toBe(false);
    expect(nassauDefinitionMatchesRound({ ...f.game, groupNumber: 99 }, f.snapshot)).toBe(false);
  });
});

describe('Nassau saved record contracts', () => {
  it('checks structural declarations separately from actual source proof eligibility', () => {
    const f = fixture();
    expect(isNassauManualPress(f.manual)).toBe(true);
    const receipt = { ...f.record, presses: [f.manual] };
    expect(isNassauHoleRecord(receipt)).toBe(true);
    expect(nassauRecordsMatchGame([receipt], f.game)).toBe(true);
    const result = calculateNassau(f.game, f.snapshot, f.cards, [receipt]);
    expect(result.stalePresses).toEqual([f.manual]);
    expect(result.settlement.status).toBe('unavailable');
  });

  it('rejects invalid starts, unknown keys, duplicate outcomes and oversized/unbound declarations', () => {
    const f = fixture();
    for (const value of [
      { ...f.manual, startHole: 2 }, { ...f.manual, declaredAfterHole: 18, startHole: 19 },
      { ...f.manual, id: 'unstable-id' }, { ...f.manual, parentBetId: '' }, { ...f.manual, pressingSide: 'c' },
      { ...f.manual, proof: '' }, { ...f.manual, proof: `nassau-v1:${'a'.repeat(8192)}` },
      { ...f.manual, stakeMinor: 1 },
    ]) expect(isNassauManualPress(value)).toBe(false);
    for (const value of [
      { ...f.record, number: 0 }, { ...f.record, gameEtag: '*' }, { ...f.record, actorId: strokeGameId(990) },
      { ...f.record, outcomes: [...f.record.outcomes, ...f.record.outcomes] },
      { ...f.record, outcomes: [{ matchId: f.matchId, outcome: 'fabricated-score' }] },
      { ...f.record, number: 1, presses: [f.manual] },
      { ...f.record, number: f.manual.declaredAfterHole, presses: [f.manual] },
      { ...f.record, presses: [f.manual, f.manual] },
    ]) expect(isNassauHoleRecord(value)).toBe(false);
  });

  it('rejects cross-game/match references, repeated holes and request IDs across transport records', () => {
    const f = fixture();
    expect(nassauRecordsMatchGame([f.record, f.record], f.game)).toBe(false);
    expect(nassauRecordsMatchGame([{ ...f.record, gameId: strokeGameId(999) }], f.game)).toBe(false);
    expect(nassauRecordsMatchGame([{ ...f.record, outcomes: [{ matchId: 'unknown', outcome: 'halved' }] }], f.game)).toBe(false);
    expect(nassauRecordsMatchGame([{ ...f.record, presses: [{ ...f.manual, matchId: 'unknown' }] }], f.game)).toBe(false);
    const next = { ...f.manual, declaredAfterHole: 3, startHole: 4 };
    expect(nassauRecordsMatchGame([{ ...f.record, presses: [f.manual] },
      { ...f.record, number: 4, presses: [next] }], f.game)).toBe(false);
  });
});

describe('Nassau authoritative result contracts', () => {
  it('recomputes public CH results without raw HI and rejects forged receipts, money and private fields', () => {
    const f = fixture();
    const round: NassauRoundContext = {
      id: f.snapshot.id, courseVersionId: f.snapshot.courseVersionId,
      teeProfile: { id: f.snapshot.teeProfile.id, holeCount: f.snapshot.teeProfile.holeCount,
        holes: f.snapshot.teeProfile.holes, strokeAllocation: f.snapshot.teeProfile.strokeAllocation },
      groups: f.snapshot.groups, players: f.snapshot.players.map(({ playerId, displayName }) => ({ playerId, displayName })),
    };
    const published = { courseHandicaps: publishedCourseHandicaps(f.snapshot) };
    const result = calculateNassauFromHandicaps(f.game, round, f.cards, [], published);
    expect(nassauDefinitionMatchesRound(f.game, round)).toBe(true);
    expect(isNassauResults(result, f.game, round, f.cards, [], published)).toBe(true);
    expect(isNassauResults(result, f.game, f.snapshot, f.cards, [], published)).toBe(true);
    expect(isNassauResults(result, f.game, round, f.cards, [], { courseHandicaps: [] })).toBe(false);
    for (const forged of [
      { ...result, status: 'unavailable' },
      { ...result, matches: [] },
      { ...result, settlement: { ...result.settlement, unallocatedMinor: 12 } },
      { ...result, settlement: { ...result.settlement, players: result.settlement.players.map((player) => ({ ...player, netMinor: 10 })) } },
      { ...result, rawHandicapObservation: 'private' },
    ]) expect(isNassauResults(forged, f.game, round, f.cards, [], published)).toBe(false);
    const knownUnavailable = { courseHandicaps: published.courseHandicaps.map((player) => ({
      ...player, courseHandicap: null, unavailableReason: 'missing-handicap-index' as const,
    })) };
    const unavailable = calculateNassauFromHandicaps(f.game, round, f.cards, [], knownUnavailable);
    expect(isNassauResults(unavailable, f.game, round, f.cards, [], knownUnavailable)).toBe(true);
    expect(isNassauResults(result, f.game, round, f.cards, [], knownUnavailable)).toBe(false);
  });

  it('keeps historically stale declarations visible in recomputed result validation', () => {
    const f = fixture();
    const records = [{ ...f.record, presses: [f.manual] }];
    const result = calculateNassau(f.game, f.snapshot, f.cards, records);
    const published = { courseHandicaps: publishedCourseHandicaps(f.snapshot) };
    expect(isNassauResults(result, f.game, f.snapshot, f.cards, records, published)).toBe(true);
    expect(isNassauResults({ ...result, stalePresses: [] }, f.game, f.snapshot, f.cards, records, published)).toBe(false);
  });
});
