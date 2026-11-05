import { isPurseView } from '../../src/contracts/purse';
import type { TeamGameFormat } from '../../src/domain/games';
import type { EventPurseView, PurseWriteResult } from '../../src/domain/purse-settings';
import type { PursePlan, PurseTieResolution } from '../../src/domain/purse';
import { calculatePurse } from '../../src/domain/purse';
import { purseTestContext, purseTestId } from '../../src/domain/purse.test-support';

/** Entirely fictional awards and golfers, using producer-owned models and calculator. */
export function fictionalPurse(count = 4, format?: TeamGameFormat, strokes?: readonly number[]): EventPurseView {
  const context = purseTestContext(count, format, strokes);
  const view = { plan: context.plan, resolutions: [],
    calculation: calculatePurse(context.plan, context.workspace, context.rounds) };
  if (!isPurseView(view, context.workspace, context.rounds)) throw new Error('Invalid fictional purse fixture.');
  return { workspace: context.workspace, roundScores: context.rounds,
    configuration: { eventId: context.workspace.event.id, etag: 'fictional-purse', plan: context.plan, resolutions: [] }, view };
}

export function fictionalPurseSave(before: EventPurseView, plan: PursePlan, resolutions: readonly PurseTieResolution[],
  etag: string | null, id: string): PurseWriteResult {
  const view = { plan, resolutions, calculation: calculatePurse(plan, before.workspace, before.roundScores, resolutions) };
  if (!isPurseView(view, before.workspace, before.roundScores)) throw new Error('Invalid fictional saved purse fixture.');
  return {
    current: { ...before, configuration: { eventId: plan.eventId, etag: 'fictional-next', plan, resolutions }, view },
    change: { id, eventId: plan.eventId, expectedEtag: etag,
      before: { plan: before.configuration.plan, resolutions: before.configuration.resolutions }, after: { plan, resolutions },
      recordedAt: '2026-01-01T00:00:00Z', recordedBy: { tenantId: purseTestId(9001), objectId: purseTestId(9002) } },
  };
}
