import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { kpStoreFixture } from '../../test/kp-fixtures.js';
import { creator, event, member } from '../../test/fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { TableAdmissionStore } from '../admission/store.js';
import { TableTesterAccessStore } from '../test-access/store.js';
import { isRoundScores, isScoreWriteResult } from '../../../src/contracts/scoring.js';
import { calculateKp } from '../../../src/domain/kp.js';

describe('KP preserves public, legacy player and tester score-write authority', () => {
  it('allows only the approved legacy player group, preserves real grants, and gives a tester event-scoped entries without purse metadata', async () => {
    const f = await kpStoreFixture(8);
    const admission = new TableAdmissionStore(f.table);
    const inviteId = identifier(3000);
    const token = 'A'.repeat(43);
    const current = await f.workspace.get(creator, event.id);
    await admission.invite(creator, event.id, { inviteId, playerId: identifier(204),
      tokenHash: createHash('sha256').update(token).digest('hex') }, current.etag, identifier(3001));
    const claimed = await admission.claim(member, event.id, { inviteId, token }, identifier(3002));
    const management = await admission.list(creator, event.id);
    const invitation = management.invitations.find((entry) => entry.inviteId === inviteId);
    if (!invitation) throw new Error('Missing fixture');
    await admission.approve(creator, event.id, { inviteId, revision: invitation.revision, verificationCode: claimed.verificationCode },
      management.etag, identifier(3003));
    const saved = await f.scores.write(member, event.id, f.roundId, identifier(205), 1,
      { kind: 'unplayed', kp: { kind: 'no-measurement' } }, null, identifier(3004));
    expect(isScoreWriteResult(saved)).toBe(true);
    expect(saved.change.recordedBy).toEqual(member);
    expect(saved.round.permissions?.writePlayerIds).toEqual([204, 205, 206, 207].map(identifier));
    expect(f.rows.get(`${event.id}|member:${member.objectId}`)).toMatchObject({ role: 'member', playerId: identifier(204) });
    await expect(f.scores.write(member, event.id, f.roundId, f.playerId, 1,
      { kind: 'unplayed', kp: { kind: 'no-measurement' } }, null, identifier(3005))).rejects.toMatchObject({ status: 403 });
    await expect(f.scores.saveKp(member, event.id, f.roundId, { ...f.selection, status: 'closed' },
      f.configured.round.kp?.etag ?? null, identifier(3006))).rejects.toMatchObject({ status: 403 });
    const testers = new TableTesterAccessStore(f.table);
    const links = await testers.list(creator, event.id);
    const secret = Buffer.alloc(32, 19).toString('base64url');
    const linkId = identifier(3100);
    await testers.create(creator, event.id, { linkId, tokenHash: createHash('sha256').update(secret).digest('hex') }, links.etag, identifier(3101));
    const actor = await testers.verify(event.id, `Tester ${linkId}.${secret}`);
    const written = await f.scores.write(actor, event.id, f.roundId, f.playerId, 1,
      { kind: 'unplayed', kp: { kind: 'measured', inches: 13, onGreen: true, measurementId: identifier(3102) } }, null, identifier(3103));
    expect(isRoundScores(written.round)).toBe(true);
    expect(written.round.kpPot).toBeUndefined();
    expect(written.change.recordedBy).toEqual(actor);
    expect(written.round.permissions?.role).toBe('tester');
    expect(JSON.stringify(written.round)).not.toContain('recordedBy');
    expect(JSON.stringify(written.round)).not.toContain('handicapIndex');
    const second = await f.scores.write(f.actor, event.id, f.roundId, identifier(205), 1,
      { kind: 'unplayed', kp: { kind: 'measured', inches: 13, onGreen: true, measurementId: identifier(3104) } },
      saved.round.cards.find((card) => card.playerId === identifier(205))?.etag ?? null, identifier(3105));
    await f.purse.save(creator, event.id, { eventId: event.id, currency: 'USD', funding: { kind: 'fixed', budgetMinor: 10001 },
      pools: [{ id: identifier(3106), name: 'Fictional KP pot', source: { kind: 'kp', roundId: f.roundId }, amountMinor: 10001, awardUnit: 'pot' }],
    }, [], null, identifier(3107), () => Promise.resolve());
    const closed = await f.scores.saveKp(creator, event.id, f.roundId, { ...f.selection, status: 'closed' },
      second.round.kp?.etag ?? null, identifier(3108));
    const hole = calculateKp(closed.round).holes[0];
    if (!hole) throw new Error('Missing fixture');
    await f.scores.saveKp(creator, event.id, f.roundId, { ...f.selection, status: 'closed', decisions: [{
      holeNumber: 1, proof: hole.proof, kind: 'winner', playerIds: [f.playerId], holeAmountMinor: 10001, extraCentPlayerIds: [],
    }] }, closed.round.kp?.etag ?? null, identifier(3109));
    const tester = await f.scores.get(actor, event.id, f.roundId);
    expect(tester.kp?.decisions).toEqual([]);
    expect(tester.kpPot).toBeUndefined();
    expect(JSON.stringify(tester)).not.toContain('amountMinor');
    expect(JSON.stringify(tester)).not.toContain('holeAmountMinor');
  });
});
