// @vitest-environment node
import { createHash } from 'node:crypto';
import { HttpRequest, InvocationContext } from '@azure/functions';
import { describe, expect, it, vi } from 'vitest';
import { scoringFixture } from '../../api/test/scoring-fixtures.js';
import { identifier } from '../../api/test/catalog-fixtures.js';
import { creator, event, member } from '../../api/test/fixtures.js';
import { TableAdmissionStore } from '../../api/src/admission/store.js';
import { createAdmissionHandler } from '../../api/src/admission/handlers.js';
import { TableEventStore } from '../../api/src/events/store.js';
import { createHandler } from '../../api/src/events/handlers.js';
import { createScoringHandler } from '../../api/src/scoring/handlers.js';
import { createCatalogHandler } from '../../api/src/catalog/handlers.js';
import { ApiError } from '../../api/src/errors.js';
import { createAdmissionsClient } from '../client/admission.js';
import { createScoresClient } from '../client/scoring.js';
import { createSetupClient } from '../client/setup.js';
import { createEventsClient } from '../client/events.js';

describe('player invitation to playing-group scoring contract', () => {
  it('approves explicit identity binding, discovers all active events, edits the assigned group and revokes safely', async () => {
    const f = await scoringFixture();
    const additions = await Promise.all([204, 205, 206, 207].map((id) =>
      f.players.create(creator, identifier(id), `Fictional golfer ${String(id)}`)));
    const ids = [...f.input.playerIds, ...additions.map((player) => player.id)];
    const current = await f.workspace.get(creator, event.id);
    await f.workspace.save(creator, event.id, { ...f.input, playerIds: ids, rounds: f.input.rounds.map((round) => ({
      ...round, groups: [{ number: 1, playerIds: ids.slice(0, 4) }, { number: 2, playerIds: ids.slice(4) }],
    })) }, current.etag);
    const otherEvent = identifier(1000);
    f.seed({ partitionKey: otherEvent, rowKey: 'event', name: 'Fictional other event', createdAt: '2026-01-01', status: 'active' });
    const admission = new TableAdmissionStore(f.table);
    const verify = vi.fn((authorization: string | null) => authorization === 'Bearer fictional-owner'
      ? Promise.resolve(creator) : authorization === 'Bearer fictional-player' ? Promise.resolve(member)
        : Promise.reject(new ApiError(401, 'INVALID_TOKEN')));
    const limiter = { check: vi.fn().mockResolvedValue(undefined) };
    const context = new InvocationContext({ invocationId: 'fictional-player-workflow', logHandler: () => undefined });
    const send = vi.fn<typeof fetch>().mockImplementation(async (target, options) => {
      const url = typeof target === 'string' ? target : target instanceof URL ? target.href : target.url;
      const parts = new URL(url).pathname.replace(/^\/api\//, '').split('/');
      const admissionAction = parts[3] ?? 'list';
      if (parts[2] === 'admissions' && admissionAction !== 'list' && admissionAction !== 'invite'
        && admissionAction !== 'claim' && admissionAction !== 'approve' && admissionAction !== 'revoke'
        && admissionAction !== 'status') throw new Error('Unexpected fictional invitation route.');
      const request = new HttpRequest({
        url, method: options?.method ?? 'GET',
        params: { id: parts[1] ?? '', roundId: parts[3] ?? '', playerId: parts[5] ?? '', holeNumber: parts[7] ?? '' },
        headers: Object.fromEntries(new Headers(options?.headers).entries()),
        ...(typeof options?.body === 'string' ? { body: { string: options.body } } : {}),
      });
      const result = parts[2] === 'admissions'
        ? await createAdmissionHandler(() => ({ verify, limiter, store: admission }),
          admissionAction === 'invite' || admissionAction === 'claim' || admissionAction === 'approve'
            || admissionAction === 'revoke' || admissionAction === 'status' ? admissionAction : 'list')(request, context)
        : parts[2] === 'rounds'
          ? await createScoringHandler(() => ({ verify, limiter, scores: f.scores }), parts[4] === 'scores' ? 'scores' : 'score-hole')(request, context)
          : parts[2] === 'workspace'
            ? await createCatalogHandler(() => ({ verify, limiter, workspace: f.workspace, courses: f.courses,
              players: f.players, canManageCatalog: (identity) => identity.objectId === creator.objectId }), 'workspace')(request, context)
            : await createHandler(() => ({ verify, limiter, store: new TableEventStore(f.table),
              canCreate: (identity) => identity.objectId === creator.objectId, canManageCatalog: () => false }), 'events')(request, context);
      return new Response(JSON.stringify(result.jsonBody), { status: result.status ?? 200 });
    });
    const base = 'https://fictional.example.test/api';
    const owner = createAdmissionsClient(base, () => Promise.resolve('fictional-owner'), send);
    const player = createAdmissionsClient(base, () => Promise.resolve('fictional-player'), send);
    const scores = createScoresClient(base, () => Promise.resolve('fictional-player'), send);
    const setup = createSetupClient(base, () => Promise.resolve('fictional-player'), send);
    const events = createEventsClient(base, () => Promise.resolve('fictional-player'), send);
    const signal = new AbortController().signal;
    const token = 'A'.repeat(43);
    const inviteId = identifier(900);
    const initial = await owner.list(event.id, signal);
    await owner.invite(event.id, { inviteId, playerId: identifier(204),
      tokenHash: createHash('sha256').update(token).digest('hex') }, initial.etag, identifier(901), signal);
    await expect(scores.load(event.id, f.roundId, signal)).rejects.toMatchObject({ status: 404 });
    const pending = await player.claim(event.id, { inviteId, token }, identifier(902), signal);
    expect(pending.state).toBe('pending');
    expect((await events.list(signal)).events).toEqual([]);
    const requested = await owner.list(event.id, signal);
    const invitation = requested.invitations.find((item) => item.inviteId === inviteId);
    if (!invitation) throw new Error('Missing fictional invitation.');
    await owner.approve(event.id, { inviteId, revision: invitation.revision, verificationCode: pending.verificationCode },
      requested.etag, identifier(903), signal);
    expect((await player.status(event.id, inviteId, signal)).state).toBe('approved');
    const visible = await events.list(signal);
    expect(visible.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: event.id, role: 'member' }), expect.objectContaining({ id: otherEvent, role: 'viewer' }),
    ]));
    const publicWorkspace = await setup.load(event.id, signal);
    expect(publicWorkspace.viewerPlayerId).toBe(identifier(204));
    expect(JSON.stringify(publicWorkspace)).not.toContain('handicapIndex');
    const cards = await scores.load(event.id, f.roundId, signal);
    expect(cards.permissions?.writePlayerIds).toEqual([204, 205, 206, 207].map(identifier));
    const saved = await scores.save(event.id, f.roundId, identifier(205), 1,
      { kind: 'strokes', strokes: 4 }, null, identifier(904), signal);
    expect(saved.change.recordedBy).toEqual(member);
    expect(f.rows.get(`${event.id}|member:${member.objectId}`)?.role).toBe('member');
    await expect(scores.save(event.id, f.roundId, identifier(200), 1,
      { kind: 'strokes', strokes: 4 }, null, identifier(905), signal)).rejects.toMatchObject({ status: 403 });
    const approved = await owner.list(event.id, signal);
    const active = approved.invitations.find((item) => item.inviteId === inviteId);
    if (!active) throw new Error('Missing fictional approved invitation.');
    await owner.revoke(event.id, { inviteId, revision: active.revision }, approved.etag, identifier(906), signal);
    await expect(scores.load(event.id, f.roundId, signal)).rejects.toMatchObject({ status: 404 });
    expect((await events.list(signal)).events).toEqual([]);
    expect(send.mock.calls.every(([target]) => !(typeof target === 'string' ? target
      : target instanceof URL ? target.href : target.url).includes(token))).toBe(true);
    expect(JSON.stringify([...f.rows.values()])).not.toContain(token);
  });
});
