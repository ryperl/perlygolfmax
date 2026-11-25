/**
 * Characterization tests: they record what every existing game calculates today, so adding a new
 * game kind (Nines) cannot silently change existing results or money. The snapshot was generated
 * from the code before Nines existed. If one of these fails, an existing game changed: find out why
 * before updating the snapshot.
 */
import { describe, expect, it } from 'vitest';
import type { DotsGameDefinition } from './dots.js';
import type { RoundGameDefinition } from './games.js';
import { calculateInternalSettlements } from './internal-games.js';
import { matchGamesFixture } from './match-games.test-support.js';
import type { HoleScore, Scorecard } from './scoring.js';
import { calculateGameResults, stablefordPoints } from './stableford.js';
import { strokeGameId } from './stroke-games.test-support.js';
import { churchyV3Fixture } from './churchy-v3.test-support.js';
import type { WolfGameDefinition, WolfHoleRecord } from './wolf.js';
import { wolfForHole } from './wolf.js';

/** A fixed, varied scoring pattern: birdies, bogeys, a double, and one pickup per player. */
function variedScore(playerIndex: number, holeNumber: number): HoleScore {
  if (holeNumber === 7 + playerIndex) return { kind: 'picked-up' };
  const pattern = [4, 3, 5, 4, 6, 4, 3, 5, 4];
  const strokes = pattern[(holeNumber + playerIndex * 2) % pattern.length] ?? 4;
  return { kind: 'strokes', strokes };
}

function variedCards(cards: readonly Scorecard[]): readonly Scorecard[] {
  return cards.map((card, playerIndex) => ({
    ...card,
    holes: card.holes.map((hole) => ({ ...hole, score: variedScore(playerIndex, hole.number) })),
  }));
}

/** Gives each player a different handicap so net games have something to do. */
function withHandicaps<T extends ReturnType<typeof matchGamesFixture>['snapshot']>(snapshot: T): T {
  const values = ['2.4', '9.8', '15.1', '21.7'];
  return {
    ...snapshot,
    players: snapshot.players.map((player, index) => ({
      ...player,
      handicapIndex: { ...player.handicapIndex, value: values[index] ?? '0' },
    })),
  };
}

function scoreOnlyGames(ids: readonly string[], f: ReturnType<typeof matchGamesFixture>): readonly RoundGameDefinition[] {
  const group = ids.slice(0, 4);
  return [
    { id: strokeGameId(1001), name: 'Stableford', preset: 'standard', basis: 'net',
      handicapAllowancePercent: 95, points: stablefordPoints('standard') },
    { id: strokeGameId(1002), name: 'Modified Stableford', preset: 'modified', basis: 'gross',
      handicapAllowancePercent: 100, points: stablefordPoints('modified') },
    { id: strokeGameId(1003), name: 'Ball Drop', kind: 'ball-drop', version: 1, basis: 'net',
      format: 'ball-drop-net-gross', teams: [{ id: strokeGameId(1103), name: 'Team', playerIds: group }] },
    { id: strokeGameId(1004), name: 'Skins net', kind: 'skins', version: 1, basis: 'net', carryovers: true,
      handicapRule: 'full-course-v1' },
    { id: strokeGameId(1005), name: 'Skins gross', kind: 'skins', version: 1, basis: 'gross', carryovers: false },
    { id: strokeGameId(1006), name: 'Stroke Play SO', kind: 'stroke-play', version: 1, basis: 'net',
      handicapRule: 'group-low-v1' },
    { id: strokeGameId(1007), name: 'Stroke Play gross', kind: 'stroke-play', version: 1, basis: 'gross' },
    { ...f.nassau, id: strokeGameId(1008) },
    { id: strokeGameId(1009), name: 'Match Play', kind: 'match-play', version: 1, basis: 'net', groupNumber: 1,
      variant: 'singles', handicapRule: 'group-low-v1',
      sides: group.slice(0, 2).map((id, index) => ({ id: strokeGameId(1109 + index), name: `Side ${String(index + 1)}`,
        playerIds: [id] })),
      stakes: { currency: 'USD', frontMinor: 0, backMinor: 0, overallMinor: 500 }, automaticPresses: false },
    { id: strokeGameId(1010), name: 'Dots individual', kind: 'dots', version: 1, mode: 'individual',
      groupNumber: 1, playerIds: group, stakeMinor: 25, specials: [{ kind: 'birdie', units: 1 }] },
  ];
}

describe('existing game results stay exactly as they were before Nines', () => {
  it('score-only games: Stableford, Ball Drop, Skins, Stroke Play, Nassau, Match Play and individual Dots', () => {
    const f = matchGamesFixture();
    const snapshot = withHandicaps(f.snapshot);
    const cards = variedCards(f.cards);
    const games = scoreOnlyGames(f.ids, f);
    const results = calculateGameResults(games, snapshot, cards);
    expect(results).toMatchSnapshot();
    const round = f.round(cards, games);
    expect(calculateInternalSettlements(games, round.games?.results ?? [], round)).toMatchSnapshot();
  });

  it('Wolf version 2 linked with Dots, including the combined settlement', () => {
    const f = matchGamesFixture();
    const wolf: WolfGameDefinition = { ...f.wolf, version: 2, stakeMinor: 100 };
    const dots: DotsGameDefinition = { id: strokeGameId(1900), name: 'Linked specials', kind: 'dots', version: 1,
      groupNumber: 1, playerIds: f.ids, mode: 'linked', linkedGameId: wolf.id,
      specials: [{ kind: 'sandy', units: 1 }, { kind: 'birdie', units: 1 }] };
    const anchor = f.ids[0] ?? '';
    // Every hole but the final two needs a saved partner choice before Wolf can score it.
    const records = f.snapshot.teeProfile.holes.slice(0, -2).map((hole): WolfHoleRecord => {
      const wolfId = wolfForHole(wolf, { layout: f.snapshot.teeProfile.holes, groups: f.snapshot.groups }, hole.number);
      const partnerId = f.ids.find((id) => id !== wolfId) ?? '';
      return { number: hole.number, choice: { gameId: wolf.id, gameEtag: 'fictional-game-revision', mode: 'partner', partnerId } };
    });
    const cards = variedCards(f.cards).map((card): Scorecard => ({ ...card, holes: card.holes.map((hole) => ({ ...hole,
      score: { ...hole.score,
        ...(card.playerId === anchor ? { wolf: records.filter((record) => record.number === hole.number) } : {}),
        ...(card.playerId === anchor && hole.number === 1 ? { dots: [{ number: 1, gameId: dots.id,
          gameEtag: 'fictional-game-revision', players: [{ playerId: anchor, counts: { sandy: 1 }, calls: [] }],
          contests: [] }] } : {}) } as HoleScore })) }));
    const games = [wolf, dots];
    const round = f.round(cards, games);
    expect(round.games?.results).toMatchSnapshot();
    expect(calculateInternalSettlements(games, round.games?.results ?? [], round)).toMatchSnapshot();
  });

  it('Churchie version 3 with approach order', () => {
    const f = churchyV3Fixture(18);
    const round = f.round();
    expect(round.games?.results).toMatchSnapshot();
  });
});
