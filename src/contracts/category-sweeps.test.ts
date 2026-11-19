import { describe, expect, it } from 'vitest';
import type { DotsGameDefinition } from '../domain/dots.js';
import type { RoundScores } from '../domain/scoring.js';
import { matchGamesFixture } from '../domain/match-games.test-support.js';
import { calculateGameResults } from '../domain/stableford.js';
import { calculateInternalSettlements } from '../domain/internal-games.js';
import { decodeRoundScores, isRoundScores } from './scoring.js';
import { leanRoundScores } from './lean-round-scores.js';
import { CategorySweepsClientUpdateRequired, categorySweepRoundScores } from './category-sweeps.js';
import { isDotAwardAudit } from './dot-audit.js';
import { roundTee } from '../domain/round-tee.js';
import type { MatchPlayGameDefinition } from '../domain/nassau.js';

function fixture(affected = true) {
  const f = matchGamesFixture();
  const first = f.ids[0], second = f.ids[1];
  if (!first || !second) throw new Error('Missing fictional category winners');
  const game: DotsGameDefinition = { id: f.wolf.id, name: 'Fictional categories', kind: 'dots', version: 1,
    groupNumber: 1, playerIds: f.ids, mode: 'individual', stakeMinor: 50,
    specials: [{ kind: 'long-drive', units: 1 }, { kind: 'blue-plate', units: 1 }] };
  const snapshot = { ...f.snapshot, teeProfile: { ...f.snapshot.teeProfile,
    holes: f.snapshot.teeProfile.holes.map((hole) => ({ ...hole, par: hole.number === 1 ? 5 : 4 })) } };
  const cards = f.cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => ({ ...hole,
    score: { kind: 'strokes' as const, strokes: 4, ...(index === 0 && hole.number === 1 ? { dots: [{
      number: 1, gameId: game.id, gameEtag: 'fictional-game-revision', players: [],
      contests: [{ kind: 'long-drive' as const, status: 'awarded' as const, winnerId: first },
        { kind: 'blue-plate' as const, status: 'awarded' as const, winnerId: affected ? first : second }],
    }] } : {}) },
  })) }));
  const base = { ...f.round(cards, [game]), layout: snapshot.teeProfile.holes };
  const round = (version: 0 | 1): RoundScores => {
    const results = calculateGameResults([game], snapshot, cards, 2, version);
    const value = { ...base, stringRulesVersion: 2 as const, ...(version === 1 ? { dotsCategorySweepsVersion: 1 as const } : {}),
      games: { configuration: { eventId: base.eventId, roundId: base.roundId, games: [game], etag: 'fictional-game-revision' }, results } };
    return { ...value, internalSettlements: calculateInternalSettlements([game], results, value) };
  };
  return { current: round(1), legacy: round(0), game };
}

describe('negotiated Dots category sweep calculation context', () => {
  it('preserves both Match Play and category sweeps through full/lean decoding on a printed back nine', () => {
    const f = matchGamesFixture();
    const first = f.ids[0];
    if (!first) throw new Error('Missing fictional category winner');
    const tee = roundTee(f.snapshot.teeProfile, 'back');
    if (!tee) throw new Error('Missing fictional back-nine tee');
    const snapshot = { ...f.snapshot, groups: f.snapshot.groups.map((group) => ({ ...group, startingHole: 17 })),
      teeProfile: { ...tee, totalPar: tee.totalPar + 1,
        holes: tee.holes.map((hole) => hole.number === 10 ? { ...hole, par: 5 } : hole) } };
    const dots: DotsGameDefinition = { id: f.wolf.id, name: 'Fictional categories', kind: 'dots', version: 1,
      groupNumber: 1, playerIds: f.ids, mode: 'individual', stakeMinor: 50,
      specials: [{ kind: 'long-drive', units: 1 }, { kind: 'blue-plate', units: 1 }] };
    const match: MatchPlayGameDefinition = { ...f.nassau, kind: 'match-play',
      stakes: { ...f.nassau.stakes, frontMinor: 0, backMinor: 0 } };
    const games = [dots, match];
    const cards = f.cards.map((card, index) => ({ ...card, holes: card.holes.filter((hole) => hole.number >= 10)
      .map((hole) => ({ ...hole, score: { kind: 'strokes' as const, strokes: index === 0 ? 3 : 4,
        ...(index === 0 && hole.number === 10 ? { dots: [{ number: 10, gameId: dots.id,
          gameEtag: 'fictional-game-revision', players: [], contests: [
            { kind: 'long-drive' as const, status: 'awarded' as const, winnerId: first },
            { kind: 'blue-plate' as const, status: 'awarded' as const, winnerId: first },
          ] }] } : {}) } })) }));
    const results = calculateGameResults(games, snapshot, cards);
    const base = f.round(cards, games);
    const round: RoundScores = { ...base, groups: snapshot.groups, layout: snapshot.teeProfile.holes,
      stringRulesVersion: 2, dotsCategorySweepsVersion: 1,
      games: { configuration: { eventId: base.eventId, roundId: base.roundId, games, etag: 'fictional-game-revision' }, results } };
    const current = { ...round, internalSettlements: calculateInternalSettlements(games, results, round) };
    expect(results[0]?.dots?.awards.find((award) => award.kind === 'category-sweep')).toMatchObject({ number: 10, dots: 1 });
    expect(results[1]?.kind).toBe('match-play');
    expect(results[1]?.nassau?.matches[0]?.holes.map((hole) => hole.number)).toEqual([17, 18, 10, 11, 12, 13, 14, 15, 16]);
    expect(isRoundScores(current)).toBe(true);
    expect(decodeRoundScores(leanRoundScores(current, true, true, true, true, true))).toEqual(current);
    expect(() => leanRoundScores(current, true, true, true, true)).toThrow(CategorySweepsClientUpdateRequired);
  });

  it('strictly decodes both legacy and modern full/lean totals without accepting a forged or missing marker', () => {
    const f = fixture();
    expect(isRoundScores(f.current)).toBe(true);
    expect(isRoundScores(f.legacy)).toBe(true);
    expect(decodeRoundScores(leanRoundScores(f.current, true, true, true, true, true))).toEqual(f.current);
    expect(decodeRoundScores(leanRoundScores(f.legacy, true, true, true, true))).toEqual(f.legacy);
    expect(isRoundScores({ ...f.current, dotsCategorySweepsVersion: undefined })).toBe(false);
    expect(isRoundScores({ ...f.legacy, dotsCategorySweepsVersion: 1 })).toBe(false);
    for (const dotsCategorySweepsVersion of [null, 0, 2, '1', true]) {
      expect(isRoundScores({ ...f.current, dotsCategorySweepsVersion })).toBe(false);
    }
    const lean = leanRoundScores(f.current, true, true, true, true, true);
    if (!lean.round.games) throw new Error('Missing fictional games');
    const result = lean.round.games.results[0];
    if (!result) throw new Error('Missing fictional result');
    expect(decodeRoundScores({ ...lean, round: { ...lean.round, games: { ...lean.round.games,
      results: [{ ...result, players: result.players.map((player) => ({ ...player, totalPoints: 99 })) }],
    } } })).toBeNull();
  });

  it('rejects affected old reads rather than substituting old totals, but preserves agreeing old reads and new-reader/old-API context', () => {
    const f = fixture();
    expect(() => categorySweepRoundScores(f.current)).toThrow(CategorySweepsClientUpdateRequired);
    expect(() => leanRoundScores(f.current, true, true, true, true)).toThrow(CategorySweepsClientUpdateRequired);
    expect(categorySweepRoundScores(f.current, true)).toBe(f.current);
    expect(categorySweepRoundScores(f.legacy, true)).toBe(f.legacy);
    const unaffected = fixture(false);
    expect(categorySweepRoundScores(unaffected.current)).toEqual(unaffected.legacy);
    expect(decodeRoundScores(leanRoundScores(unaffected.current, true, true, true, true))).toEqual(unaffected.legacy);
    expect(f.current.games?.results[0]?.players[0]?.totalPoints).toBe(3);
    expect(f.legacy.games?.results[0]?.players[0]?.totalPoints).toBe(2);
  });

  it('validates explicit new audit markers while retaining unmarked immutable audit shapes', () => {
    const f = fixture();
    const audit = { gameId: f.game.id, kind: 'dots', version: 1, configuration: f.game,
      gameEtag: null, inputRevision: null, before: [], after: f.current.games?.results[0]?.dots?.awards ?? [] };
    expect(isDotAwardAudit(audit)).toBe(true);
    expect(isDotAwardAudit({ ...audit, dotsCategorySweepsVersion: 1 })).toBe(true);
    expect(isDotAwardAudit({ ...audit, dotsCategorySweepsVersion: 1, stringRulesVersion: 2 })).toBe(true);
    expect(isDotAwardAudit({ ...audit, dotsCategorySweepsVersion: 2 })).toBe(false);
  });
});
