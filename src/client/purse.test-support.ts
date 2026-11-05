import type { EventPurseView, PurseWriteResult } from '../domain/purse-settings';
import type { PursePlan, PurseTieResolution } from '../domain/purse';
import { calculatePurse } from '../domain/purse';
import type { RoundScores } from '../domain/scoring';
import { fictionalId, fictionalWorkspace } from './catalog.test-support';

export function fictionalEventPurse(): EventPurseView {
  const first = fictionalWorkspace.rounds[0];
  if (!first) throw new Error('Missing fictional round.');
  const workspace = { ...fictionalWorkspace, rounds: [first] };
  const roundScores: readonly RoundScores[] = [{
    eventId: workspace.event.id, eventName: workspace.event.name, eventStatus: workspace.event.status,
    roundId: first.id, roundName: first.name, courseName: first.course.name, teeName: first.teeProfile.name,
    teeCategory: first.teeProfile.category, teeRatings: first.teeProfile.ratings, layout: first.teeProfile.holes,
    groups: first.groups, setupLocked: false, lastUpdatedAt: null,
    cards: first.players.map((player) => ({
      playerId: player.playerId, displayName: player.displayName, etag: null, updatedAt: null,
      holes: first.teeProfile.holes.map((hole) => ({ number: hole.number, score: { kind: 'unplayed' } })),
    })),
  }];
  const plan: PursePlan = {
    eventId: workspace.event.id, currency: 'USD', funding: { kind: 'fixed', budgetMinor: 10000 },
    pools: [{ id: fictionalId(800), name: 'Fictional side pot', source: { kind: 'manual' },
      awardUnit: 'pot', amountMinor: 5001, recipientIds: workspace.roster.slice(0, 2).map((player) => player.playerId) }],
  };
  return { workspace, roundScores,
    configuration: { eventId: workspace.event.id, etag: 'purse-v1', plan, resolutions: [] },
    view: { plan, resolutions: [], calculation: calculatePurse(plan, workspace, roundScores) } };
}

export function fictionalPurseWrite(before: EventPurseView, plan: PursePlan,
  resolutions: readonly PurseTieResolution[], etag: string | null, requestId: string): PurseWriteResult {
  return {
    current: { ...before, configuration: { eventId: plan.eventId, etag: 'purse-v2', plan, resolutions },
      view: { plan, resolutions, calculation: calculatePurse(plan, before.workspace, before.roundScores, resolutions) } },
    change: { id: requestId, eventId: plan.eventId, expectedEtag: etag,
      before: { plan: before.configuration.plan, resolutions: before.configuration.resolutions }, after: { plan, resolutions },
      recordedAt: '2026-01-01T00:00:00Z', recordedBy: { tenantId: fictionalId(900), objectId: fictionalId(901) } },
  };
}
