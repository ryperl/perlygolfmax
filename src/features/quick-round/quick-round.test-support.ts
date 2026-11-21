import { vi } from 'vitest';
import type { QuickRoundClient } from '../../client/quick-round';
import type { EventSetupInput, EventWorkspace } from '../../domain/setup';
import type { ScoresClient } from '../../client/scoring';
import { fictionalCourse, fictionalId, fictionalPlayers, fictionalVersion, fictionalWorkspace } from '../../client/catalog.test-support';
import { fictionalRoundScores, gameResult } from '../../client/scoring.test-support';
import { inputFrom } from '../setup';

export function quickWorkspace(eventId: string, input: EventSetupInput): EventWorkspace {
  const round = input.rounds[0];
  const profile = fictionalCourse.teeProfiles.find((tee) => tee.id === round?.teeProfileId);
  const base = fictionalWorkspace.rounds[0];
  if (!round || !profile || !base) throw new Error('Missing fictional setup.');
  return {
    quickRound: true, publicAccess: true, canViewScores: true,
    event: { ...fictionalWorkspace.event, id: eventId, name: input.name, role: 'viewer',
      ...(input.startDate ? { startDate: input.startDate } : {}) },
    location: input.location, etag: 'quick-workspace-v1',
    roster: input.playerIds.map((id) => ({ playerId: id, displayName: `Fictional Player ${String(Number(id.slice(-2)))}`, handicapIndexValue: '8.0' })),
    allowPerGolferTees: input.allowPerGolferTees ?? false,
    rounds: [{ ...base, ...round, teeProfile: profile, players: input.playerIds.map((id) => ({
      playerId: id, displayName: 'Fictional Player', handicapIndexValue: '8.0',
    })), playerTees: (round.playerTeeSelections ?? []).flatMap((selection) => {
      const tee = fictionalCourse.teeProfiles.find((entry) => entry.id === selection.teeProfileId);
      return tee ? [{ playerId: selection.playerId, profile: tee }] : [];
    }) }],
  };
}

export function quickSource(explicitGameRules = false) {
  let workspace = quickWorkspace(fictionalId(50), inputFrom(fictionalWorkspace));
  const client: QuickRoundClient = {
    courses: vi.fn<QuickRoundClient['courses']>().mockResolvedValue({ items: [{
      id: fictionalVersion.courseId, name: fictionalCourse.name, latestVersionId: fictionalVersion.id,
    }] }),
    players: vi.fn<QuickRoundClient['players']>().mockResolvedValue({ items: [
      ...fictionalPlayers.map((player) => ({ id: player.id, displayName: player.displayName, handicapIndexValue: '8.0' })),
      { id: fictionalId(5), displayName: 'Fictional Player 5', handicapIndexValue: null },
    ] }),
    version: vi.fn<QuickRoundClient['version']>().mockResolvedValue(fictionalVersion),
    create: vi.fn<QuickRoundClient['create']>().mockImplementation((id, input) => {
      workspace = quickWorkspace(id, input); return Promise.resolve(workspace);
    }),
    load: vi.fn<QuickRoundClient['load']>().mockImplementation(() => Promise.resolve(workspace)),
    save: vi.fn<QuickRoundClient['save']>().mockImplementation((id, _etag, _request, input) => {
      workspace = { ...quickWorkspace(id, input), etag: 'quick-workspace-v2' }; return Promise.resolve(workspace);
    }),
  };
  const currentScores = () => ({
    ...(explicitGameRules ? { gameHandicapRules: 1 as const } : {}),
    ...fictionalRoundScores, quickRound: true as const, eventId: workspace.event.id, eventName: workspace.event.name,
    roundId: workspace.rounds[0]?.id ?? fictionalId(70), groups: workspace.rounds[0]?.groups ?? [],
    cards: fictionalRoundScores.cards.filter((card) => workspace.roster.some((player) => player.playerId === card.playerId)),
    permissions: { role: 'public' as const, canManageGames: true, writePlayerIds: workspace.roster.map((player) => player.playerId) },
  });
  const scores: ScoresClient = {
    load: vi.fn<ScoresClient['load']>().mockImplementation(() => Promise.resolve(currentScores())),
    saveGames: vi.fn<ScoresClient['saveGames']>().mockImplementation((_event, _round, games, etag, id) => Promise.resolve(gameResult(games, etag, id, currentScores()))),
    save: vi.fn<ScoresClient['save']>(), history: vi.fn<ScoresClient['history']>(),
  };
  return { client, scores, workspace };
}
