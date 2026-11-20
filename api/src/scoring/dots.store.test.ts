import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { DotsGameDefinition, DotsHoleRecord } from '../../../src/domain/dots.js';
import type { WolfGameDefinition, WolfHoleRecord } from '../../../src/domain/wolf.js';
import type { HoleScore, RoundScores } from '../../../src/domain/scoring.js';
import { decodeRoundScores, isRoundScores, isScoreWriteResult } from '../../../src/contracts/scoring.js';
import { leanRoundScores, leanScoreWriteResult } from '../../../src/contracts/lean-round-scores.js';
import { privateWritePartBytes } from '../../../src/contracts/private-values.js';
import { stablefordPoints } from '../../../src/domain/stableford.js';
import { publicFixture } from '../public-access/test-support.js';
import { testerFixture } from '../test-access/test-support.js';
import { scoringFixture } from '../../test/scoring-fixtures.js';
import { catalogFixture, identifier, manifest, tee } from '../../test/catalog-fixtures.js';
import { creator, event } from '../../test/fixtures.js';
import { privateContent } from '../private-values.js';
import { isRecord } from '../../../src/contracts/events.js';
import { parseScoreWriteBody } from './handlers.js';
import { TableScoreStore } from './store.js';
import { coexistenceRoundScores } from '../../../src/contracts/dot-coexistence.js';

function dots(ids: readonly string[], id = 19000): Extract<DotsGameDefinition, { readonly mode: 'individual' }> {
  return { id: identifier(id), name: 'Fictional Dots', kind: 'dots', version: 1, groupNumber: 1,
    playerIds: ids.slice(0, 4), mode: 'individual', stakeMinor: null,
    specials: [{ kind: 'birdie', units: 2 }, { kind: 'eagle', units: 5 }, { kind: 'string', units: 1 },
      { kind: 'birdy-string', units: 1 }, { kind: 'sandy', units: 1 }, { kind: 'murphy', units: 1 }] };
}
function wolf(ids: readonly string[], version: 1 | 2 = 2): WolfGameDefinition {
  return { id: identifier(19001), name: 'Fictional Wolf', kind: 'wolf', version, basis: 'gross',
    groupNumber: 1, playerIds: ids.slice(0, 4).reverse(), allowPig: true, ...(version === 2 ? { stakeMinor: null } : {}) };
}
function stableford(id = 19002) {
  return { id: identifier(id), name: 'Fictional field game', basis: 'gross' as const, preset: 'standard' as const,
    handicapAllowancePercent: 95, points: stablefordPoints('standard') };
}
function etag(round: RoundScores, playerId: string): string | null {
  const card = round.cards.find((entry) => entry.playerId === playerId);
  if (!card) throw new Error('Missing fictional card');
  return card.etag;
}
function record(game: DotsGameDefinition, round: RoundScores, playerId: string, number = 1): DotsHoleRecord {
  return { number, gameId: game.id, gameEtag: round.games?.configuration.etag ?? 'missing',
    players: [{ playerId, counts: { sandy: 3 }, calls: [{ id: identifier(19003), kind: 'murphy', result: 'success' }] }],
    contests: [] };
}

describe('persisted independent Dots and earned Wolf authority', () => {
  it.each([0, 1, 2] as const)('persists Murphy stage %i in Wolf-linked Dots and resolves it from a later raw score', async (murphyPresses) => {
    const f = await publicFixture();
    const base = dots(f.input.playerIds);
    const match = wolf(f.input.playerIds);
    const game: DotsGameDefinition = { id: base.id, name: base.name, kind: 'dots', version: 1,
      groupNumber: 1, playerIds: base.playerIds, mode: 'linked', linkedGameId: match.id,
      specials: [{ kind: 'murphy', units: 2 }] };
    const configured = await f.scores.saveGames(f.actor, event.id, f.roundId, [match, game], null, identifier(24700));
      const declaration: DotsHoleRecord = { number: 1, gameId: game.id,
        gameEtag: configured.round.games?.configuration.etag ?? 'missing', contests: [],
        players: [{ playerId: f.playerId, counts: {}, calls: [{
          id: identifier(24701), kind: 'murphy', result: 'pending', murphyPresses, murphyTarget: 'par',
        }] }] };
      const saved = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
        { kind: 'strokes', strokes: 4, dots: [declaration] }, null, identifier(24702 + murphyPresses));
    expect(saved.change.after.dots).toEqual([declaration]);
    expect(saved.round.setupLocked).toBe(true);
    expect(isScoreWriteResult(saved)).toBe(true);
    const changed = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 5 }, etag(saved.round, f.playerId), identifier(24710 + murphyPresses));
    expect(changed.change.after.dots).toEqual([declaration]);
  });

  it.each([1, 2, 3] as const)('creates and conditionally scores public individual Dots for a full saved group of %i', async (count) => {
    const f = await scoringFixture(count);
    const actor = { kind: 'public-score' as const, eventId: event.id };
    const game = { ...dots(f.input.playerIds), stakeMinor: count === 1 ? null : 50, specials: [
      { kind: 'sandy' as const, units: 1 }, { kind: 'walk' as const, units: 1 },
      { kind: 'pickup' as const, units: 1 }, { kind: 'murphy' as const, units: 1 },
    ] };
    const requestId = identifier(23000);
    expect(await f.scores.receiveGames(actor, event.id, f.roundId, { games: [game] }, null, requestId))
      .toMatchObject({ kind: 'value', value: { games: [game] } });
    const configured = await f.scores.saveGames(actor, event.id, f.roundId, [game], null, requestId);
    const round = configured.round;
    expect(round.dotsIndividualPlayerCounts).toEqual([1, 2, 3, 4]);
    expect((await f.scores.get(creator, event.id, f.roundId)).dotsIndividualPlayerCounts).toEqual([1, 2, 3, 4]);
    expect(isRoundScores(round)).toBe(true);
    expect(decodeRoundScores(leanRoundScores(round, false, false, true))).toEqual(coexistenceRoundScores(round));
    const special: DotsHoleRecord = { number: 1, gameId: game.id, gameEtag: round.games?.configuration.etag ?? '',
      players: [{ playerId: f.playerId, counts: { sandy: 2, walk: 1, pickup: 1 }, calls: [] }], contests: [] };
    const score = { kind: 'strokes' as const, strokes: 4, dots: [special] };
    const saved = await f.scores.write(actor, event.id, f.roundId, f.playerId, 1, score, null, identifier(23002));
    expect(isScoreWriteResult(saved)).toBe(true);
    expect(leanScoreWriteResult(saved).round.round.dotsIndividualPlayerCounts).toEqual([1, 2, 3, 4]);
    expect(saved.round.setupLocked).toBe(true);
    expect(saved.change.after.dots).toEqual([special]);
    expect(saved.change.dotAwardAudit).toBeUndefined();
    const audit = (await f.scores.history(creator, event.id, f.roundId, f.playerId)).changes[0]?.dotAwardAudit?.[0];
    expect(audit?.after.length).toBeGreaterThan(0);
    expect(audit?.after.every((award) => award.recipientIds.length > 0)).toBe(true);
    expect((await f.scores.write(actor, event.id, f.roundId, f.playerId, 1, score, null, identifier(23002))).change)
      .toEqual(saved.change);
    await expect(f.scores.write(actor, event.id, f.roundId, f.playerId, 1, score, null, identifier(23003)))
      .rejects.toMatchObject({ code: 'SCORECARD_CHANGED' });
    await expect(f.scores.saveGames(actor, event.id, f.roundId, [{ ...game, name: 'Fictional changed name' }],
      round.games?.configuration.etag ?? null, identifier(23004))).rejects.toMatchObject({ code: 'MATCH_SETUP_LOCKED' });
    const failedCall: DotsHoleRecord = { ...special, number: 2,
      players: [{ playerId: f.playerId, counts: {},
        calls: [{ id: identifier(23001), kind: 'murphy', result: 'failure' }] }] };
    const missed = await f.scores.write(actor, event.id, f.roundId, f.playerId, 2,
      { kind: 'strokes', strokes: 5, dots: [failedCall] }, etag(saved.round, f.playerId), identifier(23005));
    expect(missed.change.after.dots).toEqual([failedCall]);
    for (const [index, playerId] of f.input.playerIds.slice(1).entries()) {
      const peer = await f.scores.write(actor, event.id, f.roundId, playerId, 1,
        { kind: 'strokes', strokes: 4 }, null, identifier(23010 + index));
      await f.scores.write(actor, event.id, f.roundId, playerId, 2,
        { kind: 'strokes', strokes: 4 }, etag(peer.round, playerId), identifier(23030 + index));
    }
    const reloaded = await f.scores.get(actor, event.id, f.roundId);
    expect(isRoundScores(reloaded)).toBe(true);
    expect(decodeRoundScores(leanRoundScores(reloaded, false, false, true))).toEqual(coexistenceRoundScores(reloaded));
    expect(reloaded.games?.results[0]?.players.map((player) => player.totalPoints)).toEqual([
      2, ...f.input.playerIds.slice(1).map(() => 3),
    ]);
    expect(reloaded.internalSettlements?.[0]).toMatchObject(count === 1
      ? { status: 'points-only', totalToSettleMinor: null, pairwise: [], players: [{ netMinor: null }] }
      : { status: 'projected', players: reloaded.internalSettlements?.[0]?.players.map((player, index) => ({
        ...player, netMinor: index === 0 ? (1 - count) * 50 : 50,
      })) });
    const raw = await f.scores.write(actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4 }, etag(reloaded, f.playerId), identifier(23020));
    expect(raw.change.after.dots).toEqual([special]);
  });

  it('rejects solo cash, partial groups, and nonindividual small-group setup', async () => {
    const solo = await scoringFixture(1);
    await expect(solo.scores.saveGames(creator, event.id, solo.roundId,
      [{ ...dots(solo.input.playerIds), stakeMinor: 1 }], null, identifier(23100)))
      .rejects.toMatchObject({ code: 'INVALID_GAME_SETUP' });
    for (const count of [2, 3] as const) {
      const f = await scoringFixture(count);
      await expect(f.scores.saveGames(creator, event.id, f.roundId,
        [dots(f.input.playerIds.slice(0, -1))], null, identifier(23101)))
        .rejects.toMatchObject({ code: 'INVALID_DOTS_GROUP' });
      await expect(f.scores.saveGames(creator, event.id, f.roundId,
        [{ ...dots(f.input.playerIds), mode: 'fixed' as const, partnerIds: f.input.playerIds }], null, identifier(23102)))
        .rejects.toMatchObject({ code: 'INVALID_GAME_SETUP' });
      await expect(f.scores.saveGames(creator, event.id, f.roundId,
        [wolf(f.input.playerIds)], null, identifier(23103)))
        .rejects.toMatchObject({ code: 'INVALID_GAME_SETUP' });
    }
  });

  it('accepts a confirmed birdie Pully with Hogan and preserves its automatic Birdie without accepting bogey Pully', async () => {
    const f = await publicFixture();
    const game = { ...dots(f.input.playerIds), specials: [
      { kind: 'pully' as const, units: 1 }, { kind: 'hogan' as const, units: 1 }, { kind: 'birdie' as const, units: 2 },
    ] };
    const round = (await f.scores.saveGames(f.actor, event.id, f.roundId, [game], null, identifier(21200))).round;
    const par = round.layout[0]?.par;
    if (!par) throw new Error('Missing fictional par');
    const special: DotsHoleRecord = { number: 1, gameId: game.id, gameEtag: round.games?.configuration.etag ?? '',
      players: [{ playerId: f.playerId, counts: { hogan: 1, pully: 1 }, calls: [] }], contests: [] };
    const saved = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: par - 1, dots: [special] }, null, identifier(21201));
    expect(saved.round.games?.results[0]?.dots?.awards.map((award) => [award.kind, award.dots]))
      .toEqual([['hogan', 1], ['pully', 1], ['birdie', 2]]);
    expect(saved.round.games?.results[0]?.dots?.issues).toEqual([]);
    expect((await f.scores.get(f.actor, event.id, f.roundId)).games?.results).toEqual(saved.round.games?.results);
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 2,
      { kind: 'strokes', strokes: par + 1, dots: [{ ...special, number: 2 }] },
      etag(saved.round, f.playerId), identifier(21202))).rejects.toMatchObject({ code: 'DOTS_SETUP_CHANGED' });
  });

  it('does not let narrow public setup reorder protected event-wide games while adding an internal game', async () => {
    const f = await publicFixture();
    const protectedGames = [stableford(21100), stableford(21101)];
    const before = await f.scores.saveGames(creator, event.id, f.roundId, protectedGames, null, identifier(21102));
    const game = dots(f.input.playerIds);
    const expected = before.round.games?.configuration.etag ?? null;
    const reordered = [...protectedGames].reverse();
    await expect(f.scores.saveGames(f.actor, event.id, f.roundId, [...reordered, game],
      expected, identifier(21103))).rejects.toMatchObject({ code: 'SCORES_OWNER_REQUIRED' });
    const saved = await f.scores.saveGames(f.actor, event.id, f.roundId, [...protectedGames, game], expected, identifier(21104));
    expect(saved.round.games?.configuration.games.slice(0, 2)).toEqual(protectedGames);
    expect(saved.change.recordedBy).toEqual(f.actor);
  });
  it('grants ordinary anonymous internal setup only, preserving protected peers and recording a distinct actor', async () => {
    const f = await publicFixture();
    const protectedGame = stableford();
    const base = await f.scores.saveGames(creator, event.id, f.roundId, [protectedGame], null, identifier(19100));
    const members = [...f.rows.entries()].filter(([key]) => key.startsWith(`${event.id}|member:`));
    const game = dots(f.input.playerIds);
    const saved = await f.scores.saveGames(f.actor, event.id, f.roundId, [protectedGame, game],
      base.round.games?.configuration.etag ?? null, identifier(19101));
    expect(saved.change.recordedBy).toEqual(f.actor);
    expect(saved.round.permissions).toMatchObject({ role: 'public', canManageGames: false, canManageInternalGames: true });
    expect(saved.round).toMatchObject({ internalGamesSupported: true, wolfRulesVersions: [1, 2] });
    expect(isRoundScores(saved.round)).toBe(true);
    expect([...f.rows.entries()].filter(([key]) => key.startsWith(`${event.id}|member:`))).toEqual(members);
    const expected = saved.round.games?.configuration.etag ?? null;
    for (const games of [[{ ...protectedGame, name: 'Forbidden rename' }, game], [game],
      [protectedGame, { ...game, id: protectedGame.id }], [protectedGame, game, stableford(19105)]]) {
      await expect(f.scores.saveGames(f.actor, event.id, f.roundId, games, expected, identifier(19102)))
        .rejects.toHaveProperty('status');
    }
    await expect(f.workspace.save(f.actor, event.id, f.input, saved.round.games?.configuration.etag ?? 'missing'))
      .rejects.toMatchObject({ status: 403 });
    await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1, { kind: 'strokes', strokes: 4 }, null, identifier(19103));
    expect((await f.scores.saveGames(f.actor, event.id, f.roundId, [protectedGame, game],
      base.round.games?.configuration.etag ?? null, identifier(19101))).change).toEqual(saved.change);
    await expect(f.scores.saveGames(f.actor, event.id, f.roundId,
      [protectedGame, { ...game, stakeMinor: 100 }], expected, identifier(19104)))
      .rejects.toMatchObject({ code: 'MATCH_SETUP_LOCKED' });
  });

  it('denies protected ID conversion, old Wolf migration, foreign groups and incompatible internal stacking', async () => {
    const f = await publicFixture();
    const legacy = wolf(f.input.playerIds, 1);
    const setup = await f.scores.saveGames(creator, event.id, f.roundId, [legacy], null, identifier(19200));
    const expected = setup.round.games?.configuration.etag ?? null;
    await expect(f.scores.saveGames(f.actor, event.id, f.roundId, [{ ...legacy, name: 'Forbidden legacy edit' }],
      expected, identifier(19201))).rejects.toMatchObject({ code: 'SCORES_OWNER_REQUIRED' });
    await expect(f.scores.saveGames(creator, event.id, f.roundId, [wolf(f.input.playerIds)],
      expected, identifier(19202))).rejects.toMatchObject({ code: 'WOLF_REQUIRES_NEW_GAME' });
    const fresh = await publicFixture();
    const game = dots(fresh.input.playerIds);
    await expect(fresh.scores.saveGames(fresh.actor, event.id, fresh.roundId,
      [{ ...game, playerIds: fresh.input.playerIds.slice(1, 5) }], null, identifier(19203)))
      .rejects.toMatchObject({ code: 'INVALID_DOTS_GROUP' });
    const churchy = { id: identifier(19204), name: 'Churchy Game', kind: 'churchy' as const, version: 1 as const,
      basis: 'net' as const, groupNumber: 1, playerIds: game.playerIds, amountPerDotMinor: 100, currency: 'USD' as const };
    await expect(fresh.scores.saveGames(fresh.actor, event.id, fresh.roundId, [churchy, game], null, identifier(19205)))
      .rejects.toMatchObject({ code: 'INVALID_GAME_SETUP' });
    const independent = await fresh.scores.saveGames(fresh.actor, event.id, fresh.roundId,
      [wolf(game.playerIds), game], null, identifier(19206));
    expect(independent.round.internalSettlements).toHaveLength(2);
    expect(independent.round.games?.configuration.games.find((entry) => entry.id === game.id)).toMatchObject({ mode: 'individual' });
    const linkedGame: DotsGameDefinition = { id: game.id, name: game.name, kind: 'dots', version: 1,
      groupNumber: game.groupNumber, playerIds: game.playerIds, specials: game.specials,
      mode: 'linked', linkedGameId: wolf(game.playerIds).id };
    const combined = await fresh.scores.saveGames(fresh.actor, event.id, fresh.roundId,
      [wolf(game.playerIds), linkedGame], independent.round.games?.configuration.etag ?? null, identifier(19207));
    expect(combined.round.games?.configuration.games).toHaveLength(2);
    expect(combined.round.internalSettlements).toHaveLength(1);
  });

  it('saves whole-game snapshots on the canonical anchor, preserves peers/raw clients, clears explicitly and audits derived corrections', async () => {
    const f = await publicFixture();
    const game = dots(f.input.playerIds), peer = dots(f.input.playerIds, 19300);
    let round = (await f.scores.saveGames(f.actor, event.id, f.roundId, [game, peer], null, identifier(19301))).round;
    const special = record(game, round, f.playerId), other = { ...record(peer, round, f.playerId),
      players: [{ playerId: f.playerId, counts: { sandy: 1 }, calls: [] }] };
    const score: HoleScore = { kind: 'strokes', strokes: 2, dots: [special, other] };
    f.submit.mockImplementationOnce((actions) => { f.apply(actions); return Promise.reject(new Error('Fictional lost Dots acknowledgement')); });
    const saved = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1, score, null, identifier(19302));
    expect(saved.change.after.dots).toEqual([special, other]);
    expect(saved.change.dotAwardAudit).toBeUndefined();
    expect(isScoreWriteResult(saved)).toBe(true);
    const history = await f.scores.history(creator, event.id, f.roundId, f.playerId);
    const audit = history.changes[0]?.dotAwardAudit?.find((entry) => entry.gameId === game.id);
    expect(audit).toMatchObject({
      configuration: game, gameEtag: round.games?.configuration.etag, inputRevision: null,
      before: [],
    });
    expect(audit?.after).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'eagle', dots: 5 }),
      expect.objectContaining({ kind: 'sandy', count: 3, dots: 3 })]));
    round = saved.round;
    const raw = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1, { kind: 'strokes', strokes: 3 },
      etag(round, f.playerId), identifier(19303));
    expect(raw.change.after.dots).toEqual([special, other]);
    const corrected = (await f.scores.history(creator, event.id, f.roundId, f.playerId)).changes
      .find((change) => change.id === identifier(19303));
    expect(corrected?.dotAwardAudit?.[0]?.before).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'eagle' })]));
    expect(corrected?.dotAwardAudit?.[0]?.after).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'birdie' })]));
    const clear = { ...special, players: [], contests: [] };
    const cleared = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 3, dots: [clear] }, etag(raw.round, f.playerId), identifier(19304));
    expect(cleared.change.after.dots).toEqual([clear, other]);
    await expect(f.scores.write(f.actor, event.id, f.roundId, game.playerIds[1] ?? '', 1,
      { kind: 'strokes', strokes: 3, dots: [special] }, null, identifier(19305)))
      .rejects.toMatchObject({ code: 'DOTS_SETUP_CHANGED' });
    expect((await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1, score, null, identifier(19302))).change)
      .toEqual(saved.change);
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { ...score, dots: [clear] }, null, identifier(19302))).rejects.toMatchObject({ code: 'SCORE_REQUEST_CONFLICT' });
  });

  it('rejects foreign, wrong-hole, disabled and unqualified edits and requires explicit repair for newly invalid raw corrections', async () => {
    const f = await scoringFixture();
    const game = dots(f.input.playerIds);
    const round = (await f.scores.saveGames(creator, event.id, f.roundId, [game], null, identifier(19400))).round;
    const base = record(game, round, f.playerId);
    const invalid = [{ ...base, number: 2 }, { ...base, gameEtag: 'wrong-revision' },
      { ...base, players: [{ playerId: identifier(19999), counts: {}, calls: [] }] },
      { ...base, players: [{ playerId: f.playerId, counts: { walk: 1 }, calls: [] }] }];
    for (const special of invalid) await expect(f.scores.write(creator, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, dots: [special] }, null, identifier(19401)))
      .rejects.toMatchObject({ code: 'DOTS_SETUP_CHANGED' });
    await expect(f.scores.write(creator, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 6, dots: [base] }, null, identifier(19402)))
      .rejects.toMatchObject({ code: 'DOTS_SETUP_CHANGED' });
    const saved = await f.scores.write(creator, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, dots: [base] }, null, identifier(19403));
    const rows = new Map(f.rows);
    await expect(f.scores.write(creator, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 6 }, etag(saved.round, f.playerId), identifier(19404)))
      .rejects.toMatchObject({ code: 'DOTS_SETUP_CHANGED' });
    expect(f.rows).toEqual(rows);
    const repair = { ...base, players: [] };
    expect((await f.scores.write(creator, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 6, dots: [repair] }, etag(saved.round, f.playerId), identifier(19404))).change.after.dots).toEqual([repair]);
  });

  it('keeps new declarations and derived audit out of legacy tester reads and acknowledgements', async () => {
    const f = await testerFixture();
    const game = dots(f.input.playerIds);
    const setup = await f.scores.saveGames(creator, event.id, f.roundId, [game], null, identifier(19500));
    const special = record(game, setup.round, f.playerId);
    const saved = await f.scores.write(creator, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 2, dots: [special] }, null, identifier(19501));
    const tester = await f.scores.get(f.actor, event.id, f.roundId);
    expect(tester.games?.configuration.games).toEqual([]);
    expect(tester.cards.find((card) => card.playerId === f.playerId)?.holes[0]?.score.dots).toBeUndefined();
    expect(tester.supportedGameKinds).not.toContain('dots');
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 3, dots: [special] }, etag(saved.round, f.playerId), identifier(19502)))
      .rejects.toMatchObject({ code: 'MATCH_DECLARATIONS_NOT_ALLOWED' });
    const raw = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 3 }, etag(saved.round, f.playerId), identifier(19503));
    expect(raw.change.dotAwardAudit).toBeUndefined();
    expect(raw.change.after.dots).toBeUndefined();
    expect((await f.scores.history(creator, event.id, f.roundId, f.playerId)).changes
      .find((change) => change.id === identifier(19503))?.after.dots).toEqual([special]);
  });

  it('stages large Dots commands without score publication, then saves atomically and rejects stale revisions', async () => {
    const f = await publicFixture();
    const game = dots(f.input.playerIds);
    const round = (await f.scores.saveGames(f.actor, event.id, f.roundId, [game], null, identifier(19600))).round;
    const special = { ...record(game, round, f.playerId), players: [{ playerId: f.playerId, counts: {},
      calls: Array.from({ length: 180 }, (_, index) => ({ id: identifier(19610 + index), kind: 'murphy' as const, result: 'success' as const })) }] };
    const score: HoleScore = { kind: 'strokes', strokes: 4, dots: [special] };
    const bytes = Buffer.from(JSON.stringify({ score }));
    expect(bytes.length).toBeGreaterThan(12 * 1024);
    const upload = { id: identifier(19800), bytes: bytes.length, parts: Math.ceil(bytes.length / privateWritePartBytes),
      sha256: createHash('sha256').update(bytes).digest('hex') };
    let commit: unknown;
    for (let index = 0; index < upload.parts; index++) {
      commit = await f.scores.receiveGameScore(f.actor, event.id, f.roundId, f.playerId, 1, { privateUpload: { ...upload, index,
        content: bytes.subarray(index * privateWritePartBytes, (index + 1) * privateWritePartBytes).toString('base64') } },
      null, identifier(19801));
      expect(commit).toMatchObject({ kind: 'part' });
      expect((await f.scores.get(f.actor, event.id, f.roundId)).setupLocked).toBe(false);
    }
    const assembled = await f.scores.receiveGameScore(f.actor, event.id, f.roundId, f.playerId, 1,
      { privateCommit: upload }, null, identifier(19801));
    if (assembled.kind !== 'value') throw new Error('Incomplete fictional upload');
    const parsed = parseScoreWriteBody(assembled.value);
    expect((await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      parsed.score, null, identifier(19801))).change.after.dots).toEqual([special]);
    expect(JSON.parse(String(f.row(`score-change:${identifier(19801)}`).content))).toMatchObject({ privateValue: 1 });
    expect((await f.scores.history(creator, event.id, f.roundId, f.playerId)).changes[0]?.dotAwardAudit?.[0]?.after).toHaveLength(180);
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 5 }, null, identifier(19802))).rejects.toMatchObject({ code: 'SCORECARD_CHANGED' });
  });

  it('binds ordinary public configuration staging without granting authority over the eventual protected payload', async () => {
    const f = await publicFixture();
    const protectedGame = stableford();
    const setup = await f.scores.saveGames(creator, event.id, f.roundId, [protectedGame], null, identifier(20800));
    const expected = setup.round.games?.configuration.etag ?? null;
    const payload = { games: [{ ...protectedGame, name: 'Forbidden staged edit' }, dots(f.input.playerIds)] };
    const bytes = Buffer.from(JSON.stringify(payload)), requestId = identifier(20801);
    const upload = { id: identifier(20802), bytes: bytes.length, parts: 1,
      sha256: createHash('sha256').update(bytes).digest('hex') };
    const part = { privateUpload: { ...upload, index: 0, content: bytes.toString('base64') } };
    expect(await f.scores.receiveGames(f.actor, event.id, f.roundId, part, expected, requestId)).toMatchObject({ kind: 'part' });
    expect((await f.scores.get(f.actor, event.id, f.roundId)).games?.configuration.games).toEqual([protectedGame]);
    await expect(f.scores.receiveGames(creator, event.id, f.roundId, { privateCommit: upload }, expected, requestId))
      .rejects.toMatchObject({ code: 'PRIVATE_UPLOAD_CONFLICT' });
    const assembled = await f.scores.receiveGames(f.actor, event.id, f.roundId, { privateCommit: upload }, expected, requestId);
    expect(assembled).toMatchObject({ kind: 'value', value: payload });
    await expect(f.scores.saveGames(f.actor, event.id, f.roundId, payload.games, expected, requestId))
      .rejects.toMatchObject({ code: 'SCORES_OWNER_REQUIRED' });
    expect((await f.scores.get(f.actor, event.id, f.roundId)).games?.configuration.games).toEqual([protectedGame]);
    expect(f.rows.has(`${event.id}|game-change:${f.roundId}:${requestId}`)).toBe(false);
  });

  it('retains the Dots canonical anchor, start and capture history through compatible owner corrections', async () => {
    const f = await scoringFixture();
    const game = dots(f.input.playerIds);
    await f.scores.saveGames(creator, event.id, f.roundId, [game], null, identifier(19900));
    const saved = await f.write(null, 19901);
    const model = await f.workspace.correctionModel(creator, event.id, f.roundId);
    const body = { expected: { eventEtag: model.eventEtag, roundEtag: model.roundEtag, gamesEtag: model.gamesEtag ?? null,
      inputRevision: model.inputRevision ?? null }, reason: 'Fictional correction', correction: {
      teeProfileId: model.teeProfileId, groups: model.groups,
      players: model.players.map((player) => ({ playerId: player.playerId, handicapIndexValue: '8.4' })) } };
    for (const groups of [model.groups.map((group) => ({ ...group, playerIds: [...group.playerIds].reverse() })),
      model.groups.map((group) => ({ ...group, startingHole: 2 }))]) {
      await expect(f.workspace.correctRound(creator, event.id, f.roundId, identifier(19902),
        { ...body, correction: { ...body.correction, groups } })).rejects.toMatchObject({ code: 'MATCH_SETUP_CHANGED' });
    }
    const corrected = await f.workspace.correctRound(creator, event.id, f.roundId, identifier(19903), body);
    expect(corrected.applied).toBe(true);
    expect((await f.scores.get(creator, event.id, f.roundId)).cards).toEqual(saved.round.cards);
    const capture = f.rows.get(`${event.id}|index-capture:${f.roundId}`);
    expect(capture).toBeDefined();
    const receipt = f.rows.get(`${event.id}|round-correction:${f.roundId}:${identifier(19903)}`);
    if (!receipt) throw new Error('Missing fictional receipt');
    const content: unknown = JSON.parse(await privateContent(f.table, event.id, String(receipt.rowKey), receipt.content));
    expect(isRecord(content)).toBe(true);
  });

  it('audits a changed automatic streak on its later award hole, not only the edited hole', async () => {
    const f = await scoringFixture();
    const game = dots(f.input.playerIds);
    let round = (await f.scores.saveGames(creator, event.id, f.roundId, [game], null, identifier(20200))).round;
    for (const number of [1, 2, 3]) {
      round = (await f.scores.write(creator, event.id, f.roundId, f.playerId, number,
        { kind: 'strokes', strokes: 4 }, etag(round, f.playerId), identifier(20200 + number))).round;
    }
    const corrected = await f.scores.write(creator, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 5 }, etag(round, f.playerId), identifier(20204));
    const audit = corrected.change.dotAwardAudit?.[0];
    expect(audit?.before).toEqual(expect.arrayContaining([expect.objectContaining({
      kind: 'string', number: 3, sourceHoles: [1, 2, 3],
    })]));
    expect(audit?.after.some((award) => award.kind === 'string')).toBe(false);
    expect((await f.scores.history(creator, event.id, f.roundId, f.playerId)).changes
      .find((change) => change.id === identifier(20203))?.dotAwardAudit?.[0]?.after)
      .toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'string', number: 3 })]));
  });

  it('retains the original and corrected round-end King award with its carried source holes', async () => {
    const f = catalogFixture();
    f.seedEvent();
    const course = { ...tee, totalPar: 70, holes: tee.holes.map((hole) => ({ ...hole, par: hole.number <= 2 ? 3 : 4 })) };
    const version = await f.publish(identifier(20500), manifest, [course]);
    const players = await Promise.all([20501, 20502, 20503, 20504].map((id) =>
      f.players.create(creator, identifier(id), `Fictional King Golfer ${String(id)}`)));
    const ids = players.map((player) => player.id), playerId = ids[0] ?? '';
    const roundId = identifier(20505), scores = new TableScoreStore(f.table, f.workspace);
    const empty = await f.workspace.get(creator, event.id);
    await f.workspace.save(creator, event.id, { name: 'Fictional King Event', location: 'Fictional course',
      playerIds: ids, rounds: [{ id: roundId, name: 'Fictional round', courseId: version.courseId,
        courseVersionId: version.id, teeProfileId: tee.id, groups: [{ number: 1, playerIds: ids }] }] }, empty.etag);
    const game = { ...dots(ids), specials: [{ kind: 'kp' as const, units: 1 }, { kind: 'king-of-the-hill' as const, units: 1 }] };
    let round = (await scores.saveGames(creator, event.id, roundId, [game], null, identifier(20506))).round;
    let operation = 20510;
    for (let number = 1; number <= 18; number++) for (const id of ids) {
      const declaration: DotsHoleRecord = { number, gameId: game.id, gameEtag: round.games?.configuration.etag ?? '',
        players: [], contests: number === 1 ? [{ kind: 'kp', status: 'no-qualifier' }]
          : [{ kind: 'kp', status: 'awarded', winnerId: playerId }] };
      round = (await scores.write(creator, event.id, roundId, id, number, { kind: 'strokes', strokes: 4,
        ...(id === playerId && number <= 2 ? { dots: [declaration] } : {}) },
      etag(round, id), identifier(operation++))).round;
    }
    const lastPlayer = ids.at(-1) ?? '';
    const original = (await scores.history(creator, event.id, roundId, lastPlayer)).changes
      .find((change) => change.id === identifier(operation - 1));
    expect(original?.dotAwardAudit?.[0]?.after).toEqual(expect.arrayContaining([expect.objectContaining({
      kind: 'king-of-the-hill', number: null, recipientIds: [playerId], sourceHoles: [1, 2], dots: 1,
    })]));
    const replacement = ids[1] ?? '';
    const corrected = await scores.write(creator, event.id, roundId, playerId, 2,
      { kind: 'strokes', strokes: 4, dots: [{ number: 2, gameId: game.id,
        gameEtag: round.games?.configuration.etag ?? '', players: [],
        contests: [{ kind: 'kp', status: 'awarded', winnerId: replacement }] }] },
      etag(round, playerId), identifier(operation++));
    expect(corrected.change.dotAwardAudit?.[0]?.before.find((award) => award.kind === 'king-of-the-hill')?.recipientIds).toEqual([playerId]);
    expect(corrected.change.dotAwardAudit?.[0]?.after.find((award) => award.kind === 'king-of-the-hill')?.recipientIds).toEqual([replacement]);
    expect((await scores.history(creator, event.id, roundId, lastPlayer)).changes
      .find((change) => change.id === original?.id)?.dotAwardAudit).toEqual(original?.dotAwardAudit);
  });

  it('keeps independently configured foursome awards and settlements separate', async () => {
    const f = await publicFixture();
    const first = { ...dots(f.input.playerIds), stakeMinor: 100 };
    const second = { ...dots(f.input.playerIds.slice(4), 20600), groupNumber: 2, stakeMinor: 200 };
    const setup = await f.scores.saveGames(f.actor, event.id, f.roundId, [first, second], null, identifier(20601));
    const saved = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 2 }, null, identifier(20602));
    expect(saved.round.games?.results.find((result) => result.gameId === first.id)?.dots?.awards).toHaveLength(1);
    expect(saved.round.games?.results.find((result) => result.gameId === second.id)?.dots?.awards).toEqual([]);
    expect(saved.round.internalSettlements?.map((settlement) => settlement.gameIds)).toEqual([[first.id], [second.id]]);
    await expect(f.scores.saveGames(f.actor, event.id, f.roundId, [first, { ...second, stakeMinor: 300 }],
      setup.round.games?.configuration.etag ?? null, identifier(20603))).rejects.toMatchObject({ code: 'MATCH_SETUP_LOCKED' });
  });

  it('never publishes a public game edit that races the first score, and denies archived retries', async () => {
    const f = await publicFixture();
    const game = dots(f.input.playerIds);
    f.submit.mockImplementationOnce(async (actions) => {
      await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
        { kind: 'strokes', strokes: 4 }, null, identifier(20300));
      f.apply(actions);
      return { status: 202, subResponses: [], getResponseForEntity: () => undefined };
    });
    await expect(f.scores.saveGames(f.actor, event.id, f.roundId, [game], null, identifier(20301)))
      .rejects.toMatchObject({ code: 'GAMES_CHANGED' });
    expect(f.rows.has(`${event.id}|round-games:${f.roundId}`)).toBe(false);
    expect(f.rows.has(`${event.id}|game-change:${f.roundId}:${identifier(20301)}`)).toBe(false);
    const fresh = await publicFixture();
    await fresh.scores.saveGames(fresh.actor, event.id, fresh.roundId, [game], null, identifier(20302));
    fresh.seed({ ...fresh.row('event'), status: 'archived' });
    await expect(fresh.scores.saveGames(fresh.actor, event.id, fresh.roundId, [game], null, identifier(20302)))
      .rejects.toMatchObject({ code: 'PUBLIC_EVENT_NOT_AVAILABLE' });
    await expect(fresh.scores.receiveGames(fresh.actor, event.id, fresh.roundId, { games: [game] }, null, identifier(20303)))
      .rejects.toMatchObject({ code: 'PUBLIC_EVENT_NOT_AVAILABLE' });
  });

  it('captures changed net-Wolf awards in the same correction receipt without rewriting cards or original audits', async () => {
    const f = await scoringFixture();
    for (const [index, playerId] of f.input.playerIds.entries()) {
      const profile = await f.players.get(creator, playerId);
      await f.players.observe(creator, playerId, identifier(20400 + index),
        { value: '0.0', effectiveDate: '2026-01-15', source: 'Fictional test observation' }, profile.etag);
    }
    const game = { ...wolf(f.input.playerIds), basis: 'net' as const };
    let round = (await f.scores.saveGames(creator, event.id, f.roundId, [game], null, identifier(20405))).round;
    for (const [index, playerId] of f.input.playerIds.entries()) {
      round = (await f.scores.write(creator, event.id, f.roundId, playerId, 1,
        { kind: 'strokes', strokes: 4, ...(playerId === f.playerId ? { wolf: [{
          number: 1, choice: { gameId: game.id, gameEtag: round.games?.configuration.etag ?? '', mode: 'pig' as const },
        }] } : {}) }, etag(round, playerId), identifier(20406 + index))).round;
    }
    const beforeCards = round.cards;
    const capture = f.rows.get(`${event.id}|index-capture:${f.roundId}`);
    const originalAudits = [...f.rows.entries()].filter(([key]) => key.startsWith(`${event.id}|score-change:`));
    const model = await f.workspace.correctionModel(creator, event.id, f.roundId);
    const requestId = identifier(20410);
    await f.workspace.correctRound(creator, event.id, f.roundId, requestId, {
      expected: { eventEtag: model.eventEtag, roundEtag: model.roundEtag, gamesEtag: model.gamesEtag ?? null,
        inputRevision: model.inputRevision ?? null }, reason: 'Fictional captured index correction',
      correction: { teeProfileId: model.teeProfileId, groups: model.groups,
        players: model.players.map((player) => ({ playerId: player.playerId,
          handicapIndexValue: player.playerId === game.playerIds[0] ? '18.0' : '0.0' })) },
    });
    expect((await f.scores.get(creator, event.id, f.roundId)).cards).toEqual(beforeCards);
    expect(f.rows.get(`${event.id}|index-capture:${f.roundId}`)).toEqual(capture);
    for (const [key, row] of originalAudits) expect(f.rows.get(key)).toEqual(row);
    const receiptKey = `round-correction:${f.roundId}:${requestId}`;
    const stored = f.rows.get(`${event.id}|${receiptKey}`);
    if (!stored) throw new Error('Missing fictional correction receipt');
    const saved: unknown = JSON.parse(await privateContent(f.table, event.id, receiptKey, stored.content));
    expect(saved).toMatchObject({ receipt: { dotAwardAudit: [{
      gameId: game.id, kind: 'wolf', version: 2, gameEtag: round.games?.configuration.etag,
      inputRevision: requestId, before: [], after: [{ kind: 'wolf-low', recipientIds: [game.playerIds[0]], dots: 3 }],
    }] } });
  });

  it.each([false, true])('freezes new Wolf comeback from its acknowledged prewrite proof, linked Dots: %s', async (linked) => {
    const f = await publicFixture();
    const game = wolf(f.input.playerIds);
    const specials: DotsGameDefinition = { id: identifier(20700), name: 'Fictional linked specials', kind: 'dots',
      version: 1, groupNumber: 1, playerIds: game.playerIds, mode: 'linked', linkedGameId: game.id,
      specials: [{ kind: 'walk', units: 1 }] };
    let round = (await f.scores.saveGames(f.actor, event.id, f.roundId, linked ? [game, specials] : [game],
      null, identifier(20000))).round;
    let operation = 20001;
    for (let number = 1; number <= 16; number++) for (const playerId of game.playerIds) {
      const declaration: WolfHoleRecord = { number, choice: { gameId: game.id,
        gameEtag: round.games?.configuration.etag ?? '', mode: 'pig' } };
      const dotsRecord: DotsHoleRecord = { number, gameId: specials.id, gameEtag: round.games?.configuration.etag ?? '',
        players: [{ playerId: game.playerIds[1] ?? '', counts: { walk: 1 }, calls: [] }], contests: [] };
      round = (await f.scores.write(f.actor, event.id, f.roundId, playerId, number,
        { kind: 'strokes', strokes: 4, ...(playerId === f.playerId ? { wolf: [declaration],
          ...(linked && number === 1 ? { dots: [dotsRecord] } : {}) } : {}) },
        etag(round, playerId), identifier(operation++))).round;
    }
    const candidate = round.games?.results[0]?.wolf?.comeback?.receipt;
    if (!candidate) throw new Error('Missing fictional comeback candidate');
    expect(candidate.wolfId).toBe(linked ? game.playerIds[1] : game.playerIds[0]);
    const declaration: WolfHoleRecord = { number: 17, choice: { gameId: game.id,
      gameEtag: round.games?.configuration.etag ?? '', mode: 'pig' }, comeback: candidate };
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 17,
      { kind: 'strokes', strokes: 4, wolf: [{ ...declaration, comeback: { ...candidate, proof: 'forged' } }] },
      etag(round, f.playerId), identifier(operation++))).rejects.toMatchObject({ code: 'WOLF_COMEBACK_CHANGED' });
    const withoutReceipt: WolfHoleRecord = { number: declaration.number, choice: declaration.choice };
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 17,
      { kind: 'strokes', strokes: 4, wolf: [withoutReceipt] }, etag(round, f.playerId), identifier(operation++)))
      .rejects.toMatchObject({ code: 'WOLF_COMEBACK_CHANGED' });
    round = (await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 17,
      { kind: 'strokes', strokes: 4, wolf: [declaration] }, etag(round, f.playerId), identifier(operation++))).round;
    expect(round.games?.results[0]?.wolf?.comeback).toMatchObject({ status: 'saved', receipt: candidate, changed: false });
    round = (await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 3 }, etag(round, f.playerId), identifier(operation++))).round;
    expect(round.games?.results[0]?.wolf?.comeback).toMatchObject({ status: 'saved', receipt: candidate, changed: true });
    const raw = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 17,
      { kind: 'strokes', strokes: 5 }, etag(round, f.playerId), identifier(operation++));
    expect(raw.change.after.wolf?.[0]?.comeback).toEqual(candidate);
    expect(isScoreWriteResult(raw)).toBe(true);
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 17,
      { kind: 'strokes', strokes: 5, wolf: [{ ...declaration, comeback: { ...candidate, proof: 'replacement' } }] },
      etag(raw.round, f.playerId), identifier(operation++))).rejects.toMatchObject({ code: 'WOLF_COMEBACK_CONFLICT' });
  });
});
