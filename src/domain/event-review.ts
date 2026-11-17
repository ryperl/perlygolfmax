import type { EventLeaderboardView } from './event-leaderboard.js';
import type { EventPurseView } from './purse-settings.js';
import type { RoundScores } from './scoring.js';
import { calculateKp, calculateKpPayout } from './kp.js';

export const eventReviewCodes = ['prize-tie', 'kp-tie', 'stale-decision', 'stale-teams', 'unavailable-inputs', 'budget-exceeded', 'unassigned-awards'] as const;
export interface EventReviewNotice {
  readonly code: typeof eventReviewCodes[number];
  readonly label: string;
  readonly contextId?: string;
}
function distinct(notices: readonly EventReviewNotice[]): readonly EventReviewNotice[] {
  const seen = new Set<string>();
  return notices.filter((notice) => {
    const key = JSON.stringify([notice.code, notice.contextId, notice.label]);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
export function roundReviewNotices(round: RoundScores, name: string, kpAmountMinor?: number): readonly EventReviewNotice[] {
  const notices: EventReviewNotice[] = [];
  for (const result of round.games?.results ?? []) {
    const gameName = round.games?.configuration.games.find((game) => game.id === result.gameId)?.name ?? 'Game';
    if (result.nassau?.status === 'unavailable' || result.wolf?.status === 'unavailable') {
      notices.push({ code: 'unavailable-inputs', label: `${name} · ${gameName}` });
    }
    if (result.nassau?.stalePresses.length) notices.push({ code: 'stale-decision', label: `${name} · ${gameName}` });
    if (result.teamSetupRequired) notices.push({ code: 'stale-teams', label: name });
    if (result.players.some((player) => player.status === 'unavailable'
      && player.unavailableReason !== undefined)) {
      notices.push({ code: 'unavailable-inputs', label: name });
    }
  }
  if (round.kp) {
    const kp = calculateKp(round);
    if (kp.status === 'unavailable') notices.push({ code: 'unavailable-inputs', label: `${name} · KP` });
    else if (kp.status === 'closed') {
      const payout = kpAmountMinor === undefined ? undefined : calculateKpPayout(round, kpAmountMinor);
      if (payout?.status === 'unavailable') notices.push({ code: 'unavailable-inputs', label: `${name} · KP` });
      if (kp.holes.some((hole) => hole.closestPlayerIds.length > 1
        && (payout?.status === 'review' || !round.kp?.decisions.some((decision) => decision.holeNumber === hole.number && decision.proof === hole.proof)))) {
        notices.push({ code: 'kp-tie', label: name });
      }
      if (round.kp.decisions.some((decision) => !kp.holes.some((hole) => hole.number === decision.holeNumber && hole.proof === decision.proof))) {
        notices.push({ code: 'stale-decision', label: `${name} · KP` });
      }
    }
  }
  return distinct(notices.map((notice) => ({ ...notice, contextId: round.roundId })));
}
export function leaderboardReviewNotices(value: EventLeaderboardView): readonly EventReviewNotice[] {
  return distinct([
    ...value.roundScores.flatMap((round) => roundReviewNotices(round,
      value.workspace.rounds.find((entry) => entry.id === round.roundId)?.name ?? 'Round')),
    ...value.standings.staleRoundIds.map((id): EventReviewNotice => ({ code: 'unavailable-inputs', contextId: id,
      label: value.workspace.rounds.find((round) => round.id === id)?.name ?? 'Overall competition' })),
    ...value.standings.players.flatMap((player) => player.cells.filter((cell) =>
      cell.status === 'unavailable' && cell.reason !== 'invalid-stroke-score').map((cell): EventReviewNotice => ({
      code: 'unavailable-inputs', contextId: cell.roundId, label: value.workspace.rounds.find((round) => round.id === cell.roundId)?.name ?? 'Overall competition',
    }))),
    ...(value.eventSkins?.unavailableHoles ? [{ code: 'unavailable-inputs' as const, label: 'Event skins', contextId: value.workspace.event.id }] : []),
  ]);
}
export function purseReviewNotices(value: EventPurseView): readonly EventReviewNotice[] {
  const calculation = value.view?.calculation;
  const notices: EventReviewNotice[] = [];
  for (const pool of calculation?.pools ?? []) {
    const definition = value.configuration.plan?.pools.find((entry) => entry.id === pool.poolId);
    const label = definition?.name ?? 'Prize pool';
    const add = (code: EventReviewNotice['code']) => { notices.push({ code, label, contextId: pool.poolId }); };
    if (pool.reasons.includes('unresolved-tie') && definition?.source.kind !== 'kp') add('prize-tie');
    if (pool.issues.some((issue) => issue.code === 'invalid-resolution')) add('stale-decision');
    if (pool.status === 'unavailable') add('unavailable-inputs');
    if (pool.reasons.includes('recipients-unassigned') || pool.reasons.includes('kp-no-qualifiers')
      || pool.reasons.includes('unoccupied-places') && pool.status === 'calculated') add('unassigned-awards');
  }
  if (calculation?.overBudgetMinor !== null && calculation?.overBudgetMinor !== undefined && calculation.overBudgetMinor > 0) {
    notices.push({ code: 'budget-exceeded', label: 'Event purse' });
  }
  if (value.configuration.plan && !calculation) notices.push({ code: 'unavailable-inputs', label: 'Event purse' });
  return distinct([
    ...notices,
    ...value.roundScores.flatMap((round) => {
      const pool = value.configuration.plan?.pools.find((entry) => entry.source.kind === 'kp' && entry.source.roundId === round.roundId);
      return roundReviewNotices(round, value.workspace.rounds.find((entry) => entry.id === round.roundId)?.name ?? 'Round',
        pool && 'amountMinor' in pool ? pool.amountMinor : undefined);
    }),
  ]);
}
