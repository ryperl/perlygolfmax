import type { EventSetupInput } from '../../src/domain/setup.js';
import { catalogFixture, identifier, manifest, tee } from './catalog-fixtures.js';
import { creator, event } from './fixtures.js';
import { TableScoreStore } from '../src/scoring/store.js';

export async function teeFixture(count = 4) {
  const f = catalogFixture();
  f.seedEvent();
  const alternate = {
    ...tee, id: 102, name: 'Fictional Silver', totalYardage: 5400, totalMeters: 4938,
    ratings: tee.ratings.map((rating) => rating.type === 'Total' ? { ...rating, course: 74 } : rating),
    holes: tee.holes.map((hole) => ({
      ...hole, length: 300, par: hole.number === 1 ? 5 : hole.number === 2 ? 3 : hole.par,
      allocation: 19 - hole.number,
    })),
  };
  const nine = { ...tee, id: 103, name: 'Fictional Nine', holeCount: 9, totalYardage: 3150,
    totalMeters: 2880, totalPar: 36, holes: tee.holes.slice(0, 9),
    ratings: tee.ratings.map((rating) => ({ ...rating, course: 36, bogey: 47.5 })),
  };
  const importId = identifier(110);
  await f.courses.start(creator, importId, { ...manifest, teeProfileIds: [tee.id, alternate.id, nine.id] });
  for (const profile of [tee, alternate, nine]) await f.courses.putProfile(creator, importId, profile.id, profile);
  const version = await f.courses.publish(creator, importId, null);
  const players = await Promise.all(Array.from({ length: count }, (_, index) =>
    f.players.create(creator, identifier(200 + index), `Fictional Golfer ${String(index + 1)}`, {
      value: '0.0', effectiveDate: '2026-01-01', source: 'Fictional initial observation',
    })));
  const ids = players.map((player) => player.id);
  const roundId = identifier(500);
  const playerId = ids[0];
  if (!playerId) throw new Error('Missing fictional first golfer.');
  const input: EventSetupInput = {
    name: 'Fictional Mixed Tees', location: '', playerIds: ids, allowPerGolferTees: true,
    rounds: [{
      id: roundId, name: 'Fictional Opening Round', courseId: version.courseId, courseVersionId: version.id,
      teeProfileId: tee.id, playerTeeSelections: [{ playerId, teeProfileId: alternate.id }],
      groups: Array.from({ length: Math.ceil(count / 4) }, (_, index) => ({
        number: index + 1, playerIds: ids.slice(index * 4, index * 4 + 4),
      })),
    }],
  };
  const empty = await f.workspace.get(creator, event.id);
  const saved = await f.workspace.save(creator, event.id, input, empty.etag);
  f.submit.mockClear();
  return { ...f, input, saved, playerId, roundId, alternate, nine, version,
    scores: new TableScoreStore(f.table, f.workspace) };
}
