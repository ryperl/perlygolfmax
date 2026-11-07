import { describe, expect, it } from 'vitest';
import type { BallDropGameDefinition, RoundGameDefinition, SkinsGameDefinition } from '../../../src/domain/games.js';
import { isGameWriteResult, isRoundScores } from '../../../src/contracts/scoring.js';
import { roundMatchesSnapshot } from '../../../src/contracts/round-context.js';
import { scoringFixture } from '../../test/scoring-fixtures.js';
import { playerFixture } from '../../test/player-fixtures.js';
import { publicFixture } from '../public-access/test-support.js';
import { testerFixture } from '../test-access/test-support.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { creator, event, member } from '../../test/fixtures.js';
import { gameChangeKey, gameConfigurationKey } from './games.js';
import { stablefordPoints } from '../../../src/domain/stableford.js';
import { createHash } from 'node:crypto';
import { HttpRequest } from '@azure/functions';
import { privateReadResponse } from '../private-transport.js';
import { isPrivateReadPart, privateWritePartBytes } from '../../../src/contracts/private-values.js';
import { isRecord } from '../../../src/contracts/events.js';
import { isRoundGameDefinitions } from '../../../src/contracts/games.js';

function definitions(playerIds: readonly string[]): readonly RoundGameDefinition[] {
  const ball: BallDropGameDefinition = {
    id: identifier(700), name: 'Fictional Ball Drop', kind: 'ball-drop', version: 1, basis: 'net',
    format: 'ball-drop-net-gross',
    teams: Array.from({ length: playerIds.length / 4 }, (_, index) => ({
      id: identifier(710 + index), name: `Fictional team ${String(index + 1)}`, playerIds: playerIds.slice(index * 4, index * 4 + 4),
    })),
  };
  const skins: SkinsGameDefinition = {
    id: identifier(701), name: 'Fictional Net Skins', kind: 'skins', version: 1, basis: 'net', carryovers: true,
  };
  return [ball, skins];
}

describe('persisted stroke games share existing conditional scoring authority', () => {
  it('stages large new definitions in bounded inactive parts and keeps result pages digest-bound', async () => {
    const f = await publicFixture();
    const base = definitions(f.input.playerIds)[0];
    if (base?.kind !== 'ball-drop') throw new Error('Missing fictional Ball Drop');
    const games = Array.from({ length: 16 }, (_, index): BallDropGameDefinition => ({
      ...base, id: identifier(5000 + index), name: `Fictional game ${String(index)}`.padEnd(100, 'x'),
      basis: 'gross', format: 'ball-drop-two-gross',
      teams: base.teams.map((team) => ({ ...team, name: team.name.padEnd(100, 'x') })),
    }));
    const bytes = Buffer.from(JSON.stringify({ games }));
    expect(bytes.length).toBeGreaterThan(12 * 1024);
    const upload = { id: identifier(6000), bytes: bytes.length, parts: Math.ceil(bytes.length / privateWritePartBytes),
      sha256: createHash('sha256').update(bytes).digest('hex') };
    for (let index = 0; index < upload.parts; index++) {
      const body = { privateUpload: { ...upload, index,
        content: bytes.subarray(index * privateWritePartBytes, (index + 1) * privateWritePartBytes).toString('base64') } };
      expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(12 * 1024);
      await f.scores.receiveGames(creator, event.id, f.roundId, body, null, identifier(6001));
      expect((await f.scores.get(creator, event.id, f.roundId)).games).toBeUndefined();
      if (index === 0) await expect(f.scores.receiveGames(creator, event.id, f.roundId,
        { privateCommit: upload }, null, identifier(6001))).rejects.toMatchObject({ code: 'PRIVATE_UPLOAD_INCOMPLETE' });
    }
    const assembled = await f.scores.receiveGames(creator, event.id, f.roundId, { privateCommit: upload }, null, identifier(6001));
    if (assembled.kind !== 'value' || !isRecord(assembled.value) || !isRoundGameDefinitions(assembled.value.games)) {
      throw new Error('Missing fictional assembled game definitions');
    }
    expect(assembled.value.games).toEqual(games);
    expect((await f.scores.get(creator, event.id, f.roundId)).games).toBeUndefined();
    const commit = await f.scores.saveGames(creator, event.id, f.roundId, assembled.value.games, null, identifier(6001));
    expect(isGameWriteResult(commit)).toBe(true);
    if (!isGameWriteResult(commit)) throw new Error('Missing fictional game acknowledgement');
    expect(commit.round.games?.configuration.games).toEqual(games);
    const page = privateReadResponse(new HttpRequest({ method: 'GET', url: 'http://127.0.0.1/fixture' }), commit.round);
    expect(isPrivateReadPart(page)).toBe(true);
    if (!isPrivateReadPart(page)) throw new Error('Missing fictional bounded results');
    expect(page.privateRead.parts).toBeGreaterThan(1);
    const updated = await f.scores.saveGames(creator, event.id, f.roundId, games.map((game, index) => index ? game : {
      ...game, name: 'Fictional changed game',
    }), commit.round.games?.configuration.etag ?? null, identifier(6002));
    expect(() => privateReadResponse(new HttpRequest({ method: 'GET',
      url: `http://127.0.0.1/fixture?privatePart=1&privateHash=${page.privateRead.sha256}` }), updated.round))
      .toThrow('EVENT_CHANGED');
  });

  it('keeps new stale foursomes visible without results until explicitly repaired after an unscored roster change', async () => {
    const f = await scoringFixture();
    const games = definitions(f.input.playerIds);
    const saved = await f.scores.saveGames(creator, event.id, f.roundId, games, null, identifier(800));
    const replacement = await f.players.create(creator, identifier(204), 'Fictional replacement golfer');
    const roster = [replacement.id, ...f.input.playerIds.slice(1)];
    const workspace = await f.workspace.get(creator, event.id);
    await f.workspace.save(creator, event.id, { ...f.input, playerIds: roster, rounds: f.input.rounds.map((round) => ({
      ...round, groups: [{ number: 1, playerIds: roster }],
    })) }, workspace.etag);
    const stale = await f.scores.get(creator, event.id, f.roundId);
    expect(isRoundScores(stale)).toBe(true);
    expect(stale.games?.results[0]).toMatchObject({ teams: [], teamSetupRequired: true });
    const repaired = await f.scores.saveGames(creator, event.id, f.roundId, definitions(roster),
      saved.round.games?.configuration.etag ?? null, identifier(801));
    expect(isGameWriteResult(repaired)).toBe(true);
    expect(repaired.round.games?.results[0]?.teamSetupRequired).toBeUndefined();
    expect(repaired.round.games?.results[0]?.teams?.[0]?.playerIds).toEqual(roster);
  });

  it.each(['public', 'tester', 'player'] as const)('publishes authoritative results to %s without management or private observations', async (mode) => {
    const f = mode === 'public' ? await publicFixture() : mode === 'tester' ? await testerFixture() : await playerFixture();
    const actor = 'actor' in f ? f.actor : member;
    for (const [index, playerId] of f.input.playerIds.entries()) {
      const profile = await f.players.get(creator, playerId);
      await f.players.observe(creator, playerId, identifier(4000 + index), {
        value: index === 0 ? '+2' : '19.0', effectiveDate: '2026-01-01', source: 'Fictional private stroke capture',
      }, profile.etag);
    }
    const before = await f.workspace.get(creator, event.id);
    await f.workspace.refreshIndices(creator, event.id, f.roundId, identifier(4100), before.etag);
    const games = definitions(f.input.playerIds);
    const configured = await f.scores.saveGames(creator, event.id, f.roundId, games, null, identifier(4200));
    expect(isGameWriteResult(configured)).toBe(true);
    expect(configured.round.setupLocked).toBe(false);
    expect(await f.scores.saveGames(creator, event.id, f.roundId, games, null, identifier(4200))).toEqual(configured);
    for (const [index, playerId] of f.input.playerIds.entries()) {
      await f.scores.write(creator, event.id, f.roundId, playerId, 1,
        { kind: 'strokes', strokes: index === 1 ? 3 : 4 }, null, identifier(4300 + index));
    }
    const owner = await f.scores.get(creator, event.id, f.roundId);
    const read = await f.scores.get(actor, event.id, f.roundId);
    expect(read.games).toEqual(owner.games);
    expect(isRoundScores(read)).toBe(true);
    expect(read.games?.results[1]?.players[1]?.strokeGame?.holes[0]?.value).toBe(1);
    expect(read.games?.results[0]?.teams?.[0]?.strokeGame?.holes[0]?.countingPlayerIds).toHaveLength(2);
    const workspace = await f.workspace.get(actor, event.id);
    const snapshot = workspace.rounds[0];
    if (!snapshot) throw new Error('Missing fictional round');
    expect(roundMatchesSnapshot(workspace, snapshot, read)).toBe(true);
    expect(JSON.stringify(read)).not.toContain('Fictional private stroke capture');
    expect(JSON.stringify(read)).not.toContain(creator.objectId);
    expect(JSON.stringify(read)).not.toContain('handicapIndex');
    expect(read.permissions?.canManageGames).toBe(false);
    const firstPlayerId = f.input.playerIds[0];
    if (!firstPlayerId) throw new Error('Missing fictional player');
    const cardKey = `${event.id}|score-card:${f.roundId}:${firstPlayerId}`;
    const card = f.rows.get(cardKey);
    const changed = games.map((game) => game.kind === 'skins' ? { ...game, carryovers: false } : game);
    const edited = await f.scores.saveGames(creator, event.id, f.roundId, changed, owner.games?.configuration.etag ?? null, identifier(4400));
    expect(edited.change.before).toEqual(games);
    expect(edited.change.after).toEqual(changed);
    expect(f.rows.get(cardKey)).toEqual(card);
    await expect(f.scores.saveGames(creator, event.id, f.roundId, changed, null, identifier(4401)))
      .rejects.toMatchObject({ code: 'GAMES_CHANGED' });
  });

  it('protects Stableford overall bindings against selection and conversion to either stroke game', async () => {
    const f = await scoringFixture();
    const legacy = { id: identifier(700), name: 'Fictional Stableford', preset: 'standard' as const, basis: 'gross' as const,
      handicapAllowancePercent: 95, points: stablefordPoints('standard') };
    const first = await f.scores.saveGames(creator, event.id, f.roundId, [legacy], null, identifier(800));
    const current = await f.workspace.get(creator, event.id);
    await f.workspace.save(creator, event.id, { ...f.input, overallCompetition: {
      kind: 'stableford', credit: 'individual', roundGames: [{ roundId: f.roundId, gameId: legacy.id }],
    } }, current.etag);
    for (const game of definitions(f.input.playerIds)) {
      await expect(f.scores.saveGames(creator, event.id, f.roundId, [{ ...game, id: legacy.id }],
        first.round.games?.configuration.etag ?? null, identifier(810))).rejects.toMatchObject({ code: 'INVALID_OVERALL_GAME' });
    }
    const saved = await f.workspace.get(creator, event.id);
    await f.workspace.save(creator, event.id, { ...f.input, overallCompetition: null }, saved.etag);
    const next = await f.scores.saveGames(creator, event.id, f.roundId, definitions(f.input.playerIds),
      first.round.games?.configuration.etag ?? null, identifier(820));
    const latest = await f.workspace.get(creator, event.id);
    await expect(f.workspace.save(creator, event.id, { ...f.input, overallCompetition: {
      kind: 'stableford', credit: 'team', roundGames: [{ roundId: f.roundId, gameId: next.change.after[0]?.id ?? '' }],
    } }, latest.etag)).rejects.toMatchObject({ code: 'INVALID_OVERALL_GAME' });
  });

  it.each(['event', 'grant'] as const)('rolls back new definitions and audit if the %s changes during commit', async (kind) => {
    const f = await scoringFixture();
    f.submit.mockImplementationOnce((actions) => {
      const row = f.rows.get(`${event.id}|${kind === 'event' ? 'event' : `member:${creator.objectId}`}`);
      if (!row) throw new Error('Missing fictional authority row');
      f.seed({ ...row, etag: undefined });
      f.apply(actions);
      return Promise.resolve({ status: 202, subResponses: [], getResponseForEntity: () => undefined });
    });
    await expect(f.scores.saveGames(creator, event.id, f.roundId, definitions(f.input.playerIds), null, identifier(800)))
      .rejects.toMatchObject({ status: 409 });
    expect(f.rows.has(`${event.id}|${gameConfigurationKey(f.roundId)}`)).toBe(false);
    expect(f.rows.has(`${event.id}|${gameChangeKey(f.roundId, identifier(800))}`)).toBe(false);
  });
});
