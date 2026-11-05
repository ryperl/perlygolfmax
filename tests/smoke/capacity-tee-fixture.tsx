import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { CatalogClient } from '../../src/client/catalog';
import type { ScoresClient } from '../../src/client/scoring';
import type { CourseVersion, PlayerProfile, TeeProfile } from '../../src/domain/catalog';
import type { RoundSetupInput } from '../../src/domain/setup';
import type { RoundScores } from '../../src/domain/scoring';
import { SetupRoster } from '../../src/features/setup/SetupRoster';
import { RoundEditor } from '../../src/features/setup/RoundEditor';
import { GameSettings } from '../../src/features/games/GameSettings';
import { newGameDraft, setFormat } from '../../src/features/games/game-draft';
import { OwnerScoresView } from '../../src/features/scoring';
import { fictionalCapturedRound, fictionalGamesRound } from './games-fixture-data';
import '../../src/app/styles.css';
import '../../src/features/setup/setup.css';
import '../../src/features/games/games.css';

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const players: readonly PlayerProfile[] = Array.from({ length: 40 }, (_, index) => ({
  id: id(index + 1), displayName: `Fictional golfer ${String(index + 1).padStart(2, '0')}`,
  currentIndex: null, etag: 'fictional-player', createdAt: '2026-01-01T00:00:00Z',
}));
const personal: TeeProfile = {
  ...fictionalCapturedRound.teeProfile, id: 990, name: 'Fictional Silver', category: 'Fictional personal category',
  holes: fictionalCapturedRound.teeProfile.holes.map((hole) => ({ ...hole, par: 5, length: 220, allocation: 19 - hole.number })),
  totalPar: 90, totalYardage: 3960, ratings: [{ type: 'Total', course: 80, slope: 130, bogey: 100 }],
};
const version: CourseVersion = {
  id: fictionalCapturedRound.courseVersionId, courseId: fictionalCapturedRound.courseId, importedAt: '2026-01-01T00:00:00Z',
  provenance: { source: 'Fictional fixture', exportedAt: null },
  data: { ...fictionalCapturedRound.course, teeProfiles: [fictionalCapturedRound.teeProfile, personal] },
};
const unavailable = () => Promise.reject(new Error('Not implemented by this fictional fixture.'));
const catalog: CatalogClient = {
  version: () => Promise.resolve(version), courses: unavailable, players: unavailable,
  beginImport: unavailable, importStatus: unavailable, uploadProfile: unavailable, publish: unavailable,
  createPlayer: unavailable, renamePlayer: unavailable, history: unavailable, recordIndex: unavailable,
};
const groups = Array.from({ length: 10 }, (_, index) => ({
  number: index + 1, playerIds: players.slice(index * 4, index * 4 + 4).map((player) => player.id),
}));
const round: RoundScores = {
  ...fictionalGamesRound, groups, playerTees: [{ playerId: id(1), profile: personal }],
  cards: players.map((player) => ({
    playerId: player.id, displayName: player.displayName, etag: 'fictional-card', updatedAt: '2026-01-01T00:00:00Z',
    holes: fictionalGamesRound.layout.map((hole) => ({ number: hole.number, score: { kind: 'strokes', strokes: 4 } })),
  })),
};
const scores: ScoresClient = {
  load: () => Promise.resolve(round), save: unavailable, saveGames: unavailable, history: unavailable,
};
const pending = () => undefined;
export function Fixture() {
  const [roster, setRoster] = useState<readonly string[]>(players.map((player) => player.id));
  const [input, setInput] = useState<RoundSetupInput>({
    id: round.roundId, name: round.roundName, courseId: version.courseId, courseVersionId: version.id,
    teeProfileId: fictionalCapturedRound.teeProfile.id, groups, playerTeeSelections: [{ playerId: id(1), teeProfileId: personal.id }],
  });
  const [draft, setDraft] = useState(() => setFormat(newGameDraft(), 'two-net-better-ball', players.length));
  return <div className="app"><main>
    <h1>Fictional large event and personal tees</h1>
    <div className="panel setup-form">
      <SetupRoster players={players} selectedIds={roster} savedRoster={[]} locked={false} onChange={setRoster} />
      <RoundEditor round={input} saved={undefined} number={1} courses={[{
        id: version.courseId, name: version.data.name, location: version.data.city, currentVersionId: version.id, etag: 'fictional-course',
      }]} players={players} rosterIds={roster} client={catalog} allowPerGolferTees onPending={pending} onChange={setInput} />
    </div>
    <GameSettings draft={draft} roster={round.cards} disabled={false} saveDisabled={false} cancelDisabled={false}
      retry={false} onChange={setDraft} onSave={pending} onCancel={pending} />
    <OwnerScoresView client={scores} eventId={round.eventId} roundId={round.roundId} onSessionExpired={pending} />
  </main></div>;
}
const root = document.getElementById('capacity-tee-fixture');
if (!root) throw new Error('Missing fictional fixture root.');
createRoot(root).render(<Fixture />);
