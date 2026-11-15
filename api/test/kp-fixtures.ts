import { catalogFixture, identifier, manifest, tee } from './catalog-fixtures.js';
import { creator, event } from './fixtures.js';
import { TableScoreStore } from '../src/scoring/store.js';
import type { KpSelection } from '../../src/domain/kp.js';
import { kpContext } from '../../src/domain/kp.js';
import { TablePurseStore } from '../src/purse/store.js';

export async function kpStoreFixture(playerCount: 4 | 8 = 4, started = false) {
  const f = catalogFixture();
  f.seedEvent();
  const holes = tee.holes.map((hole, index) => index < 4
    ? { ...hole, par: 3, length: [183, 178, 175, 200][index] ?? 180 } : hole);
  const profile = { ...tee, holes, totalYardage: holes.reduce((sum, hole) => sum + hole.length, 0), totalPar: 68 };
  const version = await f.publish(identifier(100), manifest, [profile]);
  const players = await Promise.all(Array.from({ length: playerCount }, (_, index) => 200 + index).map((id) =>
    f.players.create(creator, identifier(id), `Fictional KP Golfer ${String(id)}`)));
  const roundId = identifier(500);
  const playerIds = players.map((player) => player.id);
  const input = {
    name: 'Fictional KP Event', location: 'Fictional location', playerIds,
    rounds: [{ id: roundId, name: 'Fictional KP Round', courseId: version.courseId, courseVersionId: version.id,
      teeProfileId: profile.id, groups: [{ number: 1, playerIds: playerIds.slice(0, 4) },
        ...(playerCount === 8 ? [{ number: 2, playerIds: playerIds.slice(4) }] : [])] }],
  };
  const empty = await f.workspace.get(creator, event.id);
  const saved = await f.workspace.save(creator, event.id, input, empty.etag);
  const scores = new TableScoreStore(f.table, f.workspace);
  const round = await scores.get(creator, event.id, roundId);
  if (started) await scores.write(creator, event.id, roundId, playerIds[0] ?? '', 1, { kind: 'strokes', strokes: 4 }, null, identifier(799));
  const selection: KpSelection = { version: 1, context: kpContext(round.layout, playerIds, round.kpCaptureIdentity), status: 'open', decisions: [] };
  const configured = await scores.saveKp(creator, event.id, roundId, selection, null, identifier(800));
  f.submit.mockClear();
  return { ...f, scores, saved, input, roundId, playerIds, playerId: playerIds[0] ?? '', selection, configured,
    actor: { kind: 'public-score' as const, eventId: event.id }, purse: new TablePurseStore(f.table, f.workspace, scores) };
}
