import { TableClient } from '@azure/data-tables';
import { describe, expect, it, vi } from 'vitest';
import { identifier, memoryTable } from '../../test/catalog-fixtures.js';
import { creator, event, member } from '../../test/fixtures.js';
import { isRecord } from '../../../src/contracts/events.js';
import { TableEventAdministration } from './store.js';
import type { DeletionBudget } from './store.js';
import { TableEventStore } from '../events/store.js';
import { readEventAccess } from '../event-access.js';
import { readPublicAccess } from '../public-access/authority.js';
import { createEventOwnedEntity } from './writes.js';
import { TableCourseCatalog } from '../catalog/courses.js';
import { TablePlayerCatalog } from '../catalog/players.js';
import { TableWorkspaceStore } from '../setup/store.js';
import { TableScoreStore } from '../scoring/store.js';
import { TableQuickRoundStore } from '../quick-round/store.js';
import { publicFixture } from '../public-access/test-support.js';

// One cleanup step per request, to test resuming between steps and partial failures.
const oneStep: DeletionBudget = { maxSteps: 1, maxMilliseconds: Number.POSITIVE_INFINITY };

function fixture(budget?: DeletionBudget, now?: () => number) {
  const f = memoryTable();
  // Match the additional authoritative header/locator predicates used by administration.
  f.list.mockImplementation((options) => {
    const source = new TableClient('https://fictional.table.core.windows.net', 'Events').listEntities();
    vi.spyOn(source, 'byPage').mockImplementation(async function* (settings) {
      const filter = options?.queryOptions?.filter ?? '';
      const conditions = [...filter.matchAll(/(\w+) (eq|ge|lt) ('([^']*)'|true|false)/g)];
      const matches = [...f.rows.values()].filter((row) => conditions.every((condition) => {
        const key = condition[1] === 'PartitionKey' ? 'partitionKey' : condition[1] === 'RowKey' ? 'rowKey' : condition[1] ?? '';
        const expected = condition[3] === 'true' ? true : condition[3] === 'false' ? false : condition[4] ?? '';
        const value = row[key];
        return condition[2] === 'eq' ? value === expected : typeof value === 'string' && typeof expected === 'string'
          && (condition[2] === 'ge' ? value >= expected : value < expected);
      })).sort((a, b) => `${String(a.partitionKey)}|${String(a.rowKey)}`.localeCompare(`${String(b.partitionKey)}|${String(b.rowKey)}`));
      let start = 0;
      if (settings?.continuationToken) {
        const token: unknown = JSON.parse(Buffer.from(settings.continuationToken, 'base64').toString('utf8'));
        if (!isRecord(token)) throw new Error('Invalid fictional cursor');
        start = matches.findIndex((row) => row.partitionKey === token.nextPartitionKey && row.rowKey === token.nextRowKey);
        if (start < 0) start = matches.length;
      }
      const size = settings?.maxPageSize ?? 50;
      const next = matches[start + size];
      yield await Promise.resolve(Object.assign(matches.slice(start, start + size), next ? {
        continuationToken: Buffer.from(JSON.stringify({ nextPartitionKey: next.partitionKey, nextRowKey: next.rowKey })).toString('base64'),
      } : {}));
    });
    return source;
  });
  const saved = f.seed({ partitionKey: event.id, rowKey: 'event', ...event,
    status: 'archived', quickRound: true, quickRoundReady: true });
  const store = new TableEventAdministration(f.table,
    (identity) => identity.objectId === creator.objectId && identity.tenantId === creator.tenantId, budget, now);
  return { ...f, saved, store };
}
const requestId = identifier(940);

async function finish(f: ReturnType<typeof fixture>) {
  for (let step = 0; step < 30; step++) {
    const result = await f.store.continueDeletion(creator, event.id, requestId);
    if (result.state === 'deleted') return result;
  }
  throw new Error('Fictional deletion did not finish in its bounded test.');
}

describe('Organizer Quick round lifecycle persistence', () => {
  it('finds ready ownerless legacy Quick rounds with bounded filtered pages and status-bound cursors', async () => {
    const f = fixture();
    f.seed({ partitionKey: identifier(941), rowKey: 'event', ...event, status: 'archived', quickRound: true });
    f.seed({ partitionKey: identifier(942), rowKey: 'event', ...event, status: 'active', quickRound: true, quickRoundReady: true });
    f.seed({ partitionKey: identifier(943), rowKey: 'event', ...event, status: 'archived' });
    for (let index = 0; index < 51; index++) f.seed({ partitionKey: identifier(1000 + index), rowKey: 'event',
      ...event, status: 'archived', quickRound: true, quickRoundReady: true });
    const first = await f.store.listQuick(creator, 'archived');
    expect(first.events).toHaveLength(50);
    expect(first.events[0]).toEqual({ id: event.id, name: event.name, status: 'archived', etag: f.saved.etag });
    expect(first.continuationToken).toBeDefined();
    expect(f.list).toHaveBeenCalledWith({ queryOptions: { filter: "RowKey eq 'event' and quickRound eq true and quickRoundReady eq true and status eq 'archived'" } });
    await expect(f.store.listQuick(creator, 'active', first.continuationToken)).rejects.toMatchObject({ code: 'INVALID_PAGE_CURSOR' });
    await expect(f.store.listQuick(creator, 'archived', 'garbage')).rejects.toMatchObject({ status: 400 });
    expect((await f.store.listQuick(creator, 'archived', first.continuationToken)).events).toHaveLength(2);
    await expect(f.store.listQuick(member, 'archived')).rejects.toMatchObject({ status: 403 });
    await expect(readPublicAccess(f.table, { kind: 'public-score', eventId: event.id }, event.id)).rejects.toMatchObject({ status: 404 });
  });

  it('restores only stored ready Quick policies, preserves business data and audits the actual organizer with immutable retries', async () => {
    const f = fixture();
    f.seed({ partitionKey: event.id, rowKey: 'score:fictional', content: 'Fictional saved scores' });
    const before = f.rows.get(`${event.id}|score:fictional`);
    await expect(f.store.restore(member, event.id, f.saved.etag, requestId)).rejects.toMatchObject({ status: 403 });
    await expect(f.store.restore(creator, event.id, 'stale', requestId)).rejects.toMatchObject({ code: 'EVENT_CHANGED' });
    const result = await f.store.restore(creator, event.id, f.saved.etag, requestId);
    expect(result).toEqual({ eventId: event.id, requestId, status: 'active' });
    expect(f.rows.get(`${event.id}|score:fictional`)).toEqual(before);
    expect(f.rows.get(`${event.id}|quick-restore:${requestId}`)?.content).toContain(creator.objectId);
    expect(await f.store.restore(creator, event.id, f.saved.etag, requestId)).toEqual(result);
    await expect(f.store.restore(creator, event.id, 'altered', requestId)).rejects.toMatchObject({ code: 'RESTORE_REQUEST_CONFLICT' });
    f.seed({ ...f.saved, quickRound: false });
    await expect(f.store.restore(creator, event.id, f.saved.etag, identifier(955))).rejects.toMatchObject({ status: 404 });
  });

  it('preserves actual saved Quick scorecards, whole-round captures, setup locks and receipts through organizer recovery', async () => {
    const f = await publicFixture();
    const quick = new TableQuickRoundStore(f.table, f.workspace);
    const id = identifier(970);
    const actor = { kind: 'public-score', eventId: id } as const;
    await quick.create(id, f.input);
    await f.scores.write(actor, id, f.roundId, f.playerId, 1, { kind: 'strokes', strokes: 4 }, null, identifier(971));
    const current = f.rows.get(`${id}|event`);
    if (!current) throw new Error('Missing fictional Quick round');
    await quick.archive(id, current.etag, identifier(972));
    const archived = f.rows.get(`${id}|event`);
    if (!archived) throw new Error('Missing fictional archived Quick round');
    const before = [...f.rows.entries()].filter(([, row]) => row.partitionKey === id && row.rowKey !== 'event');
    expect(before.some(([, row]) => typeof row.rowKey === 'string' && row.rowKey.startsWith('score-lock:'))).toBe(true);
    const administration = new TableEventAdministration(f.table, () => true);
    await administration.restore(creator, id, archived.etag, identifier(973));
    for (const [key, row] of before) expect(f.rows.get(key)).toEqual(row);
    expect((await f.scores.get(actor, id, f.roundId)).cards.find((card) => card.playerId === f.playerId)?.holes[0]?.score)
      .toEqual({ kind: 'strokes', strokes: 4 });
    expect(f.rows.has(`${id}|member:${creator.objectId}`)).toBe(false);
  });

  it('requires organizer plus ordinary ownership, archived status, exact revision and exact name before claiming', async () => {
    const f = fixture();
    await expect(f.store.deleteArchived(member, event.id, f.saved.etag, event.name, requestId)).rejects.toMatchObject({ status: 403 });
    await expect(f.store.deleteArchived(creator, event.id, 'stale', event.name, requestId)).rejects.toMatchObject({ code: 'EVENT_CHANGED' });
    await expect(f.store.deleteArchived(creator, event.id, f.saved.etag, event.name.toLowerCase(), requestId)).rejects.toMatchObject({ status: 400 });
    const active = f.seed({ ...f.saved, status: 'active' });
    await expect(f.store.deleteArchived(creator, event.id, active.etag, event.name, requestId)).rejects.toMatchObject({ code: 'ARCHIVE_BEFORE_DELETION' });
    const ordinary = f.seed({ ...f.saved, quickRound: false });
    await expect(f.store.deleteArchived(creator, event.id, ordinary.etag, event.name, requestId)).rejects.toMatchObject({ status: 404 });
    const owner = f.seed({ partitionKey: event.id, rowKey: `member:${creator.objectId}`, ...creator, role: 'owner' });
    await f.store.deleteArchived(creator, event.id, ordinary.etag, event.name, requestId);
    expect(f.submit).toHaveBeenCalledWith(expect.arrayContaining([
      ['update', expect.objectContaining({ rowKey: `member:${creator.objectId}` }), 'Merge', { etag: owner.etag }],
      ['update', expect.objectContaining({ rowKey: 'event', status: 'deleting' }), 'Replace', { etag: ordinary.etag }],
    ]));
  });

  it('purges every event row and admitted locator without touching shared catalogs, quotas or unrelated events; keeps only technical fences', async () => {
    const f = fixture(oneStep);
    const unrelated = identifier(960);
    for (let index = 0; index < 107; index++) f.seed({ partitionKey: event.id, rowKey: `business:${String(index).padStart(3, '0')}`,
      content: 'Fictional score/capture/setup/purse/private fragment/invitation/audit data' });
    f.seed({ partitionKey: event.id, rowKey: `admission:${requestId}`, inviteId: requestId,
      claimTenantId: member.tenantId, claimObjectId: member.objectId, state: 'approved' });
    const locatorPartition = `admitted:${member.tenantId}:${member.objectId}`;
    f.seed({ partitionKey: locatorPartition, rowKey: `${event.id}:${requestId}`, eventId: event.id,
      admissionId: requestId, displayName: 'Fictional private profile' });
    const preserve = [
      f.seed({ partitionKey: 'catalog:players', rowKey: 'player:fictional', content: 'Fictional shared player' }),
      f.seed({ partitionKey: 'catalog:course:fictional', rowKey: 'version:fictional', content: 'Fictional shared course' }),
      f.seed({ partitionKey: 'quota:public-browse', rowKey: 'events-manage', count: 3 }),
      f.seed({ partitionKey: unrelated, rowKey: 'event', name: 'Fictional unrelated event' }),
      f.seed({ partitionKey: locatorPartition, rowKey: `${unrelated}:${requestId}`, eventId: unrelated }),
    ];
    expect((await f.store.deleteArchived(creator, event.id, f.saved.etag, event.name, requestId)).state).toBe('deleting');
    const pending = await f.store.listDeletions(creator);
    expect(pending.deletions).toEqual([{ eventId: event.id, requestId, state: 'deleting' }]);
    expect(await finish(f)).toEqual({ eventId: event.id, requestId, state: 'deleted',
      progress: { stage: 'finished', removed: 108 } });
    const retained = [...f.rows.values()].filter((row) => row.partitionKey === event.id);
    expect(retained.map((row) => row.rowKey).sort()).toEqual(['event', 'event-write-fence']);
    expect(JSON.stringify(retained)).not.toContain(event.name);
    expect(JSON.stringify(retained)).not.toContain(creator.objectId);
    expect(f.rows.get(`${locatorPartition}|${event.id}:${requestId}`)).toMatchObject({ kind: 'deleted-event-locator' });
    expect(f.rows.get(`${locatorPartition}|${event.id}:${requestId}`)).not.toHaveProperty('eventId');
    await expect(f.table.createEntity({ partitionKey: locatorPartition, rowKey: `${event.id}:${requestId}`,
      eventId: event.id, admissionId: requestId, ...member })).rejects.toMatchObject({ statusCode: 409 });
    for (const row of preserve) expect(f.rows.get(`${String(row.partitionKey)}|${String(row.rowKey)}`)).toEqual(row);
    expect((await f.store.listDeletions(creator)).deletions).toEqual([]);
    await expect(f.store.deleteArchived(creator, event.id, 'altered', event.name, requestId)).rejects.toMatchObject({ code: 'DELETE_REQUEST_CONFLICT' });
    expect((await f.store.deleteArchived(creator, event.id, f.saved.etag, event.name, requestId)).state).toBe('deleted');
  });

  it('fails closed on partial cleanup, resumes after failure and rejects create/status/restore/read and delayed staged resurrection', async () => {
    const f = fixture(oneStep);
    f.seed({ partitionKey: event.id, rowKey: 'workspace', content: 'Fictional setup' });
    await f.store.deleteArchived(creator, event.id, f.saved.etag, event.name, requestId);
    await f.store.continueDeletion(creator, event.id, requestId);
    f.submit.mockRejectedValueOnce(new Error('Fictional storage outage'));
    await expect(f.store.continueDeletion(creator, event.id, requestId)).rejects.toThrow('Fictional storage outage');
    expect(f.rows.has(`${event.id}|workspace`)).toBe(true);
    f.seed({ partitionKey: event.id, rowKey: `member:${creator.objectId}`, ...creator, role: 'owner' });
    await expect(new TableEventStore(f.table).setStatus(creator, event.id, 'active', f.saved.etag)).rejects.toMatchObject({ status: 404 });
    await expect(readEventAccess(f.table, creator, event.id)).rejects.toMatchObject({ status: 404 });
    await expect(f.store.restore(creator, event.id, f.saved.etag, identifier(961))).rejects.toMatchObject({ status: 404 });
    await expect(createEventOwnedEntity(f.table, event.id, { partitionKey: event.id, rowKey: 'private-fragment:late', content: 'Fictional data' }))
      .rejects.toMatchObject({ code: 'EVENT_DELETION_IN_PROGRESS' });
    await finish(f);
    await expect(new TableEventStore(f.table).create(creator, event)).rejects.toMatchObject({ status: 404 });
    await expect(f.table.createEntity({ partitionKey: event.id, rowKey: 'event', quickRound: true })).rejects.toMatchObject({ statusCode: 409 });
    await expect(createEventOwnedEntity(f.table, event.id, { partitionKey: event.id, rowKey: 'private-upload:late', content: 'Fictional data' }))
      .rejects.toMatchObject({ code: 'EVENT_DELETION_IN_PROGRESS' });
    await expect(readPublicAccess(f.table, { kind: 'public-score', eventId: event.id }, event.id)).rejects.toMatchObject({ status: 404 });
    const workspace = new TableWorkspaceStore(f.table, new TableCourseCatalog(f.table, () => true),
      new TablePlayerCatalog(f.table, () => true), () => true);
    const actor = { kind: 'public-score', eventId: event.id } as const;
    await expect(workspace.save(actor, event.id, { name: event.name, location: '', playerIds: [], rounds: [] },
      f.saved.etag, { id: requestId, sha256: 'a'.repeat(64) })).rejects.toMatchObject({ status: 404 });
    await expect(new TableScoreStore(f.table, workspace).write(actor, event.id, identifier(962), identifier(963), 1,
      { kind: 'strokes', strokes: 4 }, null, requestId)).rejects.toMatchObject({ status: 404 });
    await expect(new TableQuickRoundStore(f.table, workspace).receive(event.id, null, requestId, {})).rejects.toMatchObject({ status: 404 });
  });

  it('atomically refuses a changed owner grant or a staging fence race before deletion claim', async () => {
    const f = fixture();
    f.seed({ ...f.saved, quickRound: false });
    const current = f.rows.get(`${event.id}|event`);
    f.seed({ partitionKey: event.id, rowKey: `member:${creator.objectId}`, ...creator, role: 'owner' });
    const submit = f.submit.getMockImplementation();
    if (!submit) throw new Error('Missing fictional transaction');
    f.submit.mockImplementationOnce((actions) => {
      f.seed({ partitionKey: event.id, rowKey: `member:${creator.objectId}`, ...creator, role: 'owner', revoked: true });
      return submit(actions);
    });
    await expect(f.store.deleteArchived(creator, event.id, current?.etag ?? '', event.name, requestId)).rejects.toMatchObject({ code: 'EVENT_CHANGED' });
    expect(f.rows.get(`${event.id}|event`)?.status).toBe('archived');
    expect(f.rows.has(`${event.id}|event-write-fence`)).toBe(false);
  });

  it('fences staging atomically without changing the business event revision', async () => {
    const f = fixture();
    await createEventOwnedEntity(f.table, event.id, { partitionKey: event.id, rowKey: 'private-upload:fictional', content: 'Fictional data' });
    expect(f.rows.get(`${event.id}|event`)?.etag).toBe(f.saved.etag);
    const submit = f.submit.getMockImplementation();
    if (!submit) throw new Error('Missing fictional transaction');
    f.submit.mockImplementationOnce((actions) => {
      f.seed({ partitionKey: event.id, rowKey: 'event-write-fence', state: 'blocked' });
      return submit(actions);
    });
    await expect(createEventOwnedEntity(f.table, event.id, { partitionKey: event.id, rowKey: 'private-upload:late', content: 'Fictional late data' }))
      .rejects.toMatchObject({ code: 'EVENT_DELETION_IN_PROGRESS' });
    expect(f.rows.has(`${event.id}|private-upload:late`)).toBe(false);
  });

  it('resumes the exact delete request after the atomic claim commits but its response is lost', async () => {
    const f = fixture(oneStep);
    f.seed({ partitionKey: event.id, rowKey: 'score:fictional', content: 'Fictional saved score' });
    f.submit.mockImplementationOnce((actions) => {
      f.apply(actions);
      return Promise.reject(new Error('Fictional lost deletion claim response'));
    });
    await expect(f.store.deleteArchived(creator, event.id, f.saved.etag, event.name, requestId))
      .rejects.toThrow('Fictional lost deletion claim response');
    expect(f.rows.get(`${event.id}|event`)?.status).toBe('deleting');
    await expect(f.store.deleteArchived(creator, event.id, f.saved.etag, `${event.name} changed`, requestId))
      .rejects.toMatchObject({ code: 'DELETE_REQUEST_CONFLICT' });
    expect((await f.store.deleteArchived(creator, event.id, f.saved.etag, event.name, requestId)).state).toBe('deleting');
    expect((await finish(f)).state).toBe('deleted');
  });
  it('finishes a typical event in one request with exact progress, keeping every safeguard of the step-by-step path', async () => {
    const f = fixture();
    for (let index = 0; index < 230; index++) f.seed({ partitionKey: event.id, rowKey: `business:${String(index).padStart(3, '0')}`,
      content: 'Fictional score/capture/setup data' });
    const shared = f.seed({ partitionKey: 'catalog:players', rowKey: 'player:fictional', content: 'Fictional shared player' });
    const result = await f.store.deleteArchived(creator, event.id, f.saved.etag, event.name, requestId);
    expect(result).toEqual({ eventId: event.id, requestId, state: 'deleted', progress: { stage: 'finished', removed: 230 } });
    const retained = [...f.rows.values()].filter((row) => row.partitionKey === event.id);
    expect(retained.map((row) => row.rowKey).sort()).toEqual(['event', 'event-write-fence']);
    expect(f.rows.get('catalog:players|player:fictional')).toEqual(shared);
    // Repeating the finished request is idempotent and reports the same totals.
    expect(await f.store.continueDeletion(creator, event.id, requestId)).toEqual(result);
  });

  it('stops at its step or time budget with saved progress, and the next request continues from there', async () => {
    let clock = 0;
    const f = fixture({ maxSteps: 40, maxMilliseconds: 1_000 }, () => clock);
    for (let index = 0; index < 120; index++) f.seed({ partitionKey: event.id, rowKey: `business:${String(index).padStart(3, '0')}`,
      content: 'Fictional data' });
    const submit = f.submit.getMockImplementation();
    if (!submit) throw new Error('The fictional table must record transactions.');
    // Each storage transaction "takes" 400 ms, so the 1 s budget runs out mid-cleanup.
    f.submit.mockImplementation((actions) => { clock += 400; return submit(actions); });
    const first = await f.store.deleteArchived(creator, event.id, f.saved.etag, event.name, requestId);
    expect(first.state).toBe('deleting');
    expect(first.progress?.stage).toMatch(/links|records/);
    const second = await f.store.continueDeletion(creator, event.id, requestId);
    expect(second.progress?.removed ?? 0).toBeGreaterThanOrEqual(first.progress?.removed ?? 0);
    expect((await finish(f)).progress).toEqual({ stage: 'finished', removed: 120 });
  });

  it('caps the number of steps in one request even when every step is fast', async () => {
    const f = fixture({ maxSteps: 2, maxMilliseconds: Number.POSITIVE_INFINITY });
    for (let index = 0; index < 150; index++) f.seed({ partitionKey: event.id, rowKey: `business:${String(index).padStart(3, '0')}`,
      content: 'Fictional data' });
    const submitted = f.submit.mock.calls.length;
    const result = await f.store.deleteArchived(creator, event.id, f.saved.etag, event.name, requestId);
    // Claim transaction plus at most two cleanup steps.
    expect(f.submit.mock.calls.length - submitted).toBeLessThanOrEqual(3);
    expect(result.state).toBe('deleting');
  });
});
