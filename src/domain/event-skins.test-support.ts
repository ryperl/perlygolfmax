import { purseTestContext, purseTestId } from './purse.test-support.js';
import type { HoleScore, RoundScores } from './scoring.js';
import type { EventWorkspace, RoundSnapshot } from './setup.js';
import { publishedCourseHandicaps } from './playing-handicaps.js';

export function eventSkinsFixture(
  strokes: readonly HoleScore[] = [{ kind: 'strokes', strokes: 3 }, { kind: 'strokes', strokes: 4 }],
  indexes: readonly (string | null)[] = ['0', '18'], roundCount = 1, holeCount = 18,
): { readonly workspace: EventWorkspace; readonly rounds: readonly RoundScores[] } {
  const base = purseTestContext(strokes.length);
  const first = base.workspace.rounds[0];
  const saved = base.rounds[0];
  if (!first || !saved) throw new Error('Missing fictional context.');
  const holes = Array.from({ length: holeCount }, (_, index) => ({
    number: index + 1, sourceId: 300 + index, length: 350, par: 4, allocation: index + 1,
  }));
  const rounds: readonly RoundSnapshot[] = Array.from({ length: roundCount }, (_, index) => ({
    ...first, id: purseTestId(2000 + index), name: `Fictional Round ${String(index + 1)}`, scoringStarted: true,
    teeProfile: { ...first.teeProfile, holeCount, holes, totalPar: holeCount * 4,
      totalYardage: holeCount * 350, totalMeters: holeCount * 320,
      ratings: [
        { type: 'Total', course: holeCount * 4, slope: 113, bogey: holeCount * 5 },
        { type: 'Front', course: 36, slope: 113, bogey: 45 },
        { type: 'Back', course: 36, slope: 113, bogey: 45 },
      ] },
    players: first.players.map((player, index) => ({
      ...player, handicapIndex: indexes[index] == null ? null
        : player.handicapIndex ? { ...player.handicapIndex, value: indexes[index] ?? '0' } : null,
    })),
  }));
  const { overallCompetition, ...savedWorkspace } = base.workspace;
  void overallCompetition;
  const workspace: EventWorkspace = { ...savedWorkspace,
    eventSkinsSupported: true, eventSkins: { version: 1 }, rounds };
  return { workspace, rounds: rounds.map((round): RoundScores => ({
    eventId: workspace.event.id, eventName: workspace.event.name, eventStatus: workspace.event.status,
    roundId: round.id, roundName: round.name, courseName: round.course.name,
    teeName: round.teeProfile.name, teeCategory: round.teeProfile.category, teeRatings: round.teeProfile.ratings,
    teeStrokeAllocation: true, layout: round.teeProfile.holes, groups: round.groups, setupLocked: true,
    lastUpdatedAt: saved.lastUpdatedAt,
    cards: saved.cards.map((card, index) => ({
      ...card, holes: holes.map((hole) => ({ number: hole.number, score: hole.number === 1
        ? strokes[index] ?? { kind: 'unplayed' } : { kind: 'picked-up' } })),
    })),
  })) };
}

export function withoutEventSkins(workspace: EventWorkspace): EventWorkspace {
  const { eventSkins, eventSkinsSupported, ...legacy } = workspace;
  void eventSkins; void eventSkinsSupported;
  return legacy;
}

export function publicEventSkinsFixture(f = eventSkinsFixture()): ReturnType<typeof eventSkinsFixture> {
  const workspace: EventWorkspace = { ...f.workspace, publicAccess: true, canViewScores: true,
    event: { ...f.workspace.event, role: 'viewer' },
    rounds: f.workspace.rounds.map((round) => ({ ...round, players: round.players.map(({ handicapIndex, ...player }) => ({
      ...player, handicapIndexValue: handicapIndex?.value ?? null,
    })) })) };
  return { workspace, rounds: f.rounds.map((round) => ({
    ...round, permissions: { role: 'public', canManageGames: false, writePlayerIds: round.cards.map((card) => card.playerId) },
    courseHandicaps: workspace.rounds.filter((entry) => entry.id === round.roundId).flatMap(publishedCourseHandicaps),
  })) };
}
