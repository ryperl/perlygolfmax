import { createHash } from 'node:crypto';
import { playerFixture } from '../../test/player-fixtures.js';
import { creator, event } from '../../test/fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { TableTesterAccessStore } from './store.js';

export async function testerFixture() {
  const f = await playerFixture();
  const testers = new TableTesterAccessStore(f.table);
  const linkId = identifier(3000);
  const token = Buffer.alloc(32, 19).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const management = await testers.list(creator, event.id);
  const created = await testers.create(creator, event.id, { linkId, tokenHash }, management.etag, identifier(3001));
  const header = `Tester ${linkId}.${token}`;
  const actor = await testers.verify(event.id, header);
  const row = (key: string) => {
    const saved = f.rows.get(`${event.id}|${key}`);
    if (!saved) throw new Error('Missing fictional tester row');
    return saved;
  };
  const revoke = async () => {
    const current = await testers.list(creator, event.id);
    const link = current.links.find((candidate) => candidate.linkId === linkId);
    if (!link) throw new Error('Missing fictional tester link');
    return testers.revoke(creator, event.id, { linkId, revision: link.revision }, current.etag, identifier(3002));
  };
  f.submit.mockClear();
  return { ...f, testers, linkId, token, tokenHash, header, actor, row, revoke, created };
}
