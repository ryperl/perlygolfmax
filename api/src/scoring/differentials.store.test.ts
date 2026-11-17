import { describe, expect, it } from 'vitest';
import { scoringFixture } from '../../test/scoring-fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { creator, event } from '../../test/fixtures.js';
import { isRoundScores } from '../../../src/contracts/scoring.js';

describe('authoritative saved round differential projection', () => {
  it('appears after the last numeric score, caps only adjusted gross and keeps captured inputs on later reads', async () => {
    const fixture = await scoringFixture(1);
    const profile = await fixture.players.get(creator, fixture.playerId);
    await fixture.players.observe(creator, fixture.playerId, identifier(950),
      { value: '0', effectiveDate: '2026-01-01', source: 'Fictional differential test' }, profile.etag);
    let round = await fixture.scores.get(creator, event.id, fixture.roundId);
    expect(round.roundDifferentials?.[0]?.status).toBe('pending');
    let etag: string | null = null;
    for (let hole = 1; hole <= 18; hole++) {
      const saved = await fixture.scores.write(creator, event.id, fixture.roundId, fixture.playerId, hole,
        { kind: 'strokes', strokes: hole === 1 ? 12 : 4 }, etag, identifier(1000 + hole));
      round = saved.round;
      etag = round.cards[0]?.etag ?? null;
      if (hole === 17) expect(round.roundDifferentials?.[0]?.status).toBe('pending');
    }
    expect(isRoundScores(round)).toBe(true);
    expect(round.roundDifferentials).toEqual([{ playerId: fixture.playerId, method: 'estimated-18-hole',
      pcc: 0, status: 'available', adjustedGross: 74, differentialTenths: 19 }]);
    expect(round.cards[0]?.holes[0]?.score).toEqual({ kind: 'strokes', strokes: 12 });
    const current = await fixture.players.get(creator, fixture.playerId);
    await fixture.players.observe(creator, fixture.playerId, identifier(951),
      { value: '40', effectiveDate: '2026-01-02', source: 'Fictional later observation' }, current.etag);
    fixture.submit.mockClear();
    const fresh = await fixture.scores.get(creator, event.id, fixture.roundId);
    expect(fresh.roundDifferentials).toEqual(round.roundDifferentials);
    expect(fixture.submit).not.toHaveBeenCalled();
    const cleared = await fixture.scores.write(creator, event.id, fixture.roundId, fixture.playerId, 18,
      { kind: 'unplayed' }, etag, identifier(1020));
    expect(cleared.round.roundDifferentials?.[0]).toMatchObject({
      status: 'pending', differentialTenths: null, adjustedGross: null,
    });
    expect(isRoundScores(cleared.round)).toBe(true);
  });

  it('never substitutes scratch for a captured NH golfer with a complete raw card', async () => {
    const fixture = await scoringFixture(1);
    let etag: string | null = null;
    let round = await fixture.scores.get(creator, event.id, fixture.roundId);
    for (let hole = 1; hole <= 18; hole++) {
      round = (await fixture.write(etag, 1100 + hole, hole)).round;
      etag = round.cards[0]?.etag ?? null;
    }
    expect(round.roundDifferentials?.[0]).toMatchObject({
      status: 'unavailable', reason: 'missing-handicap-index', adjustedGross: null, differentialTenths: null,
    });
    expect(isRoundScores(round)).toBe(true);
  });
});
