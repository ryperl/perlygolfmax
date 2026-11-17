import { describe, expect, it } from 'vitest';
import type { NassauGameDefinition } from '../../../src/domain/nassau.js';
import type { WolfGameDefinition, WolfHoleRecord } from '../../../src/domain/wolf.js';
import type { HoleScore, RoundScores } from '../../../src/domain/scoring.js';
import { isRoundScores, isScoreWriteResult } from '../../../src/contracts/scoring.js';
import { roundMatchesSnapshot } from '../../../src/contracts/round-context.js';
import { scoringFixture } from '../../test/scoring-fixtures.js';
import { publicFixture } from '../public-access/test-support.js';
import { testerFixture } from '../test-access/test-support.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { creator, event } from '../../test/fixtures.js';
import { stablefordPoints } from '../../../src/domain/stableford.js';
import { createHash } from 'node:crypto';
import { privateWritePartBytes } from '../../../src/contracts/private-values.js';
import { isRecord } from '../../../src/contracts/events.js';
import { parseScoreWriteBody } from './handlers.js';

function definitions(ids: readonly string[]): readonly [WolfGameDefinition, NassauGameDefinition] {
  return [
    { id: identifier(7001), name: 'Fictional Wolf', kind: 'wolf', version: 1, basis: 'gross',
      groupNumber: 1, playerIds: ids.slice(0, 4).reverse(), allowPig: true },
    { id: identifier(7002), name: 'Fictional Nassau', kind: 'nassau', version: 1, basis: 'gross',
      groupNumber: 1, variant: 'singles',
      sides: ids.slice(0, 2).map((id, index) => ({ id: identifier(7100 + index), name: `Fictional side ${String(index + 1)}`, playerIds: [id] })),
      stakes: { currency: 'USD', frontMinor: 100, backMinor: 100, overallMinor: 200 }, automaticPresses: true },
  ];
}
function etag(round: RoundScores, playerId: string): string | null {
  const card = round.cards.find((entry) => entry.playerId === playerId);
  if (!card) throw new Error('Missing fictional card');
  return card.etag;
}
function choice(game: WolfGameDefinition, round: RoundScores, number = 1): WolfHoleRecord {
  return { number, choice: { gameId: game.id, gameEtag: round.games?.configuration.etag ?? 'missing', mode: 'pig' } };
}

describe('persisted Nassau and Wolf declarations', () => {
  it('retains declaration anchors and Wolf rotation during corrections, and preserves corrected-input revisions on lost acknowledgements', async () => {
    const f = await scoringFixture();
    const [wolf] = definitions(f.input.playerIds);
    await f.scores.saveGames(creator, event.id, f.roundId, [wolf], null, identifier(8300));
    const original = await f.write(null, 8301);
    const model = await f.workspace.correctionModel(creator, event.id, f.roundId);
    const body = { expected: { eventEtag: model.eventEtag, roundEtag: model.roundEtag, gamesEtag: model.gamesEtag ?? null,
      inputRevision: model.inputRevision ?? null }, reason: 'Fictional captured handicap correction.', reviewSummary: 'Review fictional results.',
      correction: { teeProfileId: model.teeProfileId, groups: model.groups,
        players: model.players.map((player) => ({ playerId: player.playerId, handicapIndexValue: '8.4' })) } };
    for (const groups of [model.groups.map((group) => ({ ...group, playerIds: [...group.playerIds].reverse() })),
      model.groups.map((group) => ({ ...group, startingHole: 2 }))]) {
      await expect(f.workspace.correctRound(creator, event.id, f.roundId, identifier(8302),
        { ...body, correction: { ...body.correction, groups } })).rejects.toMatchObject({ code: 'MATCH_SETUP_CHANGED' });
    }
    const corrected = await f.workspace.correctRound(creator, event.id, f.roundId, identifier(8303), body);
    const inputRevision = corrected.model.inputRevision;
    if (!inputRevision) throw new Error('Missing fictional corrected revision');
    const score: HoleScore = { kind: 'strokes', strokes: 5, wolf: [choice(wolf, original.round)] };
    f.submit.mockImplementationOnce((actions) => { f.apply(actions); return Promise.reject(new Error('Fictional lost corrected receipt')); });
    const saved = await f.scores.write(creator, event.id, f.roundId, f.playerId, 1, score,
      etag(original.round, f.playerId), identifier(8304), inputRevision);
    expect(saved.change.expectedInputRevision).toBe(inputRevision);
    expect(isScoreWriteResult(saved)).toBe(true);
    expect((await f.scores.write(creator, event.id, f.roundId, f.playerId, 1, score,
      etag(original.round, f.playerId), identifier(8304), inputRevision)).change).toEqual(saved.change);
  });
  it('acknowledges an earlier committed definition even when it was edited before scoring subsequently locked it', async () => {
    const f = await scoringFixture();
    const [wolf] = definitions(f.input.playerIds);
    const original = await f.scores.saveGames(creator, event.id, f.roundId, [wolf], null, identifier(8100));
    const changed = { ...wolf, allowPig: false };
    await f.scores.saveGames(creator, event.id, f.roundId, [changed], original.round.games?.configuration.etag ?? null, identifier(8101));
    await f.write(null, 8102);
    const replay = await f.scores.saveGames(creator, event.id, f.roundId, [wolf], null, identifier(8100));
    expect(replay.change).toEqual(original.change);
    expect(replay.round.games?.configuration.games).toEqual([changed]);
    expect(isRoundScores(replay.round)).toBe(true);
  });
  it('saves on the group anchor, not Wolf P1, with authoritative results, immutable choices, audit and idempotent acknowledgement', async () => {
    const f = await publicFixture();
    const [wolf, nassau] = definitions(f.input.playerIds);
    const setup = await f.scores.saveGames(creator, event.id, f.roundId, [wolf, nassau], null, identifier(7200));
    expect(setup.round.supportedGameKinds).toEqual(expect.arrayContaining(['stroke-play', 'wolf', 'nassau']));
    const special = choice(wolf, setup.round);
    const score: HoleScore = { kind: 'strokes', strokes: 4, wolf: [special] };
    f.submit.mockImplementationOnce((actions) => { f.apply(actions); return Promise.reject(new Error('Fictional lost acknowledgement')); });
    const first = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1, score, null, identifier(7201));
    expect(isScoreWriteResult(first)).toBe(true);
    expect(first.change.after).toEqual(score);
    expect(first.change.recordedBy).toEqual(f.actor);
    expect(first.round.games?.results[0]?.wolf?.holes[0]).toMatchObject({ mode: 'pig', status: 'pending' });
    expect((await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1, score, null, identifier(7201))).change).toEqual(first.change);
    expect((await f.scores.history(creator, event.id, f.roundId, f.playerId)).changes[0]?.after).toEqual(score);
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.peerId, 1, score, null, identifier(7202)))
      .rejects.toMatchObject({ code: 'MATCH_SETUP_CHANGED' });
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1, {
      ...score, wolf: [{ ...special, choice: { gameId: special.choice.gameId, gameEtag: special.choice.gameEtag, mode: 'blind' } }],
    }, etag(first.round, f.playerId), identifier(7203))).rejects.toMatchObject({ code: 'WOLF_CHOICE_LOCKED' });
    const raw = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 5 }, etag(first.round, f.playerId), identifier(7204));
    expect(raw.change.after.wolf).toEqual([special]);
    expect(isRoundScores(raw.round)).toBe(true);
    const workspace = await f.workspace.get(creator, event.id);
    const snapshot = workspace.rounds.find((round) => round.id === f.roundId);
    if (!snapshot) throw new Error('Missing fictional snapshot');
    expect(roundMatchesSnapshot(workspace, snapshot, await f.scores.get(creator, event.id, f.roundId))).toBe(true);
  });

  it('marks a late initial Wolf declaration authoritatively and cannot erase the marker with an outcome correction', async () => {
    const f = await scoringFixture();
    const [wolf] = definitions(f.input.playerIds);
    const setup = await f.scores.saveGames(creator, event.id, f.roundId, [wolf], null, identifier(7300));
    const first = await f.write(null, 7301);
    const late = await f.scores.write(creator, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, wolf: [choice(wolf, setup.round)] }, etag(first.round, f.playerId), identifier(7302));
    expect(late.change.after.wolf?.[0]?.recordedLate).toBe(true);
    expect(late.round.games?.results[0]?.wolf?.holes[0]?.recordedLate).toBe(true);
    expect(isScoreWriteResult(late)).toBe(true);
    const corrected = await f.scores.write(creator, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 4, wolf: [{ ...choice(wolf, late.round), outcome: 'halved' }] },
      etag(late.round, f.playerId), identifier(7303));
    expect(corrected.change.after.wolf?.[0]?.recordedLate).toBe(true);
    expect(corrected.round.games?.results[0]?.wolf?.players.map((player) => player.balance)).toEqual([0, 0, 0, 0]);
    expect(isScoreWriteResult(corrected)).toBe(true);
  });

  it('locks Nassau/Wolf definitions after first save, preserves unchanged peers and permits a committed setup replay', async () => {
    const f = await scoringFixture();
    const games = definitions(f.input.playerIds);
    const setup = await f.scores.saveGames(creator, event.id, f.roundId, games, null, identifier(7400));
    await f.write(null, 7401);
    expect((await f.scores.saveGames(creator, event.id, f.roundId, games, null, identifier(7400))).change).toEqual(setup.change);
    for (const changed of [[{ ...games[0], allowPig: false }, games[1]],
      [games[0], { ...games[1], automaticPresses: false }]]) {
      await expect(f.scores.saveGames(creator, event.id, f.roundId, changed,
        setup.round.games?.configuration.etag ?? null, identifier(7402))).rejects.toMatchObject({ code: 'MATCH_SETUP_LOCKED' });
    }
    const stableford = { id: identifier(7403), name: 'Fictional Stableford', basis: 'gross' as const,
      preset: 'standard' as const, handicapAllowancePercent: 95, points: stablefordPoints('standard') };
    const peer = await f.scores.saveGames(creator, event.id, f.roundId, [...games, stableford],
      setup.round.games?.configuration.etag ?? null, identifier(7404));
    expect(peer.round.games?.configuration.games.slice(0, 2)).toEqual(games);
    expect(isRoundScores(peer.round)).toBe(true);
  });

  it('validates presses against acknowledged prior holes and preserves append-only receipts through raw-only writes', async () => {
    const f = await publicFixture();
    const [, base] = definitions(f.input.playerIds);
    const nassau = { ...base, automaticPresses: false };
    let round = (await f.scores.saveGames(creator, event.id, f.roundId, [nassau], null, identifier(7500))).round;
    let operation = 7501;
    for (const hole of [1, 2]) for (const [index, playerId] of f.input.playerIds.entries()) {
      round = (await f.scores.write(f.actor, event.id, f.roundId, playerId, hole,
        { kind: 'strokes', strokes: index === 0 ? 3 : 4 }, etag(round, playerId), identifier(operation++))).round;
    }
    const option = round.games?.results[0]?.nassau?.pressOptions.find((entry) => entry.parentBetId.endsWith(':front'));
    if (!option) throw new Error('Missing fictional press option');
    const press = { ...option, id: identifier(7600) };
    const record = { number: 3, gameId: nassau.id, gameEtag: round.games?.configuration.etag ?? '', outcomes: [], presses: [press] };
    const score: HoleScore = { kind: 'strokes', strokes: 4, nassau: [record] };
    const saved = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 3,
      score, etag(round, f.playerId), identifier(operation++));
    expect(isScoreWriteResult(saved)).toBe(true);
    expect(saved.round.games?.results[0]?.nassau?.stalePresses).toEqual([]);
    const raw = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 3,
      { kind: 'strokes', strokes: 5 }, etag(saved.round, f.playerId), identifier(operation++));
    expect(raw.change.after.nassau).toEqual([record]);
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 3,
      { kind: 'strokes', strokes: 5, nassau: [{ ...record, presses: [{ ...press, pressingSide: 'a' }] }] },
      etag(raw.round, f.playerId), identifier(operation++))).rejects.toMatchObject({ code: 'NASSAU_PRESS_CONFLICT' });
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 4,
      { kind: 'unplayed', nassau: [{ ...record, number: 4, presses: [{ ...press, id: identifier(7601), startHole: 4, declaredAfterHole: 3 }] }] },
      etag(raw.round, f.playerId), identifier(operation++))).rejects.toMatchObject({ code: 'NASSAU_PRESS_CHANGED' });
    const changed = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 7 }, etag(raw.round, f.playerId), identifier(operation++));
    expect(changed.round.games?.results[0]?.nassau?.stalePresses).toEqual([press]);
    expect(isScoreWriteResult(changed)).toBe(true);
  });

  it('stages large declaration commands without publishing scores and binds uploads to the exact actor, hole and card revision', async () => {
    const f = await publicFixture();
    const [, base] = definitions(f.input.playerIds);
    const nassau = { ...base, automaticPresses: false, variant: 'three-way' as const,
      sides: f.input.playerIds.slice(0, 3).map((id, index) => ({ id: identifier(7700 + index),
        name: `Fictional side ${String(index)}`, playerIds: [id] })) };
    const games = Array.from({ length: 4 }, (_, index) => ({ ...nassau, id: identifier(7705 + index) }));
    let round = (await f.scores.saveGames(creator, event.id, f.roundId, games, null, identifier(7800))).round;
    let operation = 7801;
    for (const hole of [1, 2]) for (const [index, playerId] of f.input.playerIds.entries()) {
      round = (await f.scores.write(f.actor, event.id, f.roundId, playerId, hole,
        { kind: 'strokes', strokes: index + 3 }, etag(round, playerId), identifier(operation++))).round;
    }
    const options = round.games?.results.flatMap((result) => result.nassau?.pressOptions ?? []) ?? [];
    expect(options.length).toBeGreaterThan(3);
    const score: HoleScore = { kind: 'strokes', strokes: 4, nassau: games.map((game, gameIndex) => ({
      number: 3, gameId: game.id, gameEtag: round.games?.configuration.etag ?? '', outcomes: [],
      presses: (round.games?.results.find((result) => result.gameId === game.id)?.nassau?.pressOptions ?? [])
        .map((option, index) => ({ ...option, id: identifier(7900 + gameIndex * 20 + index) })),
    })) };
    const bytes = Buffer.from(JSON.stringify({ score }));
    expect(bytes.length).toBeGreaterThan(12 * 1024);
    const upload = { id: identifier(7950), bytes: bytes.length, parts: Math.ceil(bytes.length / privateWritePartBytes),
      sha256: createHash('sha256').update(bytes).digest('hex') };
    const expected = etag(round, f.playerId), requestId = identifier(7951);
    for (let index = 0; index < upload.parts; index++) {
      const body = { privateUpload: { ...upload, index,
        content: bytes.subarray(index * privateWritePartBytes, (index + 1) * privateWritePartBytes).toString('base64') } };
      expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(12 * 1024);
      expect(await f.scores.receiveGameScore(f.actor, event.id, f.roundId, f.playerId, 3, body, expected, requestId))
        .toMatchObject({ kind: 'part', index });
      expect(etag(await f.scores.get(f.actor, event.id, f.roundId), f.playerId)).toBe(expected);
    }
    await expect(f.scores.receiveGameScore(f.actor, event.id, f.roundId, f.playerId, 4,
      { privateCommit: upload }, expected, requestId)).rejects.toMatchObject({ code: 'PRIVATE_UPLOAD_CONFLICT' });
    const assembled = await f.scores.receiveGameScore(f.actor, event.id, f.roundId, f.playerId, 3, { privateCommit: upload }, expected, requestId);
    if (assembled.kind !== 'value' || !isRecord(assembled.value)) throw new Error('Missing fictional staged declarations');
    const parsed = parseScoreWriteBody(assembled.value);
    const saved = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 3, parsed.score, expected, requestId);
    expect(isScoreWriteResult(saved)).toBe(true);
    expect(saved.change.after.nassau?.flatMap((record) => record.presses)).toHaveLength(options.length);
    const cardContent: unknown = JSON.parse(String(f.row(`score-card:${f.roundId}:${f.playerId}`).content));
    const auditContent: unknown = JSON.parse(String(f.row(`score-change:${requestId}`).content));
    expect(cardContent).toMatchObject({ privateValue: 1 });
    expect(auditContent).toMatchObject({ privateValue: 1 });
    expect((await f.scores.history(creator, event.id, f.roundId, f.playerId)).changes
      .find((change) => change.id === requestId)?.after).toEqual(saved.change.after);
    expect((await f.scores.get(f.actor, event.id, f.roundId)).cards.find((card) => card.playerId === f.playerId)?.holes
      .find((hole) => hole.number === 3)?.score).toEqual(saved.change.after);
  });

  it('keeps new match receipts and stakes out of legacy tester projections and rejects their new declarations while preserving raw scoring', async () => {
    const f = await testerFixture();
    const games = definitions(f.input.playerIds);
    const configured = await f.scores.saveGames(creator, event.id, f.roundId, games, null, identifier(7990));
    const score: HoleScore = { kind: 'strokes', strokes: 4, wolf: [choice(games[0], configured.round)] };
    const saved = await f.scores.write(creator, event.id, f.roundId, f.playerId, 1, score, null, identifier(7991));
    const visible = await f.scores.get(f.actor, event.id, f.roundId);
    expect(visible.games?.configuration.games).toEqual([]);
    expect(visible.cards[0]?.holes[0]?.score.wolf).toBeUndefined();
    expect(isRoundScores(visible)).toBe(true);
    await expect(f.scores.write(f.actor, event.id, f.roundId, f.playerId, 2,
      { kind: 'strokes', strokes: 4, wolf: [choice(games[0], configured.round, 2)] },
      etag(saved.round, f.playerId), identifier(7992))).rejects.toMatchObject({ code: 'MATCH_DECLARATIONS_NOT_ALLOWED' });
    const raw = await f.scores.write(f.actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'strokes', strokes: 5 }, etag(saved.round, f.playerId), identifier(7993));
    expect(raw.change.after.wolf).toBeUndefined();
    expect(isScoreWriteResult(raw)).toBe(true);
    expect((await f.scores.get(creator, event.id, f.roundId)).cards[0]?.holes[0]?.score.wolf).toEqual(score.wolf);
  });
});
