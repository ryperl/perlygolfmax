import { createHash } from 'node:crypto';
import { scoringFixture } from './scoring-fixtures.js';
import { identifier } from './catalog-fixtures.js';
import { creator, event, member } from './fixtures.js';
import { TableAdmissionStore } from '../src/admission/store.js';

export async function playerFixture() {
  const f = await scoringFixture();
  const additions = await Promise.all([204, 205, 206, 207].map((id) =>
    f.players.create(creator, identifier(id), `Fictional Player ${String(id)}`)));
  const ids = [...f.input.playerIds, ...additions.map((player) => player.id)];
  const input = { ...f.input, playerIds: ids, rounds: f.input.rounds.map((round) => ({
    ...round, groups: [{ number: 1, playerIds: ids.slice(0, 4) }, { number: 2, playerIds: ids.slice(4) }],
  })) };
  const saved = await f.workspace.save(creator, event.id, input, f.saved.etag);
  const store = new TableAdmissionStore(f.table);
  const inviteId = identifier(900);
  const token = 'A'.repeat(43);
  await store.invite(creator, event.id, {
    inviteId, playerId: identifier(204), tokenHash: createHash('sha256').update(token).digest('hex'),
  }, saved.etag, identifier(901));
  const pending = await store.claim(member, event.id, { inviteId, token }, identifier(902));
  const management = await store.list(creator, event.id);
  const invitation = management.invitations.find((entry) => entry.inviteId === inviteId);
  if (!invitation) throw new Error('Missing fictional invitation.');
  await store.approve(creator, event.id, {
    inviteId, revision: invitation.revision, verificationCode: pending.verificationCode,
  }, management.etag, identifier(903));
  f.submit.mockClear();
  return { ...f, input, saved, store, inviteId, token, boundPlayerId: identifier(204),
    peerId: identifier(205), foreignId: identifier(200) };
}
