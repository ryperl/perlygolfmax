import { createHash } from 'node:crypto';
import { memoryTable, identifier } from '../../test/catalog-fixtures.js';
import { creator, event, member } from '../../test/fixtures.js';
import { TableAdmissionStore } from './store.js';

export function admissionFixture() {
  const f = memoryTable();
  let instant = new Date('2026-01-02T00:00:00Z');
  const store = new TableAdmissionStore(f.table, () => instant);
  const playerId = identifier(200);
  const inviteId = identifier(300);
  const token = Buffer.alloc(32, 7).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  f.seed({ partitionKey: event.id, rowKey: 'event', ...event, status: 'active' });
  f.seed({ partitionKey: event.id, rowKey: `member:${creator.objectId}`, ...creator, role: 'owner' });
  f.seed({ partitionKey: event.id, rowKey: 'workspace', content: JSON.stringify({
    roster: [200, 201, 202, 203].map((id) => ({ playerId: identifier(id), displayName: `Fictional Golfer ${String(id)}` })),
  }) });
  function row(key: string, partition = event.id) {
    const saved = f.rows.get(`${partition}|${key}`);
    if (!saved) throw new Error('Missing fictional test entity');
    return saved;
  }
  const etag = () => row('event').etag;
  async function invite() {
    return store.invite(creator, event.id, { inviteId, playerId, tokenHash }, etag(), identifier(400));
  }
  async function claim() {
    return store.claim(member, event.id, { inviteId, token }, identifier(401));
  }
  async function approve() {
    const pending = row(`admission:${inviteId}`);
    if (typeof pending.revision !== 'string' || typeof pending.verificationCode !== 'string') throw new Error('Missing fictional pending claim');
    return store.approve(creator, event.id, { inviteId, revision: pending.revision, verificationCode: pending.verificationCode }, etag(), identifier(402));
  }
  async function admit() { await invite(); await claim(); await approve(); }
  return { ...f, store, row, etag, playerId, inviteId, token, tokenHash, invite, claim, approve, admit,
    setTime: (value: string) => { instant = new Date(value); } };
}
