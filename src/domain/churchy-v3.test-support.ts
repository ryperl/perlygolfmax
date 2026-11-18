import type { ChurchyGameDefinitionV3, ChurchySpecialsV3 } from './churchy.js';
import { defaultChurchySpecialSelections } from './churchy.js';
import type { RoundScores, Scorecard } from './scoring.js';
import { strokeGameFixture, strokeGamesRound } from './stroke-games.test-support.js';
import { calculateGameResults } from './stableford.js';
import type { DotsContest } from './dots.js';

export function churchyV3Fixture(count: 9 | 18 = 18, startingHole = 1, mode: 'tee' | 'approach' = 'approach') {
  const base = strokeGameFixture(count);
  const ids = base.cards.map((card) => card.playerId);
  const snapshot = { ...base.snapshot, groups: [{ number: 1, startingHole, playerIds: ids }] };
  const game: ChurchyGameDefinitionV3 = { id: '00000000-0000-4000-8000-000000000703', name: 'Churcie',
    kind: 'churchy', version: 3, basis: 'net', groupNumber: 1, playerIds: ids,
    currency: 'USD', amountPerDotMinor: 50, orderMode: mode, specials: defaultChurchySpecialSelections };
  const declaration = (number = startingHole, order?: readonly string[]): ChurchySpecialsV3 => ({
    version: 3, gameId: game.id, gameEtag: 'fictional-games-v3', number, players: [], contests: [],
    ...(order ? { rotation: { playerIds: order } } : {}),
  });
  const cards = base.cards.map((card, index) => ({ ...card, holes: card.holes.map((hole) => ({
    ...hole, score: { kind: 'strokes' as const, strokes: 4,
      ...(mode === 'approach' && index === 0 && hole.number === startingHole ? { churchy: declaration(startingHole, ids) } : {}) },
  })) }));
  function round(inputCards: readonly Scorecard[] = cards): RoundScores {
    const original = strokeGamesRound({ ...base, snapshot, cards: inputCards });
    return { ...original, cards: inputCards, groups: snapshot.groups, churchyEnabled: true,
      churchyRulesVersions: [1, 2, 3], teeStrokeAllocation: true,
      games: { configuration: { eventId: original.eventId, roundId: snapshot.id, etag: 'fictional-games-v3', games: [game] },
        results: calculateGameResults([game], snapshot, inputCards) } };
  }
  return { ...base, snapshot, cards, ids, game, declaration, round };
}

export function churchyV3CategoryFixture(defaultPar: 3 | 4 | 5, personalPar: 3 | 4 | 5,
  category: DotsContest['kind']) {
  const f = churchyV3Fixture(9);
  const tee = (par: number, id: number) => ({ ...f.snapshot.teeProfile, id,
    holes: f.snapshot.teeProfile.holes.map((hole) => hole.number === 1 ? { ...hole, par } : hole),
    totalPar: f.snapshot.teeProfile.totalPar + par - 4,
    ratings: f.snapshot.teeProfile.ratings.map((rating) => rating.type === 'Total'
      ? { ...rating, course: rating.course + par - 4 } : rating) });
  const snapshot = { ...f.snapshot, teeProfile: tee(defaultPar, 300),
    playerTees: [{ playerId: f.ids[0] ?? '', profile: tee(personalPar, 301) }] };
  const game: ChurchyGameDefinitionV3 = { ...f.game, specials: [{ kind: category, units: 2 }, { kind: 'birdie', units: 3 }] };
  const cards = f.cards.map((card, index) => index ? card : { ...card,
    holes: card.holes.map((hole) => hole.number !== 1 ? hole : { ...hole,
      score: { kind: 'strokes' as const, strokes: personalPar - 1, churchy: { ...f.declaration(1, f.ids),
        contests: [{ kind: category, status: 'awarded' as const, winnerId: card.playerId }] } } }) });
  const original = strokeGamesRound({ ...f, snapshot, cards });
  const view: RoundScores = { ...original, cards, churchyEnabled: true, churchyRulesVersions: [1, 2, 3],
    teeStrokeAllocation: true,
    games: { configuration: { eventId: original.eventId, roundId: snapshot.id, etag: 'fictional-games-v3', games: [game] },
      results: calculateGameResults([game], snapshot, cards) } };
  return { ...f, snapshot, game, cards, view };
}
