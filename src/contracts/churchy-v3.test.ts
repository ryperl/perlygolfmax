import { describe, expect, it, vi } from 'vitest';
import { churchyV3CategoryFixture, churchyV3Fixture } from '../domain/churchy-v3.test-support.js';
import { isChurchyDefinition, isChurchyResult, isChurchySpecials } from './churchy.js';
import { isRoundGameDefinitions } from './games.js';
import { decodeRoundScores, isHoleScore, isRoundScores } from './scoring.js';
import { leanRoundScores } from './lean-round-scores.js';
import { strokeGameId } from '../domain/stroke-games.test-support.js';
import { isRecord } from './events.js';
import { calculateGameResults } from '../domain/stableford.js';
import type { DotsPlayerDeclaration } from '../domain/dots.js';
import type { Scorecard } from '../domain/scoring.js';
import { createScoresClient } from '../client/scoring.js';

type OpponentSpecial = 'walk' | 'pickup' | 'paree' | 'murphy' | 'pully-murphy';

function opponentAwardFixture(kind: OpponentSpecial, count: 9 | 18 = 18, start = 1, offset = 0) {
  const f = churchyV3Fixture(count, start);
  const first = f.ids[0];
  if (!first) throw new Error('Missing fictional first golfer.');
  const order = [...f.ids].reverse();
  const number = (start - 1 + offset) % count + 1;
  const game = { ...f.game, specials: [{ kind, units: 1 }] };
  const declaration: DotsPlayerDeclaration = {
    playerId: first,
    counts: kind === 'walk' ? { walk: 1 } : kind === 'pickup' ? { pickup: 1 } : {},
    calls: kind === 'walk' || kind === 'pickup' ? [] : [{
      id: strokeGameId(951), kind, result: 'failure', ...(kind === 'murphy' ? { murphyPresses: 2 } : {}),
    }],
  };
  const beforeCards = f.cards.map((card, index) => index ? card : { ...card,
    holes: card.holes.map((hole) => hole.number !== start ? hole : { ...hole,
      score: { kind: 'strokes' as const, strokes: 4, churchy: f.declaration(start, order) } }) });
  const cards = beforeCards.map((card, index) => index ? card : { ...card, etag: 'fictional-card-remote-v2',
    holes: card.holes.map((hole) => hole.number !== number ? hole : { ...hole,
      score: { kind: 'strokes' as const, strokes: 5, churchy: {
        ...f.declaration(number, number === start ? order : undefined), players: [declaration],
      } } }) });
  function view(input: readonly Scorecard[]) {
    const round = f.round(input);
    if (!round.games) throw new Error('Missing fictional Churchie game.');
    return { ...round, permissions: { role: 'public' as const, writePlayerIds: f.ids, canManageGames: false },
      games: { configuration: { ...round.games.configuration, games: [game] },
        results: calculateGameResults([game], f.snapshot, input) } };
  }
  return { ...f, game, number, before: view(beforeCards), round: view(cards) };
}

function tamper(value: unknown, path: readonly (string | number)[], replacement: unknown): unknown {
  const [key, ...remaining] = path;
  if (key === undefined) return replacement;
  if (Array.isArray(value)) return value.map((entry: unknown, index: number) =>
    index === key ? tamper(entry, remaining, replacement) : entry);
  if (!isRecord(value)) throw new Error('Invalid fictional corruption path');
  return { ...value, [key]: tamper(value[key], remaining, replacement) };
}

describe('Churchie v3 strict definitions, receipts and coherent lean round transport', () => {
  it.each(['walk', 'pickup', 'paree', 'murphy', 'pully-murphy'] as const)(
    'accepts the same opponent recipients in roster order for %s across partner blocks and playing circuits', (kind) => {
      for (const [count, start, offset] of [[18, 1, 0], [18, 1, 3], [18, 1, 6], [9, 7, 0], [9, 7, 3], [9, 7, 6]] as const) {
        const f = opponentAwardFixture(kind, count, start, offset);
        const result = f.round.games.results[0], receipt = result?.churchy?.holes.find((hole) => hole.number === f.number);
        const special = receipt?.specials[0], source = f.ids[0];
        const opposingPair = receipt?.pairs.find((pair) => !pair.includes(source ?? ''));
        expect(special?.winners).toEqual([...(opposingPair ?? [])].reverse());
        expect(isChurchyResult(result, f.game)).toBe(true);
        expect(isRoundScores(f.round)).toBe(true);
        expect(decodeRoundScores(leanRoundScores(f.round))).toEqual(f.round);
      }
    });

  it('still rejects duplicate, foreign and mixed-side special recipients', () => {
    const f = opponentAwardFixture('murphy');
    const result = f.round.games.results[0];
    if (!result) throw new Error('Missing fictional Churchie result.');
    for (const recipients of [[f.ids[1], f.ids[1]], [f.ids[0], f.ids[1]], [f.ids[1], strokeGameId(999)]]) {
      expect(isChurchyResult(tamper(result, ['churchy', 'holes', 0, 'specials', 0, 'winners'], recipients), f.game)).toBe(false);
    }
  });

  it('loads a remote failed-Murphy edit through the actual lean client without rejecting or rewriting the saved cards', async () => {
    const f = opponentAwardFixture('murphy');
    const send = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(leanRoundScores(f.before))))
      .mockResolvedValueOnce(new Response(JSON.stringify(leanRoundScores(f.round))));
    const token = vi.fn().mockRejectedValue(new Error('Public reads must not request an identity token.'));
    const client = createScoresClient('https://fictional.example.test/api/public', token, send, 'None');
    const signal = new AbortController().signal;
    await expect(client.load(f.before.eventId, f.before.roundId, signal)).resolves.toEqual(f.before);
    await expect(client.load(f.round.eventId, f.round.roundId, signal)).resolves.toEqual(f.round);
    expect(send.mock.calls.every(([, options]) => options?.method === undefined)).toBe(true);
    expect(token).not.toHaveBeenCalled();
  });
  it.each([[3, 'kp'], [5, 'blue-plate'], [5, 'long-drive']] as const)(
    'reconstructs %s default-tee categories independently of the first golfer’s personal tee (%s)', (par, category) => {
      const f = churchyV3CategoryFixture(par, 4, category);
      expect(isRoundScores(f.view)).toBe(true);
      expect(decodeRoundScores(leanRoundScores(f.view))).toEqual(f.view);
      const wrongDefault = f.view.layout.map((hole) => hole.number === 1 ? { ...hole, par: 4 } : hole);
      const tampered = { ...f.view, layout: wrongDefault };
      expect(isRoundScores(tampered)).toBe(false);
      expect(decodeRoundScores(leanRoundScores(tampered))).toBeNull();
    });

  it('accepts explicit tee/approach definitions and copied shared units without accepting Sticky as a second kind', () => {
    const f = churchyV3Fixture();
    expect(isChurchyDefinition(f.game)).toBe(true);
    expect(isChurchyDefinition({ ...f.game, name: 'Churcie' })).toBe(true);
    expect(isChurchyDefinition({ ...f.game, orderMode: 'tee' })).toBe(true);
    expect(isRoundGameDefinitions([f.game])).toBe(true);
    for (const edit of [{ orderMode: undefined }, { orderMode: 'gps' }, { name: '' },
      { specials: [{ kind: 'sticky', units: 1 }] }, { specials: [{ kind: 'other', units: -1 }] },
      { specials: [{ kind: 'dime', units: 1 }, { kind: 'dime', units: 2 }] }, { enabledSpecials: [] }]) {
      expect(isChurchyDefinition({ ...f.game, ...edit })).toBe(false);
    }
  });

  it('accepts canonical Dots declarations, Other and Murphy stages, rejects unknown keys and forged kinds', () => {
    const f = churchyV3Fixture();
    const record = { ...f.declaration(1, f.ids), players: [{ playerId: f.ids[0] ?? '',
      counts: { other: 2 }, calls: [{ id: strokeGameId(950), kind: 'murphy', result: 'pending', murphyPresses: 2 }] }] };
    expect(isChurchySpecials(record)).toBe(true);
    expect(isHoleScore({ kind: 'unplayed', churchy: record })).toBe(true);
    expect(isChurchySpecials({ ...record, sticky: true })).toBe(false);
    expect(isChurchySpecials({ ...record, rotation: { playerIds: [f.ids[0], f.ids[0], f.ids[2], f.ids[3]] } })).toBe(false);
    expect(isChurchySpecials({ ...record, players: [{ ...record.players[0],
      calls: [{ id: strokeGameId(950), kind: 'paree', result: 'pending', murphyPresses: 1 }] }] })).toBe(false);
  });

  it.each([[18, 1], [18, 10], [18, 7], [9, 7]] as const)(
    'round-trips full/lean results in actual %i-hole playing order starting %i without transmitting eager award evidence', (count, start) => {
      const f = churchyV3Fixture(count, start);
      const round = f.round();
      expect(isChurchyResult(round.games?.results[0], f.game)).toBe(true);
      expect(isRoundScores(round)).toBe(true);
      const wire = leanRoundScores(round);
      expect(wire.round.games?.results[0]?.churchy).not.toHaveProperty('awards');
      expect(wire.round.games?.results[0]?.churchy?.holes[0]).not.toHaveProperty('specials');
      expect(decodeRoundScores(wire)).toEqual(round);
      expect(decodeRoundScores(tamper(wire, ['round', 'games', 'results', 0, 'churchy', 'holes', 0, 'high', 'carry'], 999))).toBeNull();
    });

  it('rejects altered order/partners, raw/derived totals, duplicated canonical receipts and unsupported capabilities', () => {
    const f = churchyV3Fixture(9, 7);
    const round = f.round();
    for (const mutate of [
      (value: Record<string, unknown>) => { value.dotsSpecialKinds = ['not-a-special']; },
      (value: Record<string, unknown>) => { value.churchyRulesVersions = [1, 2, 4]; },
    ]) {
      const value = { ...round };
      mutate(value);
      expect(isRoundScores(value)).toBe(false);
    }
    const wire = leanRoundScores(round);
    for (const [path, replacement] of [
      [['round', 'games', 'results', 0, 'players', 0, 'totalPoints'], 999],
      [['round', 'games', 'results', 0, 'churchy', 'holes', 0, 'pairs'], []],
      [['round', 'games', 'results', 0, 'churchy', 'order', 'playerIds'], [...f.ids].reverse()],
      [['round', 'cards', 0, 'holes', 6, 'score', 'strokes'], 1],
    ] as const) {
      expect(decodeRoundScores(tamper(wire, path, replacement))).toBeNull();
    }
    expect(isRoundScores({ ...round, dotsSpecialKinds: ['other'] })).toBe(true);
    expect(isRoundScores({ ...round, dotsSpecialKinds: ['other', 'other'] })).toBe(false);
  });
});
