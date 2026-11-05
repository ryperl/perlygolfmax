import { createRoot } from 'react-dom/client';
import type { CatalogClient } from '../../src/client/catalog';
import type { SetupClient } from '../../src/client/setup';
import type { ScoresClient } from '../../src/client/scoring';
import type { CourseVersion, PlayerProfile, TeeProfile } from '../../src/domain/catalog';
import type { EventWorkspace } from '../../src/domain/setup';
import { EventWorkspaceView } from '../../src/features/setup';
import '../../src/app/styles.css';
import { fictionalGamesRound } from './games-fixture-data';

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const players: readonly PlayerProfile[] = Array.from({ length: 5 }, (_, i) => ({
  id: id(i + 1), displayName: i === 3 ? 'Fictional Player with a long display name for narrow screens' : `Fictional Player ${String(i + 1)}`,
  currentIndex: null, etag: 'fixture-player-v1', createdAt: '2026-01-01T00:00:00Z',
}));
const tee: TeeProfile = {
  id: 901, name: 'Fictional Teal', category: 'Fictional rating', holeCount: 18,
  totalYardage: 6300, totalMeters: 5760, totalPar: 72, strokeAllocation: true, shorter: false, eligibleSides: 'All',
  holes: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, sourceId: i + 1, length: 350, par: 4, allocation: i + 1 })),
  ratings: [{ type: 'Total', course: 72, slope: 120, bogey: 90 }],
};
const version: CourseVersion = {
  id: 'a'.repeat(64), courseId: 'ghin:902:903',
  importedAt: '2026-01-01T00:00:00Z', provenance: { source: 'Fictional browser fixture', exportedAt: null },
  data: {
    provider: 'usga-ghin', sourceId: 903, name: 'Fictional Meadows', status: 'Active', number: 'fictional',
    city: 'Fictional City', state: 'Fictional State',
    facility: { id: 902, name: 'Fictional Club', status: 'Active', number: 'fictional', golfAssociationId: 904, address: 'Fictional address', longitude: 0, latitude: 0 },
    season: { name: 'All year', start: '01/01', end: '12/31', allYear: true }, teeProfiles: [tee],
  },
};
const { teeProfiles: profiles, ...course } = version.data;
let workspace: EventWorkspace = {
  event: { id: id(50), name: 'Fictional browser event', role: 'owner', status: 'active', etag: 'fixture-v1', createdAt: '2026-01-01T00:00:00Z' },
  etag: 'fixture-v1', location: 'Fictional County',
  roster: players.slice(0, 4).map((player) => ({ playerId: player.id, displayName: player.displayName })),
  rounds: [1, 2].map((number) => ({
    id: id(70 + number), name: `Fictional round ${String(number)}`, courseId: version.courseId, courseVersionId: version.id,
    course, teeProfile: tee, groups: [{ number: 1, playerIds: players.slice(0, 4).map((player) => player.id) }],
    players: players.slice(0, 4).map((player) => ({ playerId: player.id, displayName: player.displayName, handicapIndex: null })),
  })),
};
const unavailable = () => Promise.reject(new Error('This fictional browser fixture does not implement that operation.'));
const catalog: CatalogClient = {
  courses: () => Promise.resolve({ courses: [{ id: version.courseId, name: course.name, location: course.city, currentVersionId: version.id, etag: 'fixture-course-v1' }] }),
  players: () => Promise.resolve({ players }), version: () => Promise.resolve(version),
  beginImport: unavailable, importStatus: unavailable, uploadProfile: unavailable, publish: unavailable,
  createPlayer: unavailable, renamePlayer: unavailable, history: unavailable, recordIndex: unavailable,
};
let revision = 1;
const setup: SetupClient = {
  load: () => Promise.resolve(workspace),
  save: (_eventId, _etag, input) => {
    revision += 1;
    const etag = `fixture-v${String(revision)}`;
    const { overallCompetition: previousCompetition, ...previous } = workspace;
    const competition = input.overallCompetition === undefined ? previousCompetition : input.overallCompetition;
    workspace = {
      ...previous, ...(competition == null ? {} : { overallCompetition: competition }),
      etag, event: { ...workspace.event, etag, name: input.name }, location: input.location,
      roster: input.playerIds.map((playerId) => {
        const player = players.find((item) => item.id === playerId);
        if (!player) throw new Error('Unknown fictional player.');
        return { playerId, displayName: player.displayName };
      }),
      rounds: input.rounds.map((round) => {
        const teeProfile = profiles.find((profile) => profile.id === round.teeProfileId);
        if (!teeProfile) throw new Error('Unknown fictional tee.');
        return { ...round, course, teeProfile, players: input.playerIds.map((playerId) => {
          const player = players.find((item) => item.id === playerId);
          if (!player) throw new Error('Unknown fictional round player.');
          return { playerId, displayName: player.displayName, handicapIndex: null };
        }) };
      }),
    };
    return Promise.resolve(workspace);
  },
  refreshIndices: unavailable,
};
const scores: ScoresClient = {
  load: (_eventId, roundId) => {
    const round = workspace.rounds.find((entry) => entry.id === roundId);
    if (!round) return unavailable();
    return Promise.resolve({
      ...fictionalGamesRound, roundId, roundName: round.name,
      ...(fictionalGamesRound.games ? { games: { ...fictionalGamesRound.games,
        configuration: { ...fictionalGamesRound.games.configuration, roundId } } } : {}),
    });
  },
  save: unavailable, saveGames: unavailable, history: unavailable,
};
const root = document.getElementById('setup-fixture');
if (!root) throw new Error('Missing fictional setup fixture root.');
createRoot(root).render(<div className="app"><main>
  <EventWorkspaceView eventId={workspace.event.id} canManageCatalog setup={setup} catalog={catalog} scores={scores} />
</main></div>);
