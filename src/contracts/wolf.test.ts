import { describe, expect, it } from 'vitest';
import { matchGamesFixture } from '../domain/match-games.test-support.js';
import { calculateWolf } from '../domain/wolf.js';
import { wolfInputFromScores } from '../domain/game-declarations.js';
import { isHoleScore, isRoundScores } from './scoring.js';
import { isRoundGameDefinition, isRoundGamesView } from './games.js';
import { isWolfChoice, isWolfDefinition, isWolfRecord, isWolfResults } from './wolf.js';
import { strokeGameId } from '../domain/stroke-games.test-support.js';

describe('Wolf network contracts', () => {
  it('validates exact definitions, mode-specific choices and server-authored late markers without Stableford fields', () => {
    const f = matchGamesFixture();
    const choice = { gameId: f.wolf.id, gameEtag: 'fictional-game-revision', mode: 'pig' };
    expect(isWolfDefinition(f.wolf)).toBe(true);
    expect(isRoundGameDefinition(f.wolf)).toBe(true);
    for (const invalid of [{ ...f.wolf, playerIds: [...f.ids, f.ids[0]] }, { ...f.wolf, format: 'individual' },
      { ...f.wolf, points: [] }, { ...f.wolf, allowPig: 1 }, { ...f.wolf, groupNumber: 0 }]) expect(isWolfDefinition(invalid)).toBe(false);
    expect(isWolfChoice(choice)).toBe(true);
    expect(isWolfChoice({ ...choice, mode: 'partner', partnerId: f.ids[1] })).toBe(true);
    expect(isWolfChoice({ ...choice, partnerId: f.ids[1] })).toBe(false);
    expect(isWolfChoice({ ...choice, mode: 'partner' })).toBe(false);
    expect(isWolfRecord({ number: 1, choice, recordedLate: true })).toBe(true);
    expect(isWolfRecord({ number: 1, choice, recordedLate: false })).toBe(false);
    expect(isHoleScore({ kind: 'unplayed', wolf: [{ number: 1, choice }] })).toBe(true);
    expect(isHoleScore({ kind: 'unplayed', wolf: [{ number: 1, choice }, { number: 1, choice }] })).toBe(false);
  });

  it('verifies zero-sum receipts and exact contextual rotation rather than accepting self-consistent invented wins', () => {
    const f = matchGamesFixture();
    const record = { number: 1, choice: { gameId: f.wolf.id, gameEtag: 'fictional-game-revision', mode: 'pig' as const }, outcome: 'wolf' as const };
    const input = wolfInputFromScores(f.round());
    const result = calculateWolf(f.wolf, input, f.cards, [record]);
    expect(isWolfResults(result, f.wolf, { round: input, cards: f.cards, records: [record] })).toBe(true);
    expect(isWolfResults(result, f.wolf, { round: input, cards: f.cards, records: [] })).toBe(false);
    for (const invalid of [
      { ...result, holes: result.holes.map((hole) => hole.number === 1 ? { ...hole, stake: 2 } : hole) },
      { ...result, players: result.players.map((player) => ({ ...player, balance: 99 })) },
      { ...result, actorId: strokeGameId(1000) },
    ]) expect(isWolfResults(invalid, f.wolf)).toBe(false);
  });

  it('binds both game families to public cards, captured context and published CH; keeps group-only Wolf rows valid', () => {
    const f = matchGamesFixture(8);
    const round = f.round();
    expect(isRoundScores(round)).toBe(true);
    expect(isRoundGamesView(round.games, round)).toBe(true);
    expect(isRoundGamesView(round.games)).toBe(false);
    const { gameInputContext: context, ...missing } = round;
    expect(context).toBeDefined();
    expect(isRoundScores(missing)).toBe(false);
    const games = round.games;
    if (!games) throw new Error('Missing fictional games');
    expect(isRoundScores({ ...round, games: { ...games, results: games.results.map((result) =>
      result.kind === 'wolf' ? { ...result, players: [] } : result) } })).toBe(false);
    expect(isRoundScores({ ...round, gameInputContext: { ...round.gameInputContext, handicapIndex: 'private' } })).toBe(false);
    expect(isRoundScores({ ...round, supportedGameKinds: ['wolf', 'unknown-game'] })).toBe(false);
  });
});
