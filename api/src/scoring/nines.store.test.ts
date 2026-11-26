import { HttpRequest, InvocationContext } from '@azure/functions';
import { describe, expect, it, vi } from 'vitest';
import type { NinesGameDefinition } from '../../../src/domain/nines.js';
import type { DotsGameDefinition } from '../../../src/domain/dots.js';
import { roundGameKinds } from '../../../src/domain/games.js';
import type { RoundGameDefinition } from '../../../src/domain/games.js';
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
import { testerFixture } from '../test-access/test-support.js';

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
  const saveAsNewClient = (games: readonly RoundGameDefinition[], etag: string | null, operation: number) =>
    runWithNinesSupport(true, () => f.scores.saveGames(creator, event.id, f.roundId, games, etag, identifier(operation)));
  return { ...f, ids, game, api, read, saveAsNewClient };
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

  it('an older browser cannot change round setup for an event with Nines; a Nines-aware browser can', async () => {
    const f = await fixture();
    await f.saveAsNewClient([f.game], null, 31019);
    const workspace = await f.workspace.get(creator, event.id);
    const before = new Map(f.rows);
    const renamed = { ...f.input, name: 'Renamed by an older browser' };
    await expect(runWithNinesSupport(false, () => f.workspace.save(creator, event.id, renamed, workspace.etag)))
      .rejects.toMatchObject({ status: 426 });
    await expect(runWithNinesSupport(false, () => f.workspace.receive(creator, event.id, {}, workspace.etag)))
      .rejects.toMatchObject({ status: 426 });
    expect(new Map(f.rows)).toEqual(before);
    const saved = await runWithNinesSupport(true, () => f.workspace.save(creator, event.id,
      { ...f.input, name: 'Renamed by a current browser' }, workspace.etag));
    expect(saved.event.name).toBe('Renamed by a current browser');
  });

  describe('Dots linked to Nines', () => {
    function linkedDots(f: Awaited<ReturnType<typeof fixture>>, specials: DotsGameDefinition['specials'] = [{ kind: 'walk', units: 1 }]) {
      const dots: DotsGameDefinition = { id: identifier(32000), name: 'Fictional linked Dots', kind: 'dots', version: 1,
        groupNumber: 1, playerIds: f.game.playerIds, mode: 'linked', linkedGameId: f.game.id, specials };
      return dots;
    }

    it('saves the link, scores a Walk for both opponents and settles once at the Nines stake', async () => {
      const f = await fixture();
      const dots = linkedDots(f);
      const saved = await f.saveAsNewClient([f.game, dots], null, 32001);
      const etag = saved.round.games?.configuration.etag ?? '';
      const [a = '', b = '', c = ''] = f.ids;
      const walk = { number: 1, gameId: dots.id, gameEtag: etag, contests: [],
        players: [{ playerId: a, counts: { walk: 1 }, calls: [] }] };
      await runWithNinesSupport(2, () => f.scores.write(creator, event.id, f.roundId, a, 1,
        { kind: 'strokes', strokes: 4, dots: [walk] }, null, identifier(32002)));
      // The others save hole 1 too, so the hole (and A's zero) is no longer pending.
      for (const [index, playerId] of [b, c].entries()) {
        await runWithNinesSupport(2, () => f.scores.write(creator, event.id, f.roundId, playerId, 1,
          { kind: 'strokes', strokes: 4 }, null, identifier(32010 + index)));
      }
      const round = await runWithNinesSupport(2, () => f.scores.get(creator, event.id, f.roundId));
      const result = round.games?.results.find((entry) => entry.gameId === dots.id);
      expect(result?.dots?.awards.find((award) => award.kind === 'walk')?.recipientIds).toEqual([b, c]);
      const settlement = round.internalSettlements?.find((entry) => entry.gameIds[0] === f.game.id);
      expect(settlement?.gameIds).toEqual([f.game.id, dots.id]);
      expect(settlement?.players.map((player) => player.specialDots)).toEqual([0, 1, 1]);
    });

    it('the site that predates linked Dots (nines=1) still reads plain Nines, but must refresh for a linked round', async () => {
      const f = await fixture();
      const plain = await f.saveAsNewClient([f.game], null, 32003);
      const etag = plain.round.games?.configuration.etag ?? null;
      // A level-1 site may not add the link, but still reads the plain Nines round.
      await expect(runWithNinesSupport(1, () => f.scores.saveGames(creator, event.id, f.roundId, [f.game, linkedDots(f)],
        etag, identifier(32004)))).rejects.toMatchObject({ status: 426 });
      expect((await f.read(true)).status).toBe(200);
      await f.saveAsNewClient([f.game, linkedDots(f)], etag, 32005);
      const request = new HttpRequest({ method: 'GET',
        url: `https://fictional.example.test/api/scores?${olderBrowserQuery}&nines=1`, params: { id: event.id, roundId: f.roundId } });
      const levelOne = await withNinesNegotiation(createScoringHandler(() => f.api, 'scores'))(request,
        new InvocationContext({ invocationId: 'fictional-level-one', logHandler: () => undefined }));
      expect(levelOne.status).toBe(426);
    });

    it('a legacy tester link, which sees neither game, still saves raw scores in a linked round', async () => {
      const f = await testerFixture();
      // Make group 2 a threesome for Nines; the eighth golfer plays alone in group 3.
      const ids = f.input.playerIds;
      const groups = [{ number: 1, playerIds: ids.slice(0, 4) }, { number: 2, playerIds: ids.slice(4, 7) },
        { number: 3, playerIds: ids.slice(7) }];
      const input = { ...f.input, rounds: f.input.rounds.map((round) => ({ ...round, groups })) };
      await f.workspace.save(creator, event.id, input, (await f.workspace.get(creator, event.id)).etag);
      const trio = ids.slice(4, 7);
      const nines: NinesGameDefinition = { id: identifier(33000), name: 'Fictional Nines', kind: 'nines', version: 1,
        basis: 'gross', groupNumber: 2, playerIds: trio, stakeMinor: 100 };
      const dots: DotsGameDefinition = { id: identifier(33001), name: 'Fictional linked Dots', kind: 'dots', version: 1,
        groupNumber: 2, playerIds: trio, mode: 'linked', linkedGameId: nines.id, specials: [{ kind: 'walk', units: 1 }] };
      await runWithNinesSupport(2, () => f.scores.saveGames(creator, event.id, f.roundId, [nines, dots], null,
        identifier(33002)));
      // The tester's older browser sends no nines level at all.
      const saved = await runWithNinesSupport(false, () => f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
        { kind: 'strokes', strokes: 4 }, null, identifier(33003)));
      expect(saved.change.after).toEqual({ kind: 'strokes', strokes: 4 });
    });

    it('refuses a link that uses partner-only specials', async () => {
      const f = await fixture();
      await expect(f.saveAsNewClient([f.game, linkedDots(f, [{ kind: 'assassin', units: 1 }])], null, 32006))
        .rejects.toMatchObject({ code: 'INVALID_DOTS_LINK' });
    });
  });
});
