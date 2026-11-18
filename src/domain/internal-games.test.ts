import { describe, expect, it } from 'vitest';
import type { DotsGameDefinition } from './dots.js';
import type { WolfGameDefinition, WolfHoleRecord } from './wolf.js';
import { wolfForHole } from './wolf.js';
import type { HoleScore, Scorecard } from './scoring.js';
import { matchGamesFixture } from './match-games.test-support.js';
import { strokeGameId } from './stroke-games.test-support.js';
import { calculateInternalGameResults, calculateInternalSettlements } from './internal-games.js';
import { isRoundScores } from '../contracts/scoring.js';
import { isDotAwardAudit } from '../contracts/dot-audit.js';

function fixture() {
  const f = matchGamesFixture();
  const wolf: WolfGameDefinition = { ...f.wolf, version: 2, stakeMinor: 100 };
  const dots: DotsGameDefinition = { id: strokeGameId(1900), name: 'Fictional specials', kind: 'dots', version: 1,
    groupNumber: 1, playerIds: f.ids, mode: 'linked', linkedGameId: wolf.id, specials: [{ kind: 'sandy', units: 1 }] };
  const anchor = f.ids[0];
  if (!anchor) throw new Error('Missing fictional anchor');
  const records = f.snapshot.teeProfile.holes.slice(0, -2).map((hole): WolfHoleRecord => {
    const wolfId = wolfForHole(wolf, { layout: f.snapshot.teeProfile.holes, groups: f.snapshot.groups }, hole.number);
    const partnerId = f.ids.find((id) => id !== wolfId);
    if (!partnerId) throw new Error('Missing fictional partner');
    return { number: hole.number, choice: { gameId: wolf.id, gameEtag: 'fictional-game-revision', mode: 'partner', partnerId } };
  });
  const cards = f.cards.map((card): Scorecard => ({ ...card, holes: card.holes.map((hole) => ({ ...hole,
    score: { ...hole.score,
      ...(card.playerId === anchor ? { wolf: records.filter((record) => record.number === hole.number) } : {}),
      ...(card.playerId === anchor && hole.number === 1 ? { dots: [{ number: 1, gameId: dots.id, gameEtag: 'fictional-game-revision',
        players: [{ playerId: anchor, counts: { sandy: 1 }, calls: [] }], contests: [] }] } : {}) } })) }));
  return { ...f, wolf, dots, cards, anchor };
}

describe('optional independent Dots/Wolf composition', () => {
  it('keeps rotating groups, acknowledged order, result versions and exact settlements independent', () => {
    const f = matchGamesFixture(8);
    const groups = [{ number: 1, playerIds: f.ids.slice(0, 4), startingHole: 16 },
      { number: 2, playerIds: f.ids.slice(4, 8), startingHole: 7 }];
    const games = groups.map((group, index): DotsGameDefinition => ({ id: strokeGameId(2100 + index),
      name: `Fictional rotating group ${String(index + 1)}`, kind: 'dots', version: 2, mode: 'rotating',
      rotationHoles: index === 0 ? 3 : 6, groupNumber: group.number, playerIds: group.playerIds,
      specials: [{ kind: 'sandy', units: 1 }], stakeMinor: 100 }));
    const cards = f.cards.map((card): Scorecard => {
      const group = groups.find((entry) => entry.playerIds.includes(card.playerId));
      const game = games.find((entry) => entry.groupNumber === group?.number);
      return { ...card, holes: card.holes.map((hole) => ({ ...hole, score: { kind: 'strokes', strokes: 4,
        ...(game && group && card.playerId === group.playerIds[0] && hole.number === group.startingHole
          ? { dots: [{ number: hole.number, gameId: game.id, gameEtag: 'fictional-game-revision',
            rotation: { playerIds: [...group.playerIds].reverse() }, contests: [],
            players: [{ playerId: card.playerId, counts: { sandy: group.number }, calls: [] }] }] } : {}) } })) };
    });
    const context = { ...f.round(cards, games), groups, layout: f.snapshot.teeProfile.holes.map((hole) => ({ ...hole, par: 4 })) };
    const results = [...calculateInternalGameResults(games, context).values()];
    expect(results.map((result) => [result.version, result.dots?.rotation?.firstHole])).toEqual([[2, 16], [2, 7]]);
    expect(results.map((result) => result.players.map((player) => player.totalPoints))).toEqual([[1, 1, 0, 0], [2, 2, 0, 0]]);
    const settlements = calculateInternalSettlements(games, results, context);
    expect(settlements.map((settlement) => settlement.groupNumber)).toEqual([1, 2]);
    expect(settlements.every((settlement) => settlement.status === 'complete')).toBe(true);
    expect(settlements.map((settlement) => settlement.players.map((player) => player.netMinor))).toEqual([
      [200, 200, -200, -200], [400, 400, -400, -400],
    ]);
    const withoutGroupTwoOrder = { ...context, cards: context.cards.map((card) => card.playerId === groups[1]?.playerIds[0]
      ? { ...card, holes: card.holes.map((hole) => ({ ...hole, score: { kind: 'strokes' as const, strokes: 4 } })) } : card) };
    const partial = [...calculateInternalGameResults(games, withoutGroupTwoOrder).values()];
    expect(calculateInternalSettlements(games, partial, withoutGroupTwoOrder).map((settlement) => settlement.status)).toEqual(['complete', 'pending']);
  });

  it('uses only linked prefix specials to select the trailing Wolf, with separate results and one settlement', () => {
    const f = fixture();
    const context = f.round(f.cards, [f.wolf, f.dots]);
    const results = calculateInternalGameResults([f.wolf, f.dots], context);
    const solo = calculateInternalGameResults([f.wolf], context);
    expect(solo.get(f.wolf.id)?.wolf?.comeback?.receipt?.wolfId).toBe(f.ids[0]);
    expect(results.get(f.wolf.id)?.wolf?.comeback?.receipt?.wolfId).toBe(f.ids[2]);
    expect(results.get(f.dots.id)?.dots?.players.slice(0, 2).map((player) => player.totalPoints)).toEqual([1, 1]);
    const money = calculateInternalSettlements([f.wolf, f.dots], [...results.values()], context);
    expect(money).toHaveLength(1);
    expect(money[0]?.gameIds).toEqual([f.wolf.id, f.dots.id]);
    expect(money[0]?.status).not.toBe('complete');
    expect(isRoundScores({ ...context, internalSettlements: money })).toBe(true);
    expect(isRoundScores({ ...context, internalSettlements: [...money, ...money] })).toBe(false);
  });

  it('keeps the original comeback choice when earlier special corrections change the trailer', () => {
    const f = fixture();
    const context = f.round(f.cards, [f.wolf, f.dots]);
    const receipt = calculateInternalGameResults([f.wolf, f.dots], context).get(f.wolf.id)?.wolf?.comeback?.receipt;
    if (!receipt || !f.ids[2]) throw new Error('Missing fictional comeback candidate');
    const final: WolfHoleRecord = { number: 17, choice: { gameId: f.wolf.id, gameEtag: 'fictional-game-revision',
      mode: 'partner', partnerId: f.anchor }, comeback: receipt };
    const cards = f.cards.map((card): Scorecard => ({ ...card, holes: card.holes.map((hole) => {
      if (card.playerId !== f.anchor) return hole;
      const score: HoleScore = hole.number === 17 ? { ...hole.score, wolf: [final] } : hole.number === 1
        ? { ...hole.score, dots: [{ number: 1, gameId: f.dots.id, gameEtag: 'fictional-game-revision',
          players: [{ playerId: f.ids[2] ?? '', counts: { sandy: 1 }, calls: [] }], contests: [] }] } : hole.score;
      return { ...hole, score };
    }) }));
    const corrected = calculateInternalGameResults([f.wolf, f.dots], f.round(cards, [f.wolf, f.dots])).get(f.wolf.id)?.wolf;
    expect(corrected?.comeback).toMatchObject({ status: 'saved', changed: true, receipt: { wolfId: f.ids[2] } });
    expect(corrected?.holes.filter((hole) => hole.number >= 17).map((hole) => hole.wolfId)).toEqual([f.ids[2], f.ids[2]]);
  });

  it('runs standalone Dots without any Wolf and keeps malformed linked games unavailable', () => {
    const f = fixture();
    const standalone: DotsGameDefinition = { id: f.dots.id, name: f.dots.name, kind: 'dots', version: 1,
      groupNumber: f.dots.groupNumber, playerIds: f.dots.playerIds, specials: f.dots.specials, mode: 'individual', stakeMinor: null };
    const context = f.round(f.cards, [standalone]);
    const results = calculateInternalGameResults([standalone], context);
    expect(results.get(standalone.id)?.dots?.players.map((player) => player.totalPoints)).toEqual([1, 0, 0, 0]);
    expect(calculateInternalSettlements([standalone], [...results.values()], context)[0]?.status).toBe('points-only');
    expect(calculateInternalGameResults([f.dots], context).get(f.dots.id)?.dots?.status).toBe('unavailable');
  });

  it('retains exact immutable award explanations with rule/input bindings instead of client-authored totals', () => {
    const f = fixture();
    const result = calculateInternalGameResults([f.wolf, f.dots], f.round(f.cards, [f.wolf, f.dots])).get(f.dots.id)?.dots;
    if (!result) throw new Error('Missing fictional awards');
    const audit = { gameId: f.dots.id, kind: 'dots', version: 1, configuration: f.dots,
      gameEtag: 'fictional-game-revision', inputRevision: null, before: [], after: result.awards };
    expect(isDotAwardAudit(audit)).toBe(true);
    expect(isDotAwardAudit({ ...audit, after: result.awards.map((award) => ({ ...award, dots: 99 })) })).toBe(false);
    expect(isDotAwardAudit({ ...audit, actorId: strokeGameId(1999) })).toBe(false);
  });
});
