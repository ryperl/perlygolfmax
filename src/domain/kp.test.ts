import { describe, expect, it } from 'vitest';
import { calculateKp, calculateKpPayout, kpContext, kpDistance, sameKpEntry } from './kp';
import type { KpDecision, KpEntry } from './kp';
import type { RoundScores } from './scoring';

const ids = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'];
const measurement = (inches: number, version = 1): KpEntry => ({
  kind: 'measured', inches, onGreen: true, measurementId: `20000000-0000-4000-8000-${String(version).padStart(12, '0')}`,
});
export function kpFixture(status: 'open' | 'closed' = 'closed') {
  const layout = [183, 178, 175, 200].map((length, index) => ({ number: index + 1, sourceId: index + 1, par: 3, length, allocation: index + 1 }));
  const cards = ids.map((playerId, index) => ({
    playerId, displayName: `Fictional Golfer ${String(index + 1)}`, etag: '"saved"', updatedAt: '2026-01-01T00:00:00Z',
    holes: layout.map((hole) => ({ number: hole.number, score: { kind: 'unplayed' as const,
      ...(hole.number <= 3 ? { kp: measurement(index === 0 ? 20 : 30) } : {}) } })),
  }));
  return { layout, cards, kp: { version: 1 as const, context: kpContext(layout, ids), status, etag: '"kp"', decisions: [] as readonly KpDecision[] } };
}
describe('KP sparse closest results and exact planned payouts', () => {
  it('parses exact units without a ceiling and never infers a hole-in-one from blank', () => {
    expect(kpDistance('', '')).toBeNull();
    expect(kpDistance('0', '0')).toBe(0);
    expect(kpDistance('2', '11')).toBe(35);
    expect(kpDistance('1', '12')).toBeNull();
    expect(kpDistance('-1', '0')).toBeNull();
    expect(kpDistance('1.5', '0')).toBeNull();
    expect(kpDistance('750599937895082', '7')).toBe(Number.MAX_SAFE_INTEGER);
    expect(kpDistance('750599937895082', '8')).toBeNull();
    expect(sameKpEntry(undefined, { kind: 'no-measurement' })).toBe(false);
  });
  it('excludes empty configured holes only on closure and awards each winning hole, not each golfer', () => {
    const round = kpFixture();
    expect(calculateKpPayout({ ...round, kp: { ...round.kp, status: 'open' } }, 10000))
      .toMatchObject({ status: 'provisional', shares: [], reservedMinor: 10000 });
    const result = calculateKpPayout(round, 10000);
    expect(result).toMatchObject({ status: 'final', reservedMinor: 0,
      holes: [{ number: 1, amountMinor: 3334 }, { number: 2, amountMinor: 3333 }, { number: 3, amountMinor: 3333 }] });
    expect(result.shares.map((share) => share.playerId)).toEqual([ids[0], ids[0], ids[0]]);
  });
  it('keeps all-empty and no-measurement reserved, while explicit zero wins', () => {
    const round = kpFixture();
    const empty = { ...round, cards: round.cards.map((card) => ({ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: { kind: 'unplayed' as const, kp: { kind: 'no-measurement' as const } },
    })) })) };
    expect(calculateKpPayout(empty, 10000)).toMatchObject({ status: 'review', reservedMinor: 10000, shares: [] });
    const first = empty.cards[0];
    if (!first) throw new Error('Missing fixture');
    const zero = { ...empty, cards: [{ ...first, holes: first.holes.map((hole) => hole.number === 1
      ? { ...hole, score: { kind: 'unplayed' as const, kp: measurement(0) } } : hole) }, ...empty.cards.slice(1)] };
    expect(calculateKp(zero).holes[0]?.closestPlayerIds).toEqual([ids[0]]);
    expect(calculateKpPayout(zero, 10000).shares[0]?.amountMinor).toBe(10000);
  });
  it('uses harder default-tee stroke index on equal lengths and blocks ambiguous remainder allocation', () => {
    const original = kpFixture();
    const layout = original.layout.map((hole) => ({ ...hole, length: 180, allocation: 5 - hole.number }));
    const round = { ...original, layout, kp: { ...original.kp, context: kpContext(layout, original.cards.map((card) => card.playerId)) } };
    expect(calculateKpPayout(round, 10000).holes[0]).toEqual({ number: 3, amountMinor: 3334 });
    const ambiguous = layout.map((hole) => ({ ...hole, allocation: 1 }));
    expect(calculateKpPayout({ ...round, layout: ambiguous, kp: { ...round.kp, context: kpContext(ambiguous, ids) } }, 10000).status)
      .toBe('unavailable');
  });
  it('requires explicit tied split cents bound to exact measurement set and amount', () => {
    const original = kpFixture();
    const round = { ...original, cards: original.cards.map((card) => ({ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: hole.number === 2 ? { ...hole.score, kp: measurement(12) } : hole.score,
    })) })) };
    const hole = calculateKp(round).holes.find((entry) => entry.number === 2);
    if (!hole) throw new Error('Missing hole');
    expect(calculateKpPayout(round, 10000)).toMatchObject({ status: 'review', reservedMinor: 3333 });
    const decision: KpDecision = { holeNumber: 2, proof: hole.proof, kind: 'split', playerIds: ids,
      holeAmountMinor: 3333, extraCentPlayerIds: [ids[1] ?? ''] };
    const resolved = { ...round, kp: { ...round.kp, decisions: [decision] } };
    expect(calculateKpPayout(resolved, 10000)).toMatchObject({ status: 'final', reservedMinor: 0 });
    expect(calculateKpPayout(resolved, 10000).shares.filter((share) => share.holeNumber === 2).map((share) => share.amountMinor))
      .toEqual([1666, 1667]);
    expect(calculateKpPayout({ ...resolved, kp: { ...resolved.kp, decisions: [{ ...decision, extraCentPlayerIds: [] }] } }, 10000).status).toBe('review');
    expect(calculateKpPayout(resolved, 10003).status).toBe('review');
    const changed = { ...resolved, cards: resolved.cards.map((card) => ({ ...card, holes: card.holes.map((entry) =>
      entry.number === 2 ? { ...entry, score: { ...entry.score, kp: measurement(12, 2) } } : entry) })) };
    expect(calculateKpPayout(changed, 10000).status).toBe('review');
  });
  it('fails closed on saved default layout or roster changes, without using personal tees', () => {
    const round = kpFixture();
    expect(calculateKp({ ...round, layout: round.layout.map((hole) => ({ ...hole, length: hole.length + 1 })) }).status).toBe('unavailable');
    expect(calculateKp({ ...round, cards: round.cards.slice(1) }).status).toBe('unavailable');
    const personal: Pick<RoundScores, 'layout' | 'cards' | 'kp'> = round;
    expect(calculateKp(personal).status).toBe('closed');
  });
});
