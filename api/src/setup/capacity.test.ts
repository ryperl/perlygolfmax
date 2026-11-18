import { createHash } from 'node:crypto';
import type { TransactionAction } from '@azure/data-tables';
import { describe, expect, it } from 'vitest';
import type { EventSetupInput } from '../../../src/domain/setup.js';
import type { TeamGameDefinition } from '../../../src/domain/games.js';
import { stablefordPoints } from '../../../src/domain/stableford.js';
import { isEventWorkspace } from '../../../src/contracts/setup.js';
import { isRoundScores } from '../../../src/contracts/scoring.js';
import { privateWritePartBytes } from '../../../src/contracts/private-values.js';
import { catalogFixture, identifier, tee } from '../../test/catalog-fixtures.js';
import { creator, event, member } from '../../test/fixtures.js';
import { canonical } from '../catalog/entities.js';
import { privateContent } from '../private-values.js';
import { TableScoreStore } from '../scoring/store.js';
import { scoringLock } from '../scoring/lock.js';

async function fixture(count: number) {
  const f = catalogFixture();
  f.seedEvent();
  const version = await f.publish();
  const players = await Promise.all(Array.from({ length: count }, (_, index) =>
    f.players.create(creator, identifier(1000 + index), `Fictional golfer ${String(index)} ${'F'.repeat(60)}`,
      { value: '12.3', effectiveDate: '2026-01-01', source: `Fictional source ${'S'.repeat(150)}` })));
  const playerIds = players.map((player) => player.id);
  const input: EventSetupInput = {
    name: 'Fictional Large Event', startDate: '2026-11-06', location: 'Fictional location', playerIds,
    rounds: Array.from({ length: 2 }, (_, index) => ({
      id: identifier(500 + index), name: `Fictional Round ${String(index)}`,
      startDate: index === 0 ? '2026-11-08' : '2026-11-07',
      courseId: version.courseId, courseVersionId: version.id, teeProfileId: tee.id,
      groups: Array.from({ length: Math.ceil(count / 4) }, (_, group) => ({
        number: group === 0 ? Number.MAX_SAFE_INTEGER : group + 10, playerIds: playerIds.slice(group * 4, (group + 1) * 4),
        startingHole: group % 18 + 1,
      })),
    })),
  };
  const empty = await f.workspace.get(creator, event.id);
  f.submit.mockClear();
  return { ...f, input, empty, scores: new TableScoreStore(f.table, f.workspace) };
}

function envelopes(input: EventSetupInput) {
  const bytes = Buffer.from(JSON.stringify(input));
  const manifest = { id: identifier(9999), bytes: bytes.length, parts: Math.ceil(bytes.length / privateWritePartBytes),
    sha256: createHash('sha256').update(bytes).digest('hex') };
  return { manifest, parts: Array.from({ length: manifest.parts }, (_, index) => ({ privateUpload: {
    ...manifest, index, content: bytes.subarray(index * privateWritePartBytes, (index + 1) * privateWritePartBytes).toString('base64'),
  } })) };
}

function isPublication(actions: readonly TransactionAction[]): boolean {
  return actions.some(([operation, row]) => operation === 'update'
    && row.partitionKey === event.id && row.rowKey === 'event');
}

describe('large event capacity and atomic publication', () => {
  it.each([12, 40, 120])('saves/reloads %i captured golfers, manually numbered groups, full teams, scores and permanent locks', async (count) => {
    const f = await fixture(count);
    const saved = await f.workspace.save(creator, event.id, f.input, f.empty.etag);
    expect(isEventWorkspace(saved)).toBe(true);
    expect(saved.event.startDate).toBe('2026-11-06');
    expect(saved.rounds.map((round) => round.startDate)).toEqual(['2026-11-08', '2026-11-07']);
    expect(saved.roster).toHaveLength(count);
    expect(saved.rounds[0]?.groups.at(-1)?.number).toBe(9 + count / 4);
    expect(saved.rounds[0]?.groups).toEqual(f.input.rounds[0]?.groups);
    expect(await f.workspace.get(creator, event.id)).toEqual(saved);
    const round = saved.rounds[0];
    if (!round) throw new Error('Missing fictional round');
    const game: TeamGameDefinition = {
      id: identifier(600), name: 'Fictional Pairs', preset: 'standard', basis: 'net',
      handicapAllowancePercent: 100, points: stablefordPoints('standard'), format: 'two-net-better-ball',
      teams: Array.from({ length: count / 2 }, (_, index) => ({
        id: identifier(2000 + index), name: `Fictional Team ${String(index)} ${'T'.repeat(50)}`,
        playerIds: f.input.playerIds.slice(index * 2, (index + 1) * 2),
      })),
    };
    const configured = await f.scores.saveGames(creator, event.id, round.id, [game], null, identifier(700));
    expect(isRoundScores(configured.round)).toBe(true);
    expect(configured.round.games?.configuration.games).toEqual([game]);
    for (const [index, playerId] of f.input.playerIds.entries()) {
      await f.scores.write(creator, event.id, round.id, playerId, 1, { kind: 'picked-up', reportedStrokes: 7 }, null, identifier(3000 + index));
    }
    const scores = await f.scores.get(creator, event.id, round.id);
    expect(isRoundScores(scores)).toBe(true);
    expect(scores.cards).toHaveLength(count);
    expect(scores.groups).toEqual(round.groups);
    expect(scores.cards.every((card) => card.holes[0]?.score.kind === 'picked-up')).toBe(true);
    expect(scores.games?.results[0]?.teams).toHaveLength(count / 2);
    expect((await scoringLock(f.table, event.id, round.id))?.writtenPlayerIds).toEqual(f.input.playerIds);
    const first = scores.cards[0];
    if (!first?.etag) throw new Error('Missing fictional saved card');
    await f.scores.write(creator, event.id, round.id, first.playerId, 1, { kind: 'unplayed' }, first.etag, identifier(4000));
    expect((await f.workspace.get(creator, event.id)).rounds[0]?.scoringStarted).toBe(true);
    await expect(f.workspace.save(creator, event.id, { ...f.input, playerIds: f.input.playerIds.slice(4) }, (await f.workspace.get(creator, event.id)).etag))
      .rejects.toMatchObject({ status: 400 });
    expect(f.submit.mock.calls.every(([actions]) => actions.length <= 100)).toBe(true);
    expect([...f.rows.values()].every((row) => typeof row.content !== 'string' || Buffer.byteLength(row.content, 'utf16le') < 65536)).toBe(true);
    if (count === 120) {
      const refreshedRound = await privateContent(f.table, event.id, `round:${round.id}`, f.rows.get(`${event.id}|round:${round.id}`)?.content);
      expect(Buffer.byteLength(refreshedRound, 'utf16le')).toBeGreaterThan(65536);
    }
  });

  it('stages >12KiB setup, commits atomically, and replays the same publication after an uncertain successful commit', async () => {
    const f = await fixture(120);
    expect(Buffer.byteLength(JSON.stringify(f.input))).toBeGreaterThan(12288);
    const u = envelopes(f.input);
    for (const part of u.parts) {
      expect((await f.workspace.receive(creator, event.id, part, f.empty.etag)).kind).toBe('part');
      expect((await f.workspace.get(creator, event.id)).roster).toEqual([]);
    }
    const received = await f.workspace.receive(creator, event.id, { privateCommit: u.manifest }, f.empty.etag);
    if (received.kind !== 'value' || !received.publication) throw new Error('Missing fictional publication');
    const ownerRevision = f.rows.get(`${event.id}|member:${creator.objectId}`)?.etag;
    if (!ownerRevision) throw new Error('Missing fictional owner grant revision');
    const submit = f.submit.getMockImplementation();
    if (!submit) throw new Error('Missing fictional transaction');
    let responseLost = false;
    f.submit.mockImplementation((actions) => {
      if (!responseLost && isPublication(actions)) {
        responseLost = true;
        f.apply(actions);
        return Promise.reject(new Error('Fictional lost commit response'));
      }
      return submit(actions);
    });
    const saved = await f.workspace.save(creator, event.id, f.input, f.empty.etag, received.publication);
    expect(saved.roster).toHaveLength(120);
    expect(saved.rounds.map((round) => round.groups)).toEqual(f.input.rounds.map((round) => round.groups));
    expect(await f.workspace.save(creator, event.id, f.input, f.empty.etag, received.publication)).toEqual(saved);
    expect(responseLost).toBe(true);
    const publications = f.submit.mock.calls.filter(([actions]) => isPublication(actions));
    expect(publications).toHaveLength(1);
    expect(publications[0]?.[0]).toEqual(expect.arrayContaining([
      ['update', expect.objectContaining({ rowKey: 'event' }), 'Merge', { etag: f.empty.etag }],
      ['update', expect.objectContaining({ rowKey: `member:${creator.objectId}` }), 'Merge', { etag: ownerRevision }],
      ['upsert', expect.objectContaining({ rowKey: 'workspace' }), 'Replace'],
      ['create', expect.objectContaining({ rowKey: `setup-receipt:${received.publication.id}` })],
    ]));
    for (const round of f.input.rounds) {
      expect(publications[0]?.[0]).toContainEqual(['upsert', expect.objectContaining({ rowKey: `round:${round.id}` }), 'Replace']);
    }
    await expect(f.workspace.save(creator, event.id, { ...f.input, location: 'Fictional changed' }, f.empty.etag, received.publication))
      .rejects.toMatchObject({ code: 'PRIVATE_UPLOAD_CONFLICT' });
    const roundId = saved.rounds[0]?.id;
    if (!roundId) throw new Error('Missing fictional round');
    const refreshed = await f.workspace.refreshIndices(creator, event.id, roundId, identifier(8000), saved.etag);
    expect(refreshed.rounds[0]?.players).toEqual(saved.rounds[0]?.players);
    expect(refreshed.rounds[0]?.groups).toEqual(saved.rounds[0]?.groups);
    expect(await f.workspace.refreshIndices(creator, event.id, roundId, identifier(8000), saved.etag)).toEqual(refreshed);
    const audit = await privateContent(f.table, event.id, `index-refresh:${identifier(8000)}`, f.rows.get(`${event.id}|index-refresh:${identifier(8000)}`)?.content);
    expect(Buffer.byteLength(audit, 'utf16le')).toBeGreaterThan(65536);
  });

  it.each(['event', 'grant', 'fragment', 'commit'] as const)('leaves no active workspace or receipt after a %s failure and safely retries when valid', async (failure) => {
    const f = await fixture(120);
    const publication = { id: identifier(9900), sha256: createHash('sha256').update(JSON.stringify(f.input)).digest('hex') };
    const previous = new Map(f.rows);
    const submit = f.submit.getMockImplementation();
    if (!submit) throw new Error('Missing fictional transaction');
    let injected = false;
    f.submit.mockImplementation((actions) => {
      const target = failure === 'fragment'
        ? actions.some(([operation, row]) => operation === 'create' && row.kind === 'private-fragment')
        : isPublication(actions);
      if (injected || !target) return submit(actions);
      injected = true;
      if (failure === 'fragment' || failure === 'commit') return Promise.reject(new Error(`Fictional ${failure} failure`));
      const key = `${event.id}|${failure === 'event' ? 'event' : `member:${creator.objectId}`}`;
      const row = f.rows.get(key);
      if (!row) throw new Error('Missing fictional race row');
      f.seed({ ...row, ...(failure === 'grant' ? { role: 'member' } : { name: 'Fictional concurrent change' }) });
      try { f.apply(actions); } catch (error) { return Promise.reject(error instanceof Error ? error : new Error('Invalid fictional transaction')); }
      return Promise.reject(new Error('Unexpected successful conditional write'));
    });
    await expect(f.workspace.save(creator, event.id, f.input, f.empty.etag, publication)).rejects.toThrow();
    expect(injected).toBe(true);
    expect(f.rows.has(`${event.id}|workspace`)).toBe(false);
    expect(f.rows.has(`${event.id}|setup-receipt:${publication.id}`)).toBe(false);
    expect(f.rows.has(`${event.id}|round:${identifier(500)}`)).toBe(false);
    for (const [key, row] of previous) f.rows.set(key, row);
    expect((await f.workspace.save(creator, event.id, f.input, f.empty.etag, publication)).roster).toHaveLength(120);
    await expect(f.workspace.receive(member, event.id, envelopes(f.input).parts[0], f.empty.etag)).rejects.toMatchObject({ status: 404 });
    f.seed({ partitionKey: event.id, rowKey: 'event', ...event, status: 'archived' });
    await expect(f.workspace.receive(creator, event.id, envelopes(f.input).parts[0], f.empty.etag)).rejects.toMatchObject({ code: 'EVENT_ARCHIVED' });
  });

  it('publishes large game definitions and before/after receipts only in the final conditional transaction', async () => {
    const f = await fixture(120);
    const saved = await f.workspace.save(creator, event.id, f.input, f.empty.etag);
    const roundId = saved.rounds[0]?.id;
    if (!roundId) throw new Error('Missing fictional round');
    const games: readonly TeamGameDefinition[] = Array.from({ length: 16 }, (_, index) => ({
      id: identifier(600 + index), name: `Fictional Game ${String(index)}`, preset: 'standard', basis: 'net',
      handicapAllowancePercent: 100, points: stablefordPoints('standard'), format: 'four-two-net',
      teams: Array.from({ length: 30 }, (_, team) => ({ id: identifier(2000 + team), name: `Fictional Team ${String(team)} ${'T'.repeat(60)}`,
        playerIds: f.input.playerIds.slice(team * 4, (team + 1) * 4) })),
    }));
    expect(Buffer.byteLength(JSON.stringify({ games }))).toBeGreaterThan(12288);
    const submit = f.submit.getMockImplementation();
    if (!submit) throw new Error('Missing fictional transaction');
    let injected = false;
    f.submit.mockImplementation((actions) => {
      if (!injected && isPublication(actions)) {
        injected = true;
        expect(actions).toEqual(expect.arrayContaining([
          ['create', expect.objectContaining({ rowKey: `round-games:${roundId}` })],
          ['create', expect.objectContaining({ rowKey: `game-change:${roundId}:${identifier(9000)}` })],
        ]));
        return Promise.reject(new Error('Fictional game commit failure'));
      }
      return submit(actions);
    });
    await expect(f.scores.saveGames(creator, event.id, roundId, games, null, identifier(9000))).rejects.toThrow('Fictional game commit failure');
    expect(injected).toBe(true);
    expect(f.rows.has(`${event.id}|round-games:${roundId}`)).toBe(false);
    expect(f.rows.has(`${event.id}|game-change:${roundId}:${identifier(9000)}`)).toBe(false);
    const result = await f.scores.saveGames(creator, event.id, roundId, games, null, identifier(9000));
    expect(result.change.after).toEqual(games);
    expect((await f.scores.get(creator, event.id, roundId)).games?.configuration.games).toEqual(games);
    expect((await f.scores.saveGames(creator, event.id, roundId, games, null, identifier(9000))).change).toEqual(result.change);
    const etag = result.round.games?.configuration.etag;
    if (!etag) throw new Error('Missing fictional game revision');
    const updated = games.map((game) => ({ ...game, name: `${game.name} updated` }));
    const changed = await f.scores.saveGames(creator, event.id, roundId, updated, etag, identifier(9001));
    expect(changed.change.before).toEqual(games);
    const audit = await privateContent(f.table, event.id, `game-change:${roundId}:${identifier(9001)}`,
      f.rows.get(`${event.id}|game-change:${roundId}:${identifier(9001)}`)?.content);
    expect(Buffer.byteLength(audit, 'utf16le')).toBeGreaterThan(65536);
    expect(canonical(changed.change)).toBe(audit);
  });
});
