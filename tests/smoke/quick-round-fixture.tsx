import { createRoot } from 'react-dom/client';
import type { QuickRoundClient } from '../../src/client/quick-round';
import type { EventSetupInput, EventWorkspace } from '../../src/domain/setup';
import type { ScoresClient } from '../../src/client/scoring';
import { PublicEventsPage } from '../../src/app/PublicEventsPage';
import { createPublicServices } from '../../src/client/public-events';
import { fictionalCapturedRound, fictionalGamesRound } from './games-fixture-data';
import '../../src/app/styles.css';
import { roundTee } from '../../src/domain/round-tee';
import type { QuickPlayer } from '../../src/domain/quick-round';

const players = Array.from({ length: 15 }, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  displayName: `Fictional golfer ${String(index + 1)}`, handicapIndexValue: index === 4 ? null : '0',
}));
let workspace: EventWorkspace | undefined;
let interrupted = false;
let archived = false;
let setupInput: EventSetupInput | undefined;
const playerCreations = new Map<string, { readonly payload: string; readonly player: QuickPlayer }>();
let playerCreationInterrupted = false;
const listedEvent = { id: '00000000-0000-4000-8000-000000000050', name: 'Fictional Quick round',
  role: 'viewer' as const, status: 'active' as const, quickRound: true as const, etag: 'quick-v1', createdAt: '2026-01-01T00:00:00Z' };
function confirm(eventId: string, input: EventSetupInput): EventWorkspace {
  const round = input.rounds[0];
  if (!round) throw new Error('Missing fictional round');
  const teeProfile = roundTee(fictionalCapturedRound.teeProfile, round.roundSide);
  if (!teeProfile) throw new Error('Missing fictional tee layout');
  setupInput = input;
  workspace = {
    quickRound: true, publicAccess: true, canViewScores: true,
    event: { id: eventId, name: input.name, role: 'viewer', status: 'active', quickRound: true, etag: 'quick-v1', createdAt: '2026-01-01T00:00:00Z' },
    location: input.location, etag: 'quick-v1', allowPerGolferTees: input.allowPerGolferTees ?? false,
    roster: input.playerIds.map((playerId) => ({ playerId, displayName: players.find((player) => player.id === playerId)?.displayName ?? 'Fictional golfer', handicapIndexValue: '0' })),
    rounds: [{ ...fictionalCapturedRound, ...round, teeProfile, scoringStarted: false,
      players: input.playerIds.map((playerId) => ({ playerId, displayName: 'Fictional golfer', handicapIndexValue: '0' })) }],
  };
  return workspace;
}
const quick: QuickRoundClient = {
  archive: () => { archived = true; return Promise.resolve(); },
  courses: () => Promise.resolve({ items: [{ id: fictionalCapturedRound.courseId, name: fictionalCapturedRound.course.name, latestVersionId: fictionalCapturedRound.courseVersionId }] }),
  players: () => Promise.resolve({ items: players, publicPlayerCreation: true }),
  createPlayer: (input, requestId) => {
    const payload = JSON.stringify(input);
    const existing = playerCreations.get(requestId);
    if (existing) {
      if (existing.payload !== payload) return Promise.reject(new Error('Fictional changed creation request'));
      return Promise.resolve(existing.player);
    }
    const player = { id: '00000000-0000-4000-8000-000000000099', ...input };
    playerCreations.set(requestId, { payload, player });
    players.push(player);
    if (!playerCreationInterrupted) {
      playerCreationInterrupted = true;
      return Promise.reject(new Error('Fictional lost player creation acknowledgement'));
    }
    return Promise.resolve(player);
  },
  version: () => Promise.resolve({ id: fictionalCapturedRound.courseVersionId, courseId: fictionalCapturedRound.courseId,
    data: { ...fictionalCapturedRound.course, teeProfiles: [fictionalCapturedRound.teeProfile] } }),
  create: (eventId, input) => {
    const saved = confirm(eventId, input);
    if (!interrupted) { interrupted = true; return Promise.reject(new Error('Fictional connection interrupted after saving.')); }
    return Promise.resolve(saved);
  },
  save: (eventId, _etag, _request, input) => Promise.resolve(confirm(eventId, input)),
  load: () => workspace ? Promise.resolve(workspace) : Promise.reject(new Error('Fictional round not created')),
};
const base = createPublicServices(`${window.location.origin}/__unused-public-api`);
const scores: ScoresClient = {
  ...base.scores,
  load: (eventId, roundId) => Promise.resolve({ ...fictionalGamesRound, eventId, roundId, quickRound: true, churchyEnabled: true,
    layout: workspace?.rounds[0]?.teeProfile.holes ?? fictionalGamesRound.layout,
    teeRatings: workspace?.rounds[0]?.teeProfile.ratings ?? fictionalCapturedRound.teeProfile.ratings,
    churchyRulesVersions: [1, 2, 3], churchyCustomNames: true,
    eventName: setupInput?.name ?? 'Fictional Quick round', groups: setupInput?.rounds[0]?.groups ?? [],
    cards: players.filter((player) => setupInput?.playerIds.includes(player.id)).map((player) => ({ playerId: player.id, displayName: player.displayName, etag: null, updatedAt: null,
      holes: (workspace?.rounds[0]?.teeProfile.holes ?? fictionalCapturedRound.teeProfile.holes).map((hole) => ({ number: hole.number, score: { kind: 'unplayed' } })) })),
    setupLocked: false, lastUpdatedAt: null, games: { configuration: { eventId, roundId, etag: null, games: [] }, results: [] },
    permissions: { role: 'public', canManageGames: true, writePlayerIds: setupInput?.playerIds ?? [] },
  }),
};
const root = document.getElementById('quick-round-fixture');
if (!root) throw new Error('Missing fictional Quick round fixture');
createRoot(root).render(<main><PublicEventsPage services={{ ...base, scores, quickRounds: quick,
  setup: { ...base.setup, load: (eventId, signal) => quick.load(eventId, signal) },
  events: { list: () => Promise.resolve({ events: archived ? [] : [workspace?.event ?? listedEvent] }) },
}} /></main>);
