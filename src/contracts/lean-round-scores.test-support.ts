import type { RoundScores, Scorecard } from '../domain/scoring.js';
import type { RoundGameScoringContext } from '../domain/game-declarations.js';
import type { DotsGameDefinition } from '../domain/dots.js';
import type { WolfGameDefinition } from '../domain/wolf.js';
import { calculateInternalGameResults, calculateInternalSettlements } from '../domain/internal-games.js';
import { strokeGameFixture, strokeGameId, strokeGamesRound } from '../domain/stroke-games.test-support.js';

/** Fictional, deliberately evidence-heavy linked foursomes; no production data. */
export function leanScoresFixture(playerCount: 4 | 12 = 4): RoundScores {
  const fixture = strokeGameFixture(18, playerCount);
  const base = strokeGamesRound(fixture);
  const linked = base.groups.map((group) => {
    const wolf: WolfGameDefinition = { id: strokeGameId(950 + (group.number - 1) * 2),
      name: 'Fictional Wolf', kind: 'wolf', version: 2, basis: 'gross',
      groupNumber: group.number, playerIds: group.playerIds, allowPig: true, stakeMinor: 50 };
    const dots: DotsGameDefinition = { id: strokeGameId(951 + (group.number - 1) * 2),
      name: 'Fictional specials', kind: 'dots', version: 1, groupNumber: group.number,
      playerIds: group.playerIds, mode: 'linked', linkedGameId: wolf.id,
      specials: ['hogan', 'sandy', 'dime', 'walk'].map((kind) => ({
        kind: kind === 'hogan' ? 'hogan' : kind === 'sandy' ? 'sandy' : kind === 'dime' ? 'dime' : 'walk', units: 1,
      })) };
    return { wolf, dots };
  });
  const games = linked.flatMap(({ wolf, dots }) => [wolf, dots]);
  const etag = 'fictional-games-v1';
  let cards: readonly Scorecard[] = base.cards.map((card, index) => {
    const pair = linked[Math.floor(index / 4)];
    if (!pair) throw new Error('Missing fictional linked games');
    const { wolf, dots } = pair;
    return { ...card, holes: card.holes.map((hole) => ({
      ...hole, score: { kind: 'strokes', strokes: index % 4 + 3,
        ...(index % 4 === 0 ? {
          wolf: hole.number > 16 ? [] : [{ number: hole.number, choice: { gameId: wolf.id, gameEtag: etag, mode: 'partner',
            partnerId: wolf.playerIds[hole.number % 4] ?? '' } }],
          dots: [{ number: hole.number, gameId: dots.id, gameEtag: etag,
            players: dots.playerIds.slice(0, 2).map((playerId) => ({
              playerId, counts: { hogan: 1, sandy: 2, dime: 1, walk: 1 }, calls: [],
            })), contests: [] }],
        } : {}),
      },
    })) };
  });
  const context = (): RoundGameScoringContext => ({ roundId: base.roundId, groups: base.groups, layout: base.layout,
    cards, ...(base.courseHandicaps ? { courseHandicaps: base.courseHandicaps } : {}), teeStrokeAllocation: true });
  const preliminary = calculateInternalGameResults(games, context());
  cards = cards.map((card, index) => {
    if (index % 4 !== 0) return card;
    const wolf = linked[Math.floor(index / 4)]?.wolf;
    const receipt = wolf && preliminary.get(wolf.id)?.wolf?.comeback?.receipt;
    if (!wolf || !receipt) throw new Error('Missing fictional comeback proof');
    return { ...card, holes: card.holes.map((hole) =>
      hole.number < 17 ? hole : { ...hole, score: { ...hole.score, wolf: [{
        number: hole.number, choice: { gameId: wolf.id, gameEtag: etag, mode: 'partner',
          partnerId: wolf.playerIds.find((id) => id !== receipt.wolfId) ?? '' }, comeback: receipt,
      }] } }) };
  });
  const results = [...calculateInternalGameResults(games, context()).values()];
  return { ...base, cards, teeStrokeAllocation: true,
    wolfRulesVersions: [1, 2], dotsRulesVersions: [1, 2], internalGamesSupported: true,
    games: { configuration: { eventId: base.eventId, roundId: base.roundId, etag, games }, results },
    internalSettlements: calculateInternalSettlements(games, results, context()) };
}
