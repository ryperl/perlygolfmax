import { scoringFixture } from '../../test/scoring-fixtures.js';
import { creator, event } from '../../test/fixtures.js';
import { identifier } from '../../test/catalog-fixtures.js';
import { TablePurseStore } from '../purse/store.js';
import { TablePublicEventStore } from './store.js';

export async function publicFixture() {
  const f = await scoringFixture();
  const additions = await Promise.all([204, 205, 206, 207].map((id) =>
    f.players.create(creator, identifier(id), `Fictional Public Golfer ${String(id)}`)));
  const ids = [...f.input.playerIds, ...additions.map((player) => player.id)];
  const input = { ...f.input, playerIds: ids, rounds: f.input.rounds.map((round) => ({
    ...round, groups: [{ number: 1, playerIds: ids.slice(0, 4) }, { number: 2, playerIds: ids.slice(4) }],
  })) };
  await f.workspace.save(creator, event.id, input, f.saved.etag);
  const actor = { kind: 'public-score' as const, eventId: event.id };
  const row = (key: string) => {
    const saved = f.rows.get(`${event.id}|${key}`);
    if (!saved) throw new Error('Missing fictional public test row');
    return saved;
  };
  f.submit.mockClear();
  return { ...f, input, actor, row, peerId: identifier(205), foreignId: identifier(200),
    publicEvents: new TablePublicEventStore(f.table), purse: new TablePurseStore(f.table, f.workspace, f.scores) };
}
