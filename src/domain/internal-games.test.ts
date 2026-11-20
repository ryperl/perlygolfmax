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
  it('refuses duplicated automatic High/Low sweeps on reads/money, while allowing a separately declared linked manual Sweep', () => {
    const f = fixture(), wolf = { ...f.wolf, highLowSweep: true as const };
    const legacy = { ...f.dots, specials: [{ kind: 'sweep' as const, units: 1 }] };
    const games = [wolf, legacy], context = f.round(f.cards, games);
    const result = calculateInternalGameResults(games, context);
    expect(result.get(wolf.id)?.wolf?.reason).toBe('conflicting-sweep-configuration');
    expect(result.get(legacy.id)?.dots?.status).toBe('unavailable');
    expect(calculateInternalSettlements(games, [...result.values()], context)[0]?.status).toBe('unavailable');
    const manual = { ...legacy, sweepRule: 'manual-v1' as const };
    const cards = f.cards.map((card): Scorecard => ({ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: { ...hole.score, dots: card.playerId === f.anchor && hole.number === 1 ? [{
        number: 1, gameId: manual.id, gameEtag: 'fictional-game-revision', contests: [],
        players: [{ playerId: f.anchor, counts: { sweep: 2 }, calls: [] }],
      }] : [] },
    })) }));
    const current = calculateInternalGameResults([wolf, manual], f.round(cards, [wolf, manual]));
    expect(current.get(wolf.id)?.wolf?.reason).toBeUndefined();
    expect(current.get(manual.id)?.dots?.players.slice(0, 2).map((player) => player.totalPoints)).toEqual([2, 2]);
    expect(current.get(wolf.id)?.wolf?.comeback?.status).toBe('available');
  });

  it('adds category sweeps to current linked prefix results without replacing a saved legacy final-hole Wolf receipt', () => {
    const f = fixture();
    const dots: DotsGameDefinition = { ...f.dots, specials: [{ kind: 'long-drive', units: 1 }, { kind: 'blue-plate', units: 1 }] };
    const games = [f.wolf, dots];
    const layout = f.snapshot.teeProfile.holes.map((hole) => ({ ...hole, par: hole.number === 1 ? 5 : 4 }));
    const cards = f.cards.map((card): Scorecard => ({ ...card, holes: card.holes.map((hole) =>
      card.playerId === f.anchor && hole.number === 1 ? { ...hole, score: { ...hole.score, dots: [{
        number: 1, gameId: dots.id, gameEtag: 'fictional-game-revision', players: [], contests: [
          { kind: 'long-drive', status: 'awarded', winnerId: f.anchor },
          { kind: 'blue-plate', status: 'awarded', winnerId: f.anchor },
        ],
      }] } } : hole) }));
    const context = { ...f.round(cards, games), layout };
    const old = calculateInternalGameResults(games, { ...context, dotsCategorySweepsVersion: 0 });
    const receipt = old.get(f.wolf.id)?.wolf?.comeback?.receipt;
    if (!receipt) throw new Error('Missing fictional legacy category candidate');
    const partnerId = f.ids.find((id) => id !== receipt.wolfId);
    if (!partnerId) throw new Error('Missing fictional partner');
    const saved = cards.map((card): Scorecard => card.playerId !== f.anchor ? card : { ...card,
      holes: card.holes.map((hole) => hole.number !== 17 ? hole : { ...hole, score: { ...hole.score, wolf: [{
        number: 17, choice: { gameId: f.wolf.id, gameEtag: 'fictional-game-revision', mode: 'partner', partnerId }, comeback: receipt,
      }] } }) });
    const modern = calculateInternalGameResults(games, { ...context, cards: saved, dotsCategorySweepsVersion: 1 });
    expect(modern.get(f.wolf.id)?.wolf?.comeback).toEqual({ status: 'saved', receipt, changed: true });
    expect(modern.get(f.wolf.id)?.wolf?.holes.filter((hole) => hole.number >= 17).map((hole) => hole.wolfId))
      .toEqual([receipt.wolfId, receipt.wolfId]);
    expect(modern.get(dots.id)?.dots?.awards.filter((award) => award.kind === 'category-sweep'))
      .toEqual([expect.objectContaining({ dots: 1, earnedBy: f.anchor, recipientIds: f.ids.slice(0, 2) })]);
    expect(saved[0]?.holes.find((hole) => hole.number === 17)?.score.wolf?.[0]?.comeback).toBe(receipt);
  });
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

  it('retains the legacy pre-write Wolf receipt and chosen final-hole Wolf when corrected String changes its prefix', () => {
    const f = fixture();
    const dots: DotsGameDefinition = { ...f.dots, specials: [{ kind: 'string', units: 1 }] };
    const games = [f.wolf, dots];
    const cards = f.cards.map((card): Scorecard => ({ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: { ...hole.score, kind: 'strokes',
        strokes: card.playerId === f.anchor && hole.number <= 2 ? 3 : 4, dots: [] },
    })) }));
    const context = f.round(cards, games);
    const receipt = calculateInternalGameResults(games, { ...context, stringRulesVersion: 1 })
      .get(f.wolf.id)?.wolf?.comeback?.receipt;
    if (!receipt) throw new Error('Missing fictional legacy candidate');
    const partnerId = f.ids.find((id) => id !== receipt.wolfId);
    if (!partnerId) throw new Error('Missing fictional partner');
    const saved = cards.map((card): Scorecard => card.playerId !== f.anchor ? card : { ...card,
      holes: card.holes.map((hole) => hole.number !== 17 ? hole : { ...hole, score: { ...hole.score,
        wolf: [{ number: 17, choice: { gameId: f.wolf.id, gameEtag: 'fictional-game-revision',
          mode: 'partner', partnerId }, comeback: receipt }] } }) });
    const modern = { ...f.round(saved, games), stringRulesVersion: 2 as const };
    const result = calculateInternalGameResults(games, modern).get(f.wolf.id)?.wolf;
    expect(result?.comeback).toEqual({ status: 'saved', receipt, changed: true });
    expect(result?.holes.filter((hole) => hole.number >= 17).map((hole) => hole.wolfId))
      .toEqual([receipt.wolfId, receipt.wolfId]);
    expect(isRoundScores(modern)).toBe(true);
    expect(saved.find((card) => card.playerId === f.anchor)?.holes.find((hole) => hole.number === 17)
      ?.score.wolf?.[0]?.comeback).toEqual(receipt);
  });

  it('retains the immutable final Wolf after a raw correction resolves a linked pressed Murphy differently', () => {
    const f = fixture();
    const dots: DotsGameDefinition = { ...f.dots, specials: [{ kind: 'murphy', units: 1 }] };
    const games = [f.wolf, dots];
    const cards = f.cards.map((card): Scorecard => ({ ...card, holes: card.holes.map((hole) => card.playerId === f.anchor && hole.number === 1
      ? { ...hole, score: { ...hole.score, dots: [{ number: 1, gameId: dots.id, gameEtag: 'fictional-game-revision',
        players: [{ playerId: f.anchor, counts: {}, calls: [{ id: strokeGameId(1910), kind: 'murphy',
          result: 'pending', murphyTarget: 'par', murphyPresses: 2 }] }], contests: [] }] } } : hole) }));
    const initial = calculateInternalGameResults(games, f.round(cards, games));
    const receipt = initial.get(f.wolf.id)?.wolf?.comeback?.receipt;
    if (!receipt || !f.ids[2]) throw new Error('Missing fictional call-based candidate');
    expect(receipt.wolfId).toBe(f.ids[2]);
    const final: WolfHoleRecord = { number: 17, choice: { gameId: f.wolf.id, gameEtag: 'fictional-game-revision',
      mode: 'partner', partnerId: f.anchor }, comeback: receipt };
    const corrected = cards.map((card): Scorecard => ({ ...card, holes: card.holes.map((hole) => {
      if (card.playerId !== f.anchor) return hole;
      return hole.number === 17 ? { ...hole, score: { ...hole.score, wolf: [final] } }
        : hole.number === 1 ? { ...hole, score: { ...hole.score, kind: 'strokes', strokes: 5 } } : hole;
    }) }));
    const results = calculateInternalGameResults(games, f.round(corrected, games));
    expect(results.get(f.wolf.id)?.wolf?.comeback).toEqual({ status: 'saved', receipt, changed: true });
    expect(results.get(f.wolf.id)?.wolf?.holes.filter((hole) => hole.number >= 17).map((hole) => hole.wolfId))
      .toEqual([receipt.wolfId, receipt.wolfId]);
    expect(results.get(dots.id)?.dots?.awards[0]).toMatchObject({ kind: 'murphy', count: 3, multiplier: 1, dots: 3,
      recipientIds: f.ids.slice(2), reason: 'Murphy call: failure.' });
    expect(corrected[0]?.holes[0]?.score.dots).toEqual(cards[0]?.holes[0]?.score.dots);
    expect(corrected[0]?.holes.find((hole) => hole.number === 17)?.score.wolf?.[0]?.comeback).toEqual(receipt);
  });

  it('retains progressive linked dots and resolves hole 17 after a saved birdie Pully and all prefix declarations', () => {
    const f = fixture();
    const scorer = f.ids[2];
    if (!scorer) throw new Error('Missing fictional golfer');
    const dots: DotsGameDefinition = { ...f.dots, specials: [...f.dots.specials,
      { kind: 'pully', units: 1 }, { kind: 'hogan', units: 1 }, { kind: 'birdie', units: 2 }] };
    const cards = f.cards.map((card): Scorecard => ({ ...card, holes: card.holes.map((hole) => {
      let score: HoleScore = hole.score;
      if (hole.number === 15 && card.playerId === scorer) score = { ...score, kind: 'strokes', strokes: 3 };
      if (hole.number === 15 && card.playerId === f.anchor) score = { ...score, dots: [{
          number: 15, gameId: dots.id, gameEtag: 'fictional-game-revision',
          players: [{ playerId: scorer, counts: { hogan: 1, pully: 1 }, calls: [] }], contests: [],
        }] };
      return { ...hole, score };
    }) }));
    const games = [f.wolf, dots];
    const results = calculateInternalGameResults(games, f.round(cards, games));
    expect(results.get(dots.id)?.dots?.issues).toEqual([]);
    expect(results.get(dots.id)?.dots?.holes[0]?.points.map((point) => point.dots)).toEqual([1, 1, 0, 0]);
    expect(results.get(f.wolf.id)?.wolf?.comeback?.status).toBe('available');
    expect(results.get(f.wolf.id)?.wolf?.holes.find((hole) => hole.number === 17)?.wolfId).not.toBeNull();
    const missingChoice = cards.map((card) => card.playerId === f.anchor ? { ...card,
      holes: card.holes.map((hole) => hole.number === 16 ? { ...hole, score: { ...hole.score, wolf: [] } } : hole) } : card);
    expect(calculateInternalGameResults(games, f.round(missingChoice, games)).get(f.wolf.id)?.wolf?.comeback?.status).toBe('pending');
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
    expect(isDotAwardAudit({ ...audit, stringRulesVersion: 2 })).toBe(true);
    expect(isDotAwardAudit({ ...audit, stringRulesVersion: 1 })).toBe(false);
    expect(isDotAwardAudit({ ...audit, after: result.awards.map((award) => ({ ...award, dots: 99 })) })).toBe(false);
    expect(isDotAwardAudit({ ...audit, actorId: strokeGameId(1999) })).toBe(false);
  });
});
