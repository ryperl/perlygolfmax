import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ChurchyGameDefinitionV3, ChurchySpecialsV3 } from '../../../src/domain/churchy.js';
import { defaultChurchySpecialSelections } from '../../../src/domain/churchy.js';
import { isRoundScores, isScoreWriteResult } from '../../../src/contracts/scoring.js';
import { leanRoundScores } from '../../../src/contracts/lean-round-scores.js';
import { decodeRoundScores } from '../../../src/contracts/scoring.js';
import type { RoundScores } from '../../../src/domain/scoring.js';
import { publicFixture } from '../public-access/test-support.js';
import { testerFixture } from '../test-access/test-support.js';
import { creator, event } from '../../test/fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { TableScoreStore } from './store.js';
import { parseScoreWriteBody } from './handlers.js';

const etagFor = (round: RoundScores, playerId: string) => round.cards.find((card) => card.playerId === playerId)?.etag ?? null;

async function fixture(startingHole = 1) {
  const f = await publicFixture();
  const workspace = await f.workspace.get(creator, event.id);
  await f.workspace.save(creator, event.id, { ...f.input, rounds: f.input.rounds.map((round) => ({
    ...round, groups: round.groups.map((group) => ({ ...group, startingHole })),
  })) }, workspace.etag);
  const game: ChurchyGameDefinitionV3 = {
    id: identifier(24000), name: 'Churcie', kind: 'churchy', version: 3, basis: 'net',
    orderMode: 'approach', groupNumber: 1, playerIds: f.input.playerIds.slice(0, 4),
    amountPerDotMinor: 50, currency: 'USD', specials: defaultChurchySpecialSelections,
  };
  const round = (await f.scores.saveGames(f.actor, event.id, f.roundId, [game], null, identifier(24001))).round;
  const declaration = (number = startingHole, order?: readonly string[]): ChurchySpecialsV3 => ({
    version: 3, gameId: game.id, gameEtag: round.games?.configuration.etag ?? 'missing',
    number, players: [], contests: [], ...(order ? { rotation: { playerIds: order } } : {}),
  });
  return { ...f, game, round, declaration };
}

describe('Churcie v3 authoritative public conditional transactions', () => {
  it.each([1, 10, 7])('acknowledges order with the first score from starting hole %i and whole-round capture', async (start) => {
    const f = await fixture(start);
    const score = { kind: 'strokes' as const, strokes: 4, churchy: f.declaration(start, f.game.playerIds) };
    const saved = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, start, score, null, identifier(24002));
    expect(saved.round.churchyRulesVersions).toEqual([1, 2, 3]);
    expect(saved.round.dotsSpecialKinds).toContain('other');
    expect(saved.round.setupLocked).toBe(true);
    expect(saved.change.after).toEqual(score);
    expect(saved.change.recordedBy).toEqual(f.actor);
    expect(saved.round.games?.results[0]?.churchy?.holes[0]?.number).toBe(start);
    expect(saved.round.games?.results[0]?.churchy?.holes[0]?.pairs)
      .toEqual([[f.game.playerIds[0], f.game.playerIds[3]], [f.game.playerIds[1], f.game.playerIds[2]]]);
    expect(saved.round.games?.results[0]?.churchy?.order).toEqual({ playerIds: f.game.playerIds });
    expect(isScoreWriteResult(saved)).toBe(true);
    expect(isRoundScores(saved.round)).toBe(true);
    expect(decodeRoundScores(leanRoundScores(saved.round))).toEqual(saved.round);
    expect(f.row(`index-capture:${f.roundId}`)).toBeDefined();
    expect((await f.workspace.get(creator, event.id)).rounds[0]?.players).toHaveLength(8);
    expect((await f.scores.write(f.actor, event.id, f.roundId, f.playerId, start, score, null, identifier(24002))).change)
      .toEqual(saved.change);
  });

  it('lets another group capture first without blocking approach choice, then marks same-group recovery late', async () => {
    const f = await fixture(10);
    const other = await f.scores.write(f.actor, event.id, f.roundId, f.peerId, 10,
      { kind: 'strokes', strokes: 4 }, null, identifier(24010));
    expect(other.round.games?.results[0]?.churchy?.order).toBeUndefined();
    const claimedLate = { ...f.declaration(10, f.game.playerIds),
      rotation: { playerIds: f.game.playerIds, recordedLate: true as const } };
    const chosen = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 10,
      { kind: 'unplayed', churchy: claimedLate }, null, identifier(24011));
    expect(chosen.change.after.churchy).toEqual(f.declaration(10, f.game.playerIds));
    expect(isScoreWriteResult(chosen)).toBe(true);
    const late = await fixture(10);
    await late.scores.write(late.actor, event.id, late.roundId, late.game.playerIds[1] ?? '', 12,
      { kind: 'strokes', strokes: 5 }, null, identifier(24012));
    const recovered = await late.scores.write(late.actor, event.id, late.roundId, late.playerId, 10,
      { kind: 'unplayed', churchy: late.declaration(10, late.game.playerIds) }, null, identifier(24013));
    expect(recovered.change.after.churchy).toMatchObject({ rotation: { recordedLate: true } });
    expect(isScoreWriteResult(recovered)).toBe(true);
    expect((await late.scores.write(late.actor, event.id, late.roundId, late.playerId, 10,
      { kind: 'unplayed', churchy: late.declaration(10, late.game.playerIds) }, null, identifier(24013))).change)
      .toEqual(recovered.change);
    await expect(late.scores.write(late.actor, event.id, late.roundId, late.playerId, 10,
      { kind: 'unplayed', churchy: late.declaration(10, [...late.game.playerIds].reverse()) }, null, identifier(24013)))
      .rejects.toMatchObject({ code: 'SCORE_REQUEST_CONFLICT' });
  });

  it('preserves canonical order and late receipt through raw-only edits, clear and declaration edits; rejects rewrites', async () => {
    const f = await fixture(7);
    const first = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 7,
      { kind: 'strokes', strokes: 4, churchy: f.declaration(7, f.game.playerIds) }, null, identifier(24020));
    const capture = { ...f.row(`index-capture:${f.roundId}`) };
    const raw = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 7,
      { kind: 'strokes', strokes: 5 }, etagFor(first.round, f.playerId), identifier(24021));
    const cleared = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 7,
      { kind: 'unplayed' }, etagFor(raw.round, f.playerId), identifier(24022));
    expect(cleared.change.after.churchy).toEqual(f.declaration(7, f.game.playerIds));
    const edit = { ...f.declaration(7), players: [{ playerId: f.playerId, counts: { other: 2 }, calls: [] }] };
    const changed = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 7,
      { kind: 'unplayed', churchy: edit }, etagFor(cleared.round, f.playerId), identifier(24023));
    expect(changed.change.after.churchy).toMatchObject({ rotation: { playerIds: f.game.playerIds }, players: edit.players });
    expect(f.row(`index-capture:${f.roundId}`)).toEqual(capture);
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 7,
      { kind: 'unplayed', churchy: f.declaration(7, [...f.game.playerIds].reverse()) },
      etagFor(changed.round, f.playerId), identifier(24024))).rejects.toMatchObject({ code: 'CHURCHY_ORDER_CONFLICT' });
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 8,
      { kind: 'unplayed', churchy: f.declaration(8, f.game.playerIds) },
      etagFor(changed.round, f.playerId), identifier(24025))).rejects.toMatchObject({ code: 'CHURCHY_ORDER_CONFLICT' });
  });

  it('rejects foreign/duplicate/missing rank members, noncanonical cards, wrong hole, stale game/input/card and exclusions', async () => {
    const f = await fixture();
    const invalid = [
      f.declaration(1, [...f.game.playerIds.slice(0, 3), f.peerId]),
      f.declaration(1, [f.playerId, f.playerId, ...f.game.playerIds.slice(2)]),
      f.declaration(1, f.game.playerIds.slice(1)),
      { ...f.declaration(1, f.game.playerIds), gameEtag: 'fictional-stale' },
      f.declaration(2, f.game.playerIds),
      { ...f.declaration(1, f.game.playerIds), players: [{ playerId: f.playerId, counts: { hogan: 1, seve: 1 }, calls: [] }] },
    ];
    for (const [index, churchy] of invalid.entries()) {
      await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
        { kind: 'strokes', strokes: 4, churchy }, null, identifier(24030 + index))).rejects.toBeInstanceOf(Error);
    }
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.game.playerIds[1] ?? '', 1,
      { kind: 'strokes', strokes: 4, churchy: f.declaration(1, f.game.playerIds) }, null, identifier(24038)))
      .rejects.toMatchObject({ code: 'CHURCHY_SETUP_CHANGED' });
    expect((await f.scores.get(f.actor, event.id, f.roundId)).setupLocked).toBe(false);
  });

  it('uses the dedicated staged declaration transport and keeps immutable private awards out of public acknowledgements', async () => {
    const f = await fixture();
    const churchy = { ...f.declaration(1, f.game.playerIds), players: [{ playerId: f.playerId, counts: { dime: 1 },
      calls: Array.from({ length: 60 }, (_, index) => ({ id: identifier(24200 + index), kind: 'murphy' as const, result: 'pending' as const })) }] };
    const score = { kind: 'strokes' as const, strokes: 4, churchy };
    const bytes = Buffer.from(JSON.stringify({ score }));
    expect(bytes.length).toBeGreaterThan(4096);
    expect(bytes.length).toBeLessThan(12288);
    const upload = { id: identifier(24040), bytes: bytes.length, parts: 1, sha256: createHash('sha256').update(bytes).digest('hex') };
    const requestId = identifier(24041);
    expect(await f.scores.receiveGameScore(f.actor, event.id, f.roundId, f.playerId, 1,
      { privateUpload: { ...upload, index: 0, content: bytes.toString('base64') } }, null, requestId)).toMatchObject({ kind: 'part' });
    expect((await f.scores.get(f.actor, event.id, f.roundId)).setupLocked).toBe(false);
    const received = await f.scores.receiveGameScore(f.actor, event.id, f.roundId, f.playerId, 1,
      { privateCommit: upload }, null, requestId);
    if (received.kind !== 'value') throw new Error('Missing fictional staged body');
    const parsed = parseScoreWriteBody(received.value);
    f.submit.mockImplementationOnce((actions) => {
      f.apply(actions);
      return Promise.reject(new Error('Fictional lost transaction acknowledgement'));
    });
    const saved = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1, parsed.score, null, requestId);
    expect(saved.change.after).toEqual(score);
    expect(saved.change.dotAwardAudit).toBeUndefined();
    expect(isScoreWriteResult(saved)).toBe(true);
    expect((await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1, score, null, requestId)).change).toEqual(saved.change);
    expect((await f.scores.history(creator, event.id, f.roundId, f.playerId)).changes[0]?.dotAwardAudit?.[0])
      .toMatchObject({ kind: 'churchy', version: 3, configuration: f.game,
        after: [expect.objectContaining({ kind: 'dime', recipientIds: [f.game.playerIds[0], f.game.playerIds[3]] })] });
  });

  it('rechecks late provenance after staging and rejects a competing event revision without publishing the order/capture', async () => {
    const f = await fixture(10);
    const score = { kind: 'unplayed' as const, churchy: f.declaration(10, f.game.playerIds) };
    const bytes = Buffer.from(JSON.stringify({ score }));
    const upload = { id: identifier(24600), bytes: bytes.length, parts: 1, sha256: createHash('sha256').update(bytes).digest('hex') };
    await f.scores.receiveGameScore(f.actor, event.id, f.roundId, f.playerId, 10,
      { privateUpload: { ...upload, index: 0, content: bytes.toString('base64') } }, null, identifier(24601));
    await f.scores.write(f.actor, event.id, f.roundId, f.game.playerIds[1] ?? '', 12,
      { kind: 'strokes', strokes: 4 }, null, identifier(24602));
    const received = await f.scores.receiveGameScore(f.actor, event.id, f.roundId, f.playerId, 10,
      { privateCommit: upload }, null, identifier(24601));
    if (received.kind !== 'value') throw new Error('Missing fictional staged order');
    const saved = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 10,
      parseScoreWriteBody(received.value).score, null, identifier(24601));
    expect(saved.change.after.churchy).toMatchObject({ rotation: { recordedLate: true } });
    const race = await fixture(10);
    race.submit.mockImplementationOnce((actions) => {
      race.seed({ ...race.row('event'), name: 'Fictional competing event revision' });
      race.apply(actions);
      return Promise.resolve({ status: 202, subResponses: [], getResponseForEntity: () => undefined });
    });
    await expect(race.scores.write(race.actor, event.id, race.roundId, race.playerId, 10,
      { kind: 'unplayed', churchy: race.declaration(10, race.game.playerIds) }, null, identifier(24603)))
      .rejects.toMatchObject({ status: 409, code: 'SCORECARD_CHANGED' });
    expect(race.rows.has(`${event.id}|score-change:${identifier(24603)}`)).toBe(false);
    const after = await race.scores.get(race.actor, event.id, race.roundId);
    expect(after.setupLocked).toBe(false);
    expect(after.games?.results[0]?.churchy?.order).toBeUndefined();
    expect(etagFor(after, race.playerId)).toBeNull();
  });

  it('supports only intentional unstarted v2→v3 upgrades and retains conditional setup locks and original v1', async () => {
    const f = await publicFixture();
    const v2 = { id: identifier(24050), name: 'Churchy Game', kind: 'churchy' as const, version: 2 as const,
      basis: 'net' as const, groupNumber: 1, playerIds: f.input.playerIds.slice(0, 4), amountPerDotMinor: 50,
      currency: 'USD' as const, enabledSpecials: ['birdie' as const] };
    const first = await f.scores.saveGames(f.actor, event.id, f.roundId, [v2], null, identifier(24051));
    const common = { id: v2.id, name: v2.name, kind: v2.kind, version: v2.version, basis: v2.basis,
      groupNumber: v2.groupNumber, playerIds: v2.playerIds, amountPerDotMinor: v2.amountPerDotMinor, currency: v2.currency };
    const v3: ChurchyGameDefinitionV3 = { ...common, name: 'Churcie', version: 3, orderMode: 'approach',
      specials: defaultChurchySpecialSelections };
    await expect(f.scores.saveGames(f.actor, event.id, f.roundId, [v3], 'fictional-stale', identifier(24052)))
      .rejects.toMatchObject({ code: 'GAMES_CHANGED' });
    const upgraded = await f.scores.saveGames(f.actor, event.id, f.roundId, [v3],
      first.round.games?.configuration.etag ?? null, identifier(24053));
    expect(upgraded.round.games?.configuration.games).toEqual([v3]);
    const started = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4 }, null, identifier(24054));
    await expect(f.scores.saveGames(f.actor, event.id, f.roundId, [{ ...v3, orderMode: 'tee' as const }],
      started.round.games?.configuration.etag ?? null, identifier(24055))).rejects.toMatchObject({ code: 'MATCH_SETUP_LOCKED' });
    const fresh = await publicFixture();
    const old = await fresh.scores.saveGames(creator, event.id, fresh.roundId,
      [{ ...common, version: 1 as const }], null, identifier(24056));
    await expect(fresh.scores.saveGames(creator, event.id, fresh.roundId, [v3],
      old.round.games?.configuration.etag ?? null, identifier(24057))).rejects.toMatchObject({ code: 'CHURCHY_REQUIRES_NEW_GAME' });
  });

  it('keeps hidden v3 extras through a kill switch raw save, denies new edits, and strips tester data/capabilities', async () => {
    const f = await fixture();
    const first = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, churchy: f.declaration(1, f.game.playerIds) }, null, identifier(24060));
    const disabled = new TableScoreStore(f.table, f.workspace, () => false);
    const raw = await disabled.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 5 }, etagFor(first.round, f.playerId), identifier(24061));
    expect(raw.change.after.churchy).toEqual(first.change.after.churchy);
    expect(raw.round.churchyRulesVersions).toBeUndefined();
    await expect(disabled.write(f.actor, event.id, f.roundId, f.playerId, 2,
      { kind: 'strokes', strokes: 4, churchy: f.declaration(2) }, etagFor(raw.round, f.playerId), identifier(24062)))
      .rejects.toMatchObject({ code: 'CHURCHY_DISABLED' });
    const tester = await testerFixture();
    const game = { ...f.game, playerIds: tester.input.playerIds.slice(0, 4) };
    await tester.scores.saveGames(creator, event.id, tester.roundId, [game], null, identifier(24063));
    const view = await tester.scores.get(tester.actor, event.id, tester.roundId);
    expect(view.games?.configuration.games).toEqual([]);
    expect(view.churchyRulesVersions).toBeUndefined();
    expect(view.dotsSpecialKinds).toBeUndefined();
    expect(isRoundScores(view)).toBe(true);
  });
});
