import { describe, expect, it } from 'vitest';
import { matchGamesFixture } from '../domain/match-games.test-support.js';
import { calculateWolf } from '../domain/wolf.js';
import { wolfInputFromScores } from '../domain/game-declarations.js';
import { isHoleScore, isRoundScores } from './scoring.js';
import { isRoundGameDefinition, isRoundGamesView } from './games.js';
import { isWolfChoice, isWolfComebackReceipt, isWolfDefinition, isWolfRecord, isWolfResults, wolfRecordMatchesGame } from './wolf.js';
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

  it('requires an explicit nullable stake for version 2 and forbids stakes on legacy games', () => {
    const f = matchGamesFixture();
    expect(isWolfDefinition({ ...f.wolf, version: 2, stakeMinor: null })).toBe(true);
    expect(isWolfDefinition({ ...f.wolf, version: 2, stakeMinor: 125 })).toBe(true);
    for (const stakeMinor of [-1, 0.1, Number.MAX_SAFE_INTEGER + 1, '100', undefined]) {
      expect(isWolfDefinition({ ...f.wolf, version: 2, stakeMinor })).toBe(false);
    }
    expect(isWolfDefinition({ ...f.wolf, version: 2 })).toBe(false);
    expect(isWolfDefinition({ ...f.wolf, stakeMinor: null })).toBe(false);
  });

  it('recomputes earned results including contest evidence, contexts, awards and comeback', () => {
    const f = matchGamesFixture(), game = { ...f.wolf, version: 2 as const, stakeMinor: null };
    const round = wolfInputFromScores(f.round());
    const records = [{ number: 1, choice: { gameId: game.id, gameEtag: 'fictional-game-revision', mode: 'pig' as const } }];
    const context = { round, cards: f.cards, records }, result = calculateWolf(game, round, f.cards, records);
    expect(isWolfResults(result, game, context)).toBe(true);
    expect(isWolfResults(result, game)).toBe(false);
    for (const value of [
      { ...result, rulesVersion: 1 }, { ...result, awards: [{ id: 'invented' }] },
      { ...result, contexts: [] }, { ...result, comeback: { status: 'available', changed: false, receipt: null } },
      { ...result, holes: result.holes.map((hole) => hole.number === 1 ? { ...hole, contests: [] } : hole) },
      { ...result, players: result.players.map((player) => ({ ...player, balance: 99 })) },
    ]) expect(isWolfResults(value, game, context)).toBe(false);
  });

  it('checks strict public comeback receipts and contextual final-hole writes while retaining legacy concessions', () => {
    const f = matchGamesFixture(), game = { ...f.wolf, version: 2 as const, stakeMinor: null };
    const round = wolfInputFromScores(f.round());
    const records = round.layout.slice(0, -2).map((hole) => ({ number: hole.number,
      choice: { gameId: game.id, gameEtag: 'fictional-game-revision', mode: 'pig' as const } }));
    const receipt = calculateWolf(game, round, f.cards, records).comeback?.receipt;
    if (!receipt) throw new Error('Missing fictional comeback');
    expect(isWolfComebackReceipt(receipt)).toBe(true);
    expect(isWolfRecord({ ...records[0], comeback: receipt })).toBe(true);
    for (const invalid of [{ ...receipt, actorId: f.ids[0] }, { ...receipt, proof: '' },
      { ...receipt, totals: receipt.totals.map((entry) => ({ ...entry, dots: -1 })) },
      { ...receipt, afterHoles: receipt.afterHoles.slice(1) },
      { ...receipt, totals: [...receipt.totals.slice(1), receipt.totals[1]] }]) {
      expect(isWolfComebackReceipt(invalid)).toBe(false);
    }
    const first = records[0];
    if (!first) throw new Error('Missing fictional record');
    expect(wolfRecordMatchesGame(f.wolf, round, f.cards, { ...first, outcome: 'wolf' })).toBe(true);
    expect(wolfRecordMatchesGame(game, round, f.cards, { ...first, outcome: 'wolf' })).toBe(false);
    expect(wolfRecordMatchesGame(f.wolf, round, f.cards, { ...first, comeback: receipt })).toBe(false);
    const cards = f.cards.map((card, index) => index === 0 ? { ...card, holes: card.holes.map((hole) => ({
      ...hole, score: { ...hole.score, wolf: records.filter((record) => record.number === hole.number) },
    })) } : card);
    const final = { number: 17, choice: first.choice, comeback: receipt };
    expect(wolfRecordMatchesGame(game, round, cards, final)).toBe(true);
    expect(wolfRecordMatchesGame(game, round, cards, { ...first, comeback: receipt })).toBe(false);
    expect(wolfRecordMatchesGame(game, round, cards, { number: 17, choice: first.choice })).toBe(false);
    expect(wolfRecordMatchesGame(game, round, cards, { ...final, comeback: { ...receipt, proof: 'invented' } })).toBe(false);
  });
});
