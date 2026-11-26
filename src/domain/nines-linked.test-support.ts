import type { DotsGameDefinition } from './dots.js';
import type { RoundGameDefinition } from './games.js';
import { calculateInternalSettlements } from './internal-games.js';
import { matchGamesFixture } from './match-games.test-support.js';
import type { NinesGameDefinition } from './nines.js';
import type { HoleScore, RoundScores, Scorecard } from './scoring.js';
import { strokeGameId } from './stroke-games.test-support.js';

/**
 * A fictional group of three playing Nines at USD 1.00 per point with a linked Dots game.
 * Everyone shoots par, so Nines splits every hole; golfer 1 declares two Sandies on hole 1.
 */
export function ninesLinkedRound(ninesLinkedDots = true) {
  const f = matchGamesFixture(3);
  const [a = '', b = '', c = ''] = f.ids;
  const nines: NinesGameDefinition = { id: strokeGameId(1500), name: 'Fictional Nines', kind: 'nines', version: 1,
    basis: 'gross', groupNumber: 1, playerIds: [a, b, c], stakeMinor: 100 };
  const dots: DotsGameDefinition = { id: strokeGameId(1600), name: 'Fictional Dots', kind: 'dots', version: 1,
    groupNumber: 1, playerIds: [a, b, c], mode: 'linked', linkedGameId: nines.id, specials: [{ kind: 'sandy', units: 1 }] };
  const cards = f.cards.map((card): Scorecard => ({ ...card, holes: card.holes.map((hole) => {
    if (card.playerId !== a || hole.number !== 1) return hole;
    const dotsRecord = { number: 1, gameId: dots.id, gameEtag: 'fictional-game-revision',
      players: [{ playerId: a, counts: { sandy: 2 }, calls: [] }], contests: [] };
    return { ...hole, score: { ...hole.score, dots: [dotsRecord] } as HoleScore };
  }) }));
  const games: readonly RoundGameDefinition[] = [nines, dots];
  const base = f.round(cards, games);
  const round: RoundScores = { ...base, setupLocked: false,
    ...(ninesLinkedDots ? { ninesLinkedDots: true as const } : {}),
    internalSettlements: calculateInternalSettlements(games, base.games?.results ?? [], base) };
  return { f, a, b, c, nines, dots, round };
}
