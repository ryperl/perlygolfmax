import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { DotsGameDefinition, DotsHoleRecord } from '../../../src/domain/dots.js';
import type { HoleScore, RoundScores } from '../../../src/domain/scoring.js';
import { isRoundScores, isScoreWriteResult } from '../../../src/contracts/scoring.js';
import { publicFixture } from '../public-access/test-support.js';
import { testerFixture } from '../test-access/test-support.js';
import { creator, event } from '../../test/fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { parseScoreWriteBody } from './handlers.js';

function cardEtag(round: RoundScores, playerId: string): string | null {
  const card = round.cards.find((entry) => entry.playerId === playerId);
  if (!card) throw new Error('Missing fictional card');
  return card.etag;
}

async function fixture(rotationHoles: 3 | 6 = 3, startingHole = 10) {
  const f = await publicFixture();
  const workspace = await f.workspace.get(creator, event.id);
  await f.workspace.save(creator, event.id, { ...f.input, rounds: f.input.rounds.map((round) => ({
    ...round, groups: round.groups.map((group) => ({ ...group, startingHole })),
  })) }, workspace.etag);
  const ids = f.input.playerIds.slice(0, 4);
  const game: DotsGameDefinition = {
    id: identifier(22000), name: 'Fictional rotating Dots', kind: 'dots', version: 2,
    mode: 'rotating', rotationHoles, playerIds: ids, groupNumber: 1, stakeMinor: 50,
    specials: [{ kind: 'sandy', units: 1 }, { kind: 'hogan', units: 1 }, { kind: 'seve', units: 1 },
      { kind: 'pully', units: 1 }, { kind: 'dime', units: 1 }, { kind: 'super-dime', units: 1 },
      { kind: 'murphy', units: 1 }, { kind: 'chippy', units: 1 }, { kind: 'walk', units: 1 }],
  };
  const round = (await f.scores.saveGames(f.actor, event.id, f.roundId, [game], null, identifier(22001))).round;
  const declaration = (number: number, order?: readonly string[]): DotsHoleRecord => ({
    number, gameId: game.id, gameEtag: round.games?.configuration.etag ?? 'missing',
    players: [], contests: [], ...(order ? { rotation: { playerIds: order } } : {}),
  });
  return { ...f, game, ids, round, declaration };
}

describe('rotating Dots score transaction authority', () => {
  it.each([3, 6] as const)('stages an order and specials atomically and shares across %i-hole blocks from the first played shotgun hole', async (length) => {
    const f = await fixture(length);
    const order = [f.ids[0] ?? '', f.ids[2] ?? '', f.ids[1] ?? '', f.ids[3] ?? ''];
    const first = { ...f.declaration(12, order),
      players: [{ playerId: f.playerId, counts: { sandy: 1 }, calls: [] }] };
    const score: HoleScore = { kind: 'strokes', strokes: 4, dots: [first] };
    const bytes = Buffer.from(JSON.stringify({ score }));
    const upload = { id: identifier(22002), bytes: bytes.length, parts: 1,
      sha256: createHash('sha256').update(bytes).digest('hex') };
    const requestId = identifier(22003);
    expect(await f.scores.receiveGameScore(f.actor, event.id, f.roundId, f.playerId, 12,
      { privateUpload: { ...upload, index: 0, content: bytes.toString('base64') } }, null, requestId))
      .toMatchObject({ kind: 'part' });
    expect((await f.scores.get(f.actor, event.id, f.roundId)).setupLocked).toBe(false);
    const staged = await f.scores.receiveGameScore(f.actor, event.id, f.roundId, f.playerId, 12,
      { privateCommit: upload }, null, requestId);
    if (staged.kind !== 'value') throw new Error('Incomplete fictional upload');
    const parsed = parseScoreWriteBody(staged.value);
    f.submit.mockImplementationOnce((actions) => {
      f.apply(actions);
      return Promise.reject(new Error('Fictional lost acknowledgement'));
    });
    const saved = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 12,
      parsed.score, null, requestId);
    expect(saved.change.after.dots).toEqual([first]);
    expect(saved.round.dotsRulesVersions).toEqual([1, 2]);
    expect(isRoundScores(saved.round)).toBe(true);
    expect(isScoreWriteResult(saved)).toBe(true);
    expect(saved.round.games?.results[0]?.dots?.awards[0]?.recipientIds).toEqual(order.slice(0, 2));
    expect(saved.change.dotAwardAudit).toBeUndefined();
    expect((await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 12, score, null, requestId)).change)
      .toEqual(saved.change);
    const history = await f.scores.history(creator, event.id, f.roundId, f.playerId);
    expect(history.changes[0]?.dotAwardAudit?.[0]).toMatchObject({
      version: 2, configuration: f.game, gameEtag: f.round.games?.configuration.etag,
      inputRevision: null, after: [{ recipientIds: order.slice(0, 2) }],
    });
    const nextHole = (12 + length - 1) % 18 + 1;
    const next = { ...f.declaration(nextHole), players: first.players };
    const later = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, nextHole,
      { kind: 'strokes', strokes: 4, dots: [next] }, cardEtag(saved.round, f.playerId), identifier(22004));
    expect(later.round.games?.results[0]?.dots?.awards.find((award) => award.number === nextHole)?.recipientIds)
      .toEqual([order[0], order[2]]);
  });

  it('accepts order-only writes without trusting client late flags, preserves captures and never drops the receipt when scores clear', async () => {
    const f = await fixture();
    await f.scores.write(f.actor, event.id, f.roundId, f.peerId, 10,
      { kind: 'strokes', strokes: 4 }, null, identifier(22100));
    const initial = { ...f.declaration(12, f.ids), rotation: { playerIds: f.ids, recordedLate: true as const },
      players: [{ playerId: f.playerId, counts: { sandy: 1 },
        calls: [{ id: identifier(22106), kind: 'murphy' as const, result: 'pending' as const }] }] };
    const saved = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 12,
      { kind: 'unplayed', dots: [initial] }, null, identifier(22101));
    const stored = { ...initial, rotation: { playerIds: f.ids } };
    expect(saved.change.after.dots).toEqual([stored]);
    expect(saved.change.after.kind).toBe('unplayed');
    expect(saved.round.games?.results[0]?.dots?.awards).toEqual([]);
    expect(saved.round.games?.results[0]?.dots?.holes.find((hole) => hole.number === 12)?.status).toBe('pending');
    expect(saved.round.setupLocked).toBe(true);
    const capture = f.row(`index-capture:${f.roundId}`);
    const raw = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 12,
      { kind: 'strokes', strokes: 4 }, cardEtag(saved.round, f.playerId), identifier(22102));
    const cleared = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 12,
      { kind: 'unplayed' }, cardEtag(raw.round, f.playerId), identifier(22103));
    expect(cleared.change.after.dots).toEqual([stored]);
    expect(f.row(`index-capture:${f.roundId}`)).toEqual(capture);
    const specialsCleared = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 12,
      { kind: 'unplayed', dots: [{ ...stored, players: [], contests: [] }] },
      cardEtag(cleared.round, f.playerId), identifier(22107));
    expect(specialsCleared.change.after.dots?.[0]?.rotation).toEqual(stored.rotation);
    for (const edit of [f.declaration(12), f.declaration(12, [...f.ids].reverse())]) {
      await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 12,
        { kind: 'unplayed', dots: [edit] }, cardEtag(specialsCleared.round, f.playerId), identifier(22104)))
        .rejects.toMatchObject({ status: 409, code: 'DOTS_ROTATION_CONFLICT' });
    }
    await expect(f.scores.saveGames(f.actor, event.id, f.roundId, [{ ...f.game, rotationHoles: 6 as const }],
      f.round.games?.configuration.etag ?? null, identifier(22105))).rejects.toMatchObject({ code: 'MATCH_SETUP_LOCKED' });
  });

  it('recovers missing order on the earliest played group circuit hole and retains authoritative late timing on exact retries', async () => {
    const f = await fixture();
    const other = f.ids[1] ?? '';
    await f.scores.write(f.actor, event.id, f.roundId, other, 14,
      { kind: 'strokes', strokes: 4 }, null, identifier(22200));
    await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 12,
      { kind: 'strokes', strokes: 4 }, null, identifier(22201));
    const before = await f.scores.get(f.actor, event.id, f.roundId);
    expect(before.games?.results[0]?.dots?.awards).toEqual([]);
    expect(before.games?.results[0]?.dots?.holes.find((hole) => hole.number === 12)?.status).toBe('pending');
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 14,
      { kind: 'unplayed', dots: [f.declaration(14, f.ids)] }, cardEtag(before, f.playerId), identifier(22202)))
      .rejects.toMatchObject({ code: 'DOTS_SETUP_CHANGED' });
    const score: HoleScore = { kind: 'strokes', strokes: 4, dots: [f.declaration(12, f.ids)] };
    const saved = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 12,
      score, cardEtag(before, f.playerId), identifier(22203));
    expect(saved.change.after.dots?.[0]?.rotation).toEqual({ playerIds: f.ids, recordedLate: true });
    expect((await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 12,
      score, cardEtag(before, f.playerId), identifier(22203))).change).toEqual(saved.change);
    const cleared = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 12,
      { kind: 'unplayed', dots: [{ ...f.declaration(12, f.ids), players: [], contests: [] }] },
      cardEtag(saved.round, f.playerId), identifier(22204));
    expect(cleared.change.after.dots?.[0]?.rotation?.recordedLate).toBe(true);
  });

  it('rejects wrong anchors, foreign participants, wrong revision/hole and legacy version conversions', async () => {
    const f = await fixture();
    const base = f.declaration(12, f.ids);
    const invalid = [{ ...base, number: 11 }, { ...base, gameEtag: 'wrong-game-revision' },
      { ...base, rotation: { playerIds: [f.peerId, ...f.ids.slice(1)] } }];
    for (const declaration of invalid) {
      await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 12,
        { kind: 'unplayed', dots: [declaration] }, null, identifier(22300)))
        .rejects.toMatchObject({ code: 'DOTS_SETUP_CHANGED' });
    }
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.ids[1] ?? '', 12,
      { kind: 'unplayed', dots: [base] }, null, identifier(22301)))
      .rejects.toMatchObject({ code: 'DOTS_SETUP_CHANGED' });
    const legacy: DotsGameDefinition = { id: f.game.id, name: f.game.name, kind: 'dots', version: 1,
      mode: 'individual', stakeMinor: null, groupNumber: 1, playerIds: f.ids, specials: [] };
    await expect(f.scores.saveGames(creator, event.id, f.roundId, [legacy],
      f.round.games?.configuration.etag ?? null, identifier(22302))).rejects.toMatchObject({ code: 'DOTS_REQUIRES_NEW_GAME' });
  });

  it('revalidates assembled orders against scores acknowledged since upload and rejects a competing final event revision atomically', async () => {
    const f = await fixture();
    const score: HoleScore = { kind: 'unplayed', dots: [f.declaration(14, f.ids)] };
    const bytes = Buffer.from(JSON.stringify({ score }));
    const upload = { id: identifier(22400), bytes: bytes.length, parts: 1,
      sha256: createHash('sha256').update(bytes).digest('hex') };
    await f.scores.receiveGameScore(f.actor, event.id, f.roundId, f.playerId, 14,
      { privateUpload: { ...upload, index: 0, content: bytes.toString('base64') } }, null, identifier(22401));
    await f.scores.write(f.actor, event.id, f.roundId, f.ids[1] ?? '', 12,
      { kind: 'strokes', strokes: 4 }, null, identifier(22402));
    const staged = await f.scores.receiveGameScore(f.actor, event.id, f.roundId, f.playerId, 14,
      { privateCommit: upload }, null, identifier(22401));
    if (staged.kind !== 'value') throw new Error('Incomplete fictional upload');
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 14,
      parseScoreWriteBody(staged.value).score, null, identifier(22401))).rejects.toMatchObject({ code: 'DOTS_SETUP_CHANGED' });
    f.submit.mockImplementationOnce((actions) => {
      f.seed({ ...f.row('event'), name: 'Fictional concurrent revision' });
      f.apply(actions);
      return Promise.resolve({ status: 202, subResponses: [], getResponseForEntity: () => undefined });
    });
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 12,
      { kind: 'unplayed', dots: [f.declaration(12, f.ids)] }, null, identifier(22403)))
      .rejects.toMatchObject({ status: 409, code: 'SCORECARD_CHANGED' });
    expect(f.rows.has(`${event.id}|score-change:${identifier(22403)}`)).toBe(false);
    expect((await f.scores.get(f.actor, event.id, f.roundId)).cards.find((card) => card.playerId === f.playerId)?.etag).toBeNull();
  });

  it('does not expose rotating capabilities, records, ledgers or award audits to legacy testers', async () => {
    const f = await testerFixture();
    const game: DotsGameDefinition = { id: identifier(22500), name: 'Fictional rotating Dots',
      kind: 'dots', version: 2, mode: 'rotating', rotationHoles: 3, stakeMinor: null,
      groupNumber: 1, playerIds: f.input.playerIds.slice(0, 4), specials: [] };
    const setup = await f.scores.saveGames(creator, event.id, f.roundId, [game], null, identifier(22501));
    const score: HoleScore = { kind: 'unplayed', dots: [{ number: 1, gameId: game.id,
      gameEtag: setup.round.games?.configuration.etag ?? 'missing', players: [], contests: [],
      rotation: { playerIds: game.playerIds } }] };
    const saved = await f.scores.write(creator, event.id, f.roundId, f.playerId, 1, score, null, identifier(22502));
    const tester = await f.scores.get(f.actor, event.id, f.roundId);
    expect(tester.dotsRulesVersions).toBeUndefined();
    expect(tester.dotsIndividualPlayerCounts).toBeUndefined();
    expect(tester.internalSettlements).toBeUndefined();
    expect(tester.games?.configuration.games).toEqual([]);
    expect(JSON.stringify(tester)).not.toContain('rotationHoles');
    expect(tester.cards.find((card) => card.playerId === f.playerId)?.holes[0]?.score.dots).toBeUndefined();
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1, score,
      cardEtag(saved.round, f.playerId), identifier(22503))).rejects.toMatchObject({ code: 'MATCH_DECLARATIONS_NOT_ALLOWED' });
  });
});
