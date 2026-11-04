import type { EventSetupInput } from '../../src/domain/setup.js';
import { catalogFixture, identifier, tee } from './catalog-fixtures.js';
import { creator, event } from './fixtures.js';
import { TableScoreStore } from '../src/scoring/store.js';

export async function scoringFixture() {
  const f = catalogFixture();
  f.seedEvent();
  const version = await f.publish();
  const players = await Promise.all([200, 201, 202, 203].map((id) =>
    f.players.create(creator, identifier(id), `Fictional Golfer ${String(id)}`)));
  const playerIds = players.map((player) => player.id);
  const roundId = identifier(500);
  const playerId = identifier(200);
  const input: EventSetupInput = {
    name: 'Fictional Scoring Event', location: 'Fictional location', playerIds,
    rounds: [{
      id: roundId, name: 'Fictional Morning Round', courseId: version.courseId, courseVersionId: version.id,
      teeProfileId: tee.id, groups: [{ number: 1, playerIds }],
    }],
  };
  const empty = await f.workspace.get(creator, event.id);
  const saved = await f.workspace.save(creator, event.id, input, empty.etag);
  const scores = new TableScoreStore(f.table, f.workspace);
  f.submit.mockClear();
  const write = (expected: string | null = null, operation = 600, hole = 1) =>
    scores.write(creator, event.id, roundId, playerId, hole, { kind: 'strokes', strokes: 4 }, expected, identifier(operation));
  return { ...f, scores, saved, input, roundId, playerId, write };
}
