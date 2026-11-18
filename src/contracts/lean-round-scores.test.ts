import { describe, expect, it } from 'vitest';
import { calculateChurchyResults } from '../domain/churchy.js';
import type { ChurchyGameDefinition } from '../domain/churchy.js';
import { strokeGameId } from '../domain/stroke-games.test-support.js';
import { decodeRoundScores, isRoundScores } from './scoring.js';
import { leanRoundScores, leanScoreWriteResult } from './lean-round-scores.js';
import { leanScoresFixture } from './lean-round-scores.test-support.js';
import { fictionalChange } from '../client/scoring.test-support.js';
import { calculateInternalGameResults, calculateInternalSettlements } from '../domain/internal-games.js';
import { isRecord } from './events.js';

describe('lean routine round scores', () => {
  it('fits a fictional 12-player three-foursome heavy profile inline with all canonical comeback receipts', () => {
    const round = leanScoresFixture(12);
    expect(isRoundScores(round)).toBe(true);
    const wire = leanRoundScores(round);
    const fullBytes = new TextEncoder().encode(JSON.stringify(round)).length;
    const leanBytes = new TextEncoder().encode(JSON.stringify(wire)).length;
    console.info(`Fictional 12-player linked round: full=${String(fullBytes)}B lean=${String(leanBytes)}B`);
    expect(round.cards).toHaveLength(12);
    expect(round.groups).toHaveLength(3);
    expect(round.games?.results.flatMap((result) => result.dots?.awards ?? []).length).toBeGreaterThanOrEqual(3 * 138);
    expect(leanBytes).toBeLessThanOrEqual(256 * 1024);
    expect(wire.round.cards).toEqual(round.cards);
    for (const result of wire.round.games?.results ?? []) {
      if (result.dots) expect(result.dots).not.toHaveProperty('players');
      if (result.wolf) {
        expect(result.wolf).not.toHaveProperty('players');
        expect(result.wolf).not.toHaveProperty('contexts');
        expect(result.wolf).toMatchObject({ comeback: { status: 'saved', receipt: { savedHole: 17 } } });
      }
    }
    expect(decodeRoundScores(JSON.parse(JSON.stringify(wire)))).toEqual(round);
  });

  it('restores saved proof references only from the actual canonical card, never another receipt or a generated proof', () => {
    const round = leanScoresFixture(12);
    const wire = leanRoundScores(round);
    const games = wire.round.games;
    if (!games) throw new Error('Missing fictional games');
    const changed = (receipt: unknown) => ({ ...wire, round: { ...wire.round, games: {
      ...games, results: games.results.map((result) => result.kind !== 'wolf' || !result.wolf ? result : {
        ...result, wolf: { ...result.wolf,
          comeback: { ...round.games?.results.find((entry) => entry.gameId === result.gameId)?.wolf?.comeback, receipt } },
      }),
    } } });
    for (const receipt of [{ savedHole: 1 }, { savedHole: '17' }, { savedHole: 17, proof: 'forged' }]) {
      expect(decodeRoundScores(changed(receipt))).toBeNull();
    }
    const missingCanonical = { ...wire, round: { ...wire.round,
      cards: wire.round.cards.map((card) => ({ ...card, holes: card.holes.map((hole) => hole.number !== 17 ? hole : {
        ...hole, score: { kind: 'strokes', strokes: 4 },
      }) })) } };
    expect(decodeRoundScores(missingCanonical)).toBeNull();
  });

  it('retains available pre-write comeback proofs in full when there is no canonical saved receipt to reference', () => {
    const base = leanScoresFixture(12);
    const cards = base.cards.map((card) => ({ ...card,
      holes: card.holes.map((hole) => hole.number < 17 ? hole : { ...hole, score: { kind: 'unplayed' as const } }) }));
    const games = base.games?.configuration.games ?? [];
    const context = { roundId: base.roundId, groups: base.groups, layout: base.layout, cards,
      ...(base.courseHandicaps ? { courseHandicaps: base.courseHandicaps } : {}), teeStrokeAllocation: true };
    const results = [...calculateInternalGameResults(games, context).values()];
    const round = { ...base, cards, games: { configuration: {
      eventId: base.eventId, roundId: base.roundId, etag: 'fictional-games-v1', games,
    }, results }, internalSettlements: calculateInternalSettlements(games, results, context) };
    expect(isRoundScores(round)).toBe(true);
    const wire = leanRoundScores(round);
    for (const result of wire.round.games?.results ?? []) {
      if (!result.wolf || !isRecord(result.wolf.comeback)) continue;
      expect(result.wolf.comeback.status).toBe('available');
      expect(result.wolf.comeback.receipt).toEqual(results.find((entry) => entry.gameId === result.gameId)?.wolf?.comeback?.receipt);
      expect(result.wolf.comeback.receipt).toHaveProperty('proof');
      expect(result.wolf.comeback.receipt).not.toHaveProperty('savedHole');
    }
    expect(decodeRoundScores(wire)).toEqual(round);
    const view = wire.round.games;
    if (!view) throw new Error('Missing fictional games');
    expect(decodeRoundScores({ ...wire, round: { ...wire.round, games: {
      ...view, results: view.results.map((result) => !result.wolf || !isRecord(result.wolf.comeback) ? result : {
        ...result, wolf: { ...result.wolf, comeback: { ...result.wolf.comeback, receipt: { savedHole: 17 } } },
      }),
    } } })).toBeNull();
  });

  it('still compares preserved Wolf transfers and Dots per-hole totals after omitting their duplicate ledgers', () => {
    const round = leanScoresFixture(12);
    const games = round.games;
    if (!games) throw new Error('Missing fictional games');
    for (const kind of ['wolf', 'dots'] as const) {
      const changed = { ...round, games: { ...games, results: games.results.map((result) => ({
        ...result,
        ...(kind === 'wolf' && result.wolf ? { wolf: { ...result.wolf,
          holes: result.wolf.holes.map((hole) => ({ ...hole,
            transfers: hole.transfers.map((transfer) => ({ ...transfer, dots: transfer.dots + 1 })),
          })) } } : {}),
        ...(kind === 'dots' && result.dots ? { dots: { ...result.dots,
          holes: result.dots.holes.map((hole) => ({ ...hole,
            points: hole.points.map((point) => ({ ...point, dots: point.dots === null ? null : point.dots + 1 })),
          })) } } : {}),
      })) } };
      expect(decodeRoundScores(leanRoundScores(changed))).toBeNull();
    }
  });

  it('accepts earlier lean duplicates only when they still agree with authoritative transmitted players and holes', () => {
    const round = leanScoresFixture();
    const wire = leanRoundScores(round);
    const games = wire.round.games;
    if (!games) throw new Error('Missing fictional games');
    const earlier = { ...wire, round: { ...wire.round, games: {
      ...games, results: games.results.map((result) => {
        const source = round.games?.results.find((entry) => entry.gameId === result.gameId);
        return { ...result,
          ...(result.dots ? { dots: { ...result.dots, players: source?.dots?.players } } : {}),
          ...(result.wolf ? { wolf: { ...result.wolf, players: source?.wolf?.players,
            contexts: source?.wolf?.contexts, comeback: source?.wolf?.comeback } } : {}),
        };
      }),
    } } };
    expect(decodeRoundScores(earlier)).toEqual(round);
    const invalid = { ...earlier, round: { ...earlier.round, games: {
      ...earlier.round.games, results: earlier.round.games.results.map((result) => ({
        ...result,
        ...(result.dots ? { dots: { ...result.dots, players: [] } } : {}),
        ...(result.wolf ? { wolf: { ...result.wolf, contexts: [], players: [] } } : {}),
      })),
    } } };
    expect(decodeRoundScores(invalid)).toBeNull();
  });

  it('fits an evidence-heavy fictional linked foursome inline without changing gameplay, money or comeback proofs', () => {
    const round = leanScoresFixture();
    expect(isRoundScores(round)).toBe(true);
    const original = JSON.stringify(round);
    const wire = leanRoundScores(round);
    const text = JSON.stringify(wire);
    const fullBytes = new TextEncoder().encode(original).byteLength;
    const leanBytes = new TextEncoder().encode(text).byteLength;
    expect(fullBytes).toBeGreaterThan(256 * 1024);
    expect(round.games?.results.find((result) => result.dots)?.dots?.awards.length).toBeGreaterThanOrEqual(138);
    expect(leanBytes).toBeLessThanOrEqual(256 * 1024);
    expect(leanBytes).toBeLessThan(fullBytes / 2);
    expect(text).not.toContain('"awards"');
    expect(text).toContain('"proof"');
    expect(text).toContain('"internalSettlements"');
    expect(decodeRoundScores(wire)).toEqual(round);
    expect(decodeRoundScores(JSON.parse(text))).toEqual(round);
    expect(JSON.stringify(round)).toBe(original);
    console.info(`Fictional linked foursome round: full=${String(fullBytes)}B lean=${String(leanBytes)}B`);
  });

  it.each(['unplayed', 'picked-up', 'did-not-finish'] as const)('preserves %s and unavailable/stale-comeback states without inventing totals', (kind) => {
    const base = leanScoresFixture();
    const cards = base.cards.map((card) => ({ ...card, holes: card.holes.map((hole) => ({
      ...hole, score: { kind, ...(hole.score.wolf ? { wolf: hole.score.wolf } : {}),
        ...(hole.score.dots ? { dots: hole.score.dots } : {}) },
    })) }));
    const games = base.games?.configuration.games ?? [];
    const context = { roundId: base.roundId, layout: base.layout, groups: base.groups, cards,
      ...(base.courseHandicaps ? { courseHandicaps: base.courseHandicaps } : {}), teeStrokeAllocation: true };
    const results = [...calculateInternalGameResults(games, context).values()];
    const round = { ...base, cards, games: { configuration: {
      eventId: base.eventId, roundId: base.roundId, etag: 'fictional-games-v1', games,
    }, results }, internalSettlements: calculateInternalSettlements(games, results, context) };
    expect(isRoundScores(round)).toBe(true);
    expect(decodeRoundScores(leanRoundScores(round))).toEqual(round);
  });

  it('rejects altered transmitted totals, hole points, states, money, captures and proofs instead of replacing them', () => {
    const round = leanScoresFixture();
    const wire = leanRoundScores(round);
    const games = wire.round.games;
    if (!games) throw new Error('Missing fictional games');
    for (const result of games.results) {
      const changed = { ...wire, round: { ...wire.round, games: { ...games, results: games.results.map((entry) =>
        entry === result ? { ...entry, players: entry.players.map((player) => ({ ...player, totalPoints: 999 })) } : entry) } } };
      expect(decodeRoundScores(changed)).toBeNull();
    }
    const mutations = [
      { setupLocked: false },
      { courseHandicaps: [{ playerId: round.cards[0]?.playerId, courseHandicap: 0 }] },
      { internalSettlements: [] },
      { games: { ...games, results: games.results.map((result) => result.dots ? {
        ...result, dots: { ...result.dots, awards: [] },
      } : result) } },
      { games: { ...games, results: games.results.map((result) => result.dots ? {
        ...result, dots: { ...result.dots, holes: [{ number: 1, status: 'complete', points: [] }] },
      } : result) } },
      { games: { ...games, results: games.results.map((result) => result.wolf ? {
        ...result, wolf: { ...result.wolf, comeback: { status: 'available', receipt: null, changed: false } },
      } : result) } },
    ];
    for (const changed of mutations) expect(decodeRoundScores({ ...wire, round: { ...wire.round, ...changed } })).toBeNull();
    expect(decodeRoundScores({ ...wire, version: 2 })).toBeNull();
    expect(decodeRoundScores({ ...wire, evidence: [] })).toBeNull();
    expect(decodeRoundScores(round)).toEqual(round);
  });

  it('omits Churchy award explanations but preserves per-hole numeric awards, lanes, carry and settlement', () => {
    const base = leanScoresFixture();
    for (const version of [1, 2] as const) {
      const game: ChurchyGameDefinition = {
        id: strokeGameId(970), name: 'Churchy Game', kind: 'churchy', basis: 'net',
        groupNumber: 1, playerIds: base.cards.map((card) => card.playerId), currency: 'USD', amountPerDotMinor: 50,
        ...(version === 1 ? { version: 1 } : { version: 2, enabledSpecials: ['birdie', 'eagle'] }),
      };
      const cards = base.cards.map((card) => ({ ...card, holes: card.holes.map((hole) => ({
        ...hole, score: { kind: 'strokes' as const, strokes: 3 },
      })) }));
      const result = calculateChurchyResults(game, cards.map((card) => ({
        playerId: card.playerId, displayName: card.displayName, layout: base.layout, handicap: 0,
      })), cards);
      const round = { ...base, cards, internalSettlements: [],
        games: { configuration: { eventId: base.eventId, roundId: base.roundId, etag: 'fictional-v1', games: [game] }, results: [result] } };
      expect(isRoundScores(round)).toBe(true);
      const wire = leanRoundScores(round);
      expect(JSON.stringify(wire)).not.toContain('"specials"');
      expect(JSON.stringify(wire)).toContain('"awards"');
      expect(decodeRoundScores(wire)).toEqual(round);
    }
  });

  it('drops private historical award snapshots only from lean acknowledgements without mutating the stored receipt', () => {
    const result = { round: leanScoresFixture(), change: { ...fictionalChange, dotAwardAudit: [] } };
    expect(leanScoreWriteResult(result).change).not.toHaveProperty('dotAwardAudit');
    expect(result.change).toHaveProperty('dotAwardAudit');
  });
});
