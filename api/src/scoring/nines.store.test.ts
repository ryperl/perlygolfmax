import { HttpRequest, InvocationContext } from '@azure/functions';
import { describe, expect, it, vi } from 'vitest';
import type { NinesGameDefinition } from '../../../src/domain/nines.js';
import { roundGameKinds } from '../../../src/domain/games.js';
import { isRecord } from '../../../src/contracts/events.js';
import { scoringFixture } from '../../test/scoring-fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { creator, event } from '../../test/fixtures.js';
import { runWithNinesSupport, withNinesNegotiation } from '../nines-negotiation.js';
import { ninesQuery } from '../../../src/contracts/nines-negotiation.js';

/** Exactly the rules query today's live website sends, copied from before Nines existed. */
const olderBrowserQuery = 'murphy=score-v1&paree=score-v1&stringRules=2&dotsCalls=score-v1&categorySweeps=1&churchyNames=1&sweepRules=2&dotCoexistence=2&gameHandicaps=1&gameCalculations=2&wolfOrders=1&dotsHighLow=2&dotsRules=3';
const newerBrowserQuery = `${olderBrowserQuery}&${ninesQuery}`;
import { createScoringHandler } from './handlers.js';
import { TablePurseStore } from '../purse/store.js';

async function fixture(playerCount: 3 | 4 = 3) {
  const f = await scoringFixture(playerCount);
  const ids = f.input.playerIds;
  const game: NinesGameDefinition = { id: identifier(31000), name: 'Fictional Nines', kind: 'nines', version: 1,
    basis: 'net', handicapRule: 'group-low-v1', groupNumber: 1, playerIds: ids.slice(0, 3), stakeMinor: 100 };
  const api = { verify: vi.fn().mockResolvedValue(creator), limiter: { check: vi.fn().mockResolvedValue(undefined) }, scores: f.scores };
  const context = new InvocationContext({ invocationId: 'fictional-nines', logHandler: () => undefined });
  /** Reads round scores through the real route wrapper, as a browser that does or does not ask for Nines. */
  async function read(asksForNines: boolean) {
    const query = `?${asksForNines ? newerBrowserQuery : olderBrowserQuery}`;
    const request = new HttpRequest({ method: 'GET', url: `https://fictional.example.test/api/scores${query}`,
      params: { id: event.id, roundId: f.roundId } });
    return withNinesNegotiation(createScoringHandler(() => api, 'scores'))(request, context);
  }
  const saveAsNewClient = (games: readonly NinesGameDefinition[], etag: string | null, operation: number) =>
    runWithNinesSupport(true, () => f.scores.saveGames(creator, event.id, f.roundId, games, etag, identifier(operation)));
  return { ...f, ids, game, read, saveAsNewClient };
}

function body(result: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>['read']>>): Record<string, unknown> {
  const value: unknown = 'jsonBody' in result ? result.jsonBody : undefined;
  if (!isRecord(value)) throw new Error('Expected a JSON body.');
  return value;
}

describe('Nines through the API, without disturbing older browsers', () => {
  it('a round without Nines reads exactly as before for older browsers; only new browsers see nines advertised', async () => {
    const f = await fixture();
    const older = body(await f.read(false));
    const newer = body(await f.read(true));
    expect(older.supportedGameKinds).toEqual(roundGameKinds.filter((kind) => kind !== 'nines'));
    expect(newer.supportedGameKinds).toEqual(roundGameKinds);
    expect({ ...newer, supportedGameKinds: older.supportedGameKinds }).toEqual(older);
  });

  it('saves Nines for a saved group of three, and returns its results to browsers that ask', async () => {
    const f = await fixture();
    const saved = await f.saveAsNewClient([f.game], null, 31001);
    expect(saved.round.games?.configuration.games).toEqual([f.game]);
    const response = await f.read(true);
    expect(response.status).toBe(200);
    const games = body(response).games;
    expect(isRecord(games) && Array.isArray(games.results) && games.results[0]).toMatchObject({ kind: 'nines', version: 1 });
  });

  it('an older browser reading a round with Nines is told to refresh (426), never sent data it would reject', async () => {
    const f = await fixture();
    await f.saveAsNewClient([f.game], null, 31002);
    const response = await f.read(false);
    expect(response.status).toBe(426);
    expect('jsonBody' in response && response.jsonBody).toEqual({ code: 'NINES_CLIENT_UPDATE_REQUIRED' });
  });

  it('an older browser saving games on a round with Nines is refused before anything changes', async () => {
    const f = await fixture();
    const saved = await f.saveAsNewClient([f.game], null, 31003);
    const before = new Map(f.rows);
    const renamed = { ...f.game, name: 'Renamed by an older browser' };
    await expect(runWithNinesSupport(false, () => f.scores.saveGames(creator, event.id, f.roundId, [renamed],
      saved.round.games?.configuration.etag ?? null, identifier(31004)))).rejects.toMatchObject({ status: 426 });
    expect(new Map(f.rows)).toEqual(before);
  });

  it('refuses Nines unless the saved group has exactly the game\'s three golfers', async () => {
    const f = await fixture(4);
    await expect(f.saveAsNewClient([f.game], null, 31005)).rejects.toMatchObject({ code: 'INVALID_NINES_GROUP' });
  });

  it('locks Nines once scoring starts, so the stake and opponents cannot change mid-round', async () => {
    const f = await fixture();
    const saved = await f.saveAsNewClient([f.game], null, 31006);
    await runWithNinesSupport(true, () => f.scores.write(creator, event.id, f.roundId, f.ids[0] ?? '', 1,
      { kind: 'strokes', strokes: 4 }, null, identifier(31007)));
    await expect(f.saveAsNewClient([{ ...f.game, stakeMinor: 500 }], saved.round.games?.configuration.etag ?? null, 31008))
      .rejects.toMatchObject({ code: 'MATCH_SETUP_LOCKED' });
  });

  it('an older browser saving a hole score on a round with Nines is refused before anything is stored', async () => {
    const f = await fixture();
    await f.saveAsNewClient([f.game], null, 31010);
    const before = new Map(f.rows);
    await expect(runWithNinesSupport(false, () => f.scores.write(creator, event.id, f.roundId, f.ids[0] ?? '', 1,
      { kind: 'strokes', strokes: 4 }, null, identifier(31011)))).rejects.toMatchObject({ status: 426 });
    expect(new Map(f.rows)).toEqual(before);
    // The same save from a browser that understands Nines goes through.
    await runWithNinesSupport(true, () => f.scores.write(creator, event.id, f.roundId, f.ids[0] ?? '', 1,
      { kind: 'strokes', strokes: 4 }, null, identifier(31012)));
    expect(new Map(f.rows)).not.toEqual(before);
  });

  it('an older browser sending every earlier rules flag still cannot refresh handicaps on a round with Nines', async () => {
    const f = await fixture();
    await f.saveAsNewClient([f.game], null, 31013);
    const workspace = await f.workspace.get(creator, event.id);
    const before = new Map(f.rows);
    // wolfOrders, dotsHighLow and dotsRulesV3 all supported, exactly like today's live site, but not Nines.
    await expect(runWithNinesSupport(false, () => f.workspace.refreshIndices(creator, event.id, f.roundId,
      identifier(31014), workspace.etag, true, true, true))).rejects.toMatchObject({ status: 426 });
    expect(new Map(f.rows)).toEqual(before);
  });

  it('an older browser sending every earlier rules flag cannot start a purse change on an event with Nines', async () => {
    const f = await fixture();
    await f.saveAsNewClient([f.game], null, 31015);
    const purse = new TablePurseStore(f.table, f.workspace, f.scores);
    const before = new Map(f.rows);
    await expect(runWithNinesSupport(false, () => purse.receive(creator, event.id, null, identifier(31016), {})))
      .rejects.toMatchObject({ status: 426 });
    expect(new Map(f.rows)).toEqual(before);
  });

  it('an older browser sending every earlier rules flag cannot stage a large game upload on a round with Nines', async () => {
    const f = await fixture();
    const saved = await f.saveAsNewClient([f.game], null, 31017);
    const before = new Map(f.rows);
    await expect(runWithNinesSupport(false, () => f.scores.receiveGames(creator, event.id, f.roundId, {},
      saved.round.games?.configuration.etag ?? null, identifier(31018)))).rejects.toMatchObject({ status: 426 });
    expect(new Map(f.rows)).toEqual(before);
  });
});
