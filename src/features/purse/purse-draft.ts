import { isPursePlan } from '../../contracts/purse';
import { isTeamGameDefinition } from '../../domain/games';
import type { EventPurseView, PurseSelection } from '../../domain/purse-settings';
import { samePursePlan, samePurseTieResolutions } from '../../domain/purse';
import type { PursePlan, PursePool, PurseTieResolution } from '../../domain/purse';
import { moneyText, parseMoney } from './money';

export interface PoolDraft {
  readonly id: string;
  readonly name: string;
  readonly source: PursePool['source'];
  readonly awardUnit: string;
  readonly tiePolicy: string;
  readonly amount: string;
  readonly recipientIds: readonly string[];
  readonly prizes: readonly { readonly place: string; readonly amount: string }[];
}
export interface PurseDraft {
  readonly currency: string;
  readonly funding: string;
  readonly amount: string;
  readonly pools: readonly PoolDraft[];
}
export interface SourceChoice {
  readonly key: string;
  readonly label: string;
  readonly source: PursePool['source'];
  readonly team: boolean;
}

export function sourceKey(source: PursePool['source']): string {
  return source.kind === 'round-game' ? `${source.roundId}:${source.gameId}` : source.kind;
}

export function sourceChoices(value: EventPurseView): readonly SourceChoice[] {
  return [
    { key: 'manual', label: 'Manual side pot', source: { kind: 'manual' }, team: false },
    ...(value.workspace.overallCompetition
      ? [{ key: 'overall', label: 'Overall competition · individual awards', source: { kind: 'overall' as const }, team: false }] : []),
    ...value.workspace.rounds.flatMap((snapshot) =>
      (value.roundScores.find((round) => round.roundId === snapshot.id)?.games?.configuration.games ?? []).filter((game) => game.kind !== 'churchy').map((game) => ({
        key: `${snapshot.id}:${game.id}`, label: `${snapshot.name} · ${game.name}${isTeamGameDefinition(game) ? ' · team awards' : ''}`,
        source: { kind: 'round-game' as const, roundId: snapshot.id, gameId: game.id }, team: isTeamGameDefinition(game),
      }))),
  ];
}

export function draftFromPlan(plan: PursePlan | null): PurseDraft {
  return {
    currency: plan?.currency ?? 'USD', funding: plan?.funding.kind ?? 'fixed',
    amount: plan ? moneyText(plan.funding.kind === 'fixed' ? plan.funding.budgetMinor : plan.funding.buyInMinor) : '0.00',
    pools: plan?.pools.map((pool) => ({
      id: pool.id, name: pool.name, source: pool.source, awardUnit: pool.awardUnit,
      tiePolicy: 'tiePolicy' in pool ? pool.tiePolicy : 'pooled',
      amount: 'amountMinor' in pool ? moneyText(pool.amountMinor) : '0.00',
      recipientIds: 'recipientIds' in pool ? pool.recipientIds : [],
      prizes: 'prizes' in pool ? pool.prizes.map((prize) => ({
        place: String(prize.place), amount: moneyText(prize.amountMinor),
      })) : [],
    })) ?? [],
  };
}

export function newPool(id: string): PoolDraft {
  return { id, name: '', source: { kind: 'manual' }, awardUnit: 'pot', tiePolicy: 'pooled',
    amount: '0.00', recipientIds: [], prizes: [{ place: '1', amount: '0.00' }] };
}

export function selectSource(pool: PoolDraft, choice: SourceChoice): PoolDraft {
  return { ...pool, source: choice.source,
    awardUnit: choice.source.kind === 'manual' ? 'pot' : choice.team ? 'per-team' : 'per-golfer' };
}

function placeNumber(text: string): number | null {
  if (!/^[1-9]\d*$/.test(text) || text.length > 16) return null;
  const value = BigInt(text);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}

/** The runtime guard narrows constructed data; no draft string is asserted into a domain type. */
export function buildPurseDraft(draft: PurseDraft, eventId: string): PursePlan | null {
  const amount = parseMoney(draft.amount);
  const candidate: unknown = {
    eventId, currency: draft.currency,
    funding: draft.funding === 'fixed' ? { kind: 'fixed', budgetMinor: amount }
      : { kind: draft.funding, buyInMinor: amount },
    pools: draft.pools.map((pool) => pool.source.kind === 'manual'
      ? { id: pool.id, name: pool.name.trim(), source: pool.source, awardUnit: pool.awardUnit,
        amountMinor: parseMoney(pool.amount), recipientIds: pool.recipientIds }
      : { id: pool.id, name: pool.name.trim(), source: pool.source, awardUnit: pool.awardUnit, tiePolicy: pool.tiePolicy,
        prizes: pool.prizes.map((prize) => ({ place: placeNumber(prize.place), amountMinor: parseMoney(prize.amount) })) }),
  };
  return isPursePlan(candidate) ? candidate : null;
}

function poolUnchanged(pool: PursePool | undefined, other: PursePool | undefined, plan: PursePlan): boolean {
  if (!pool || !other) return pool === other;
  return samePursePlan({ ...plan, pools: [pool] }, { ...plan, pools: [other] });
}

/** Rebase only explicitly edited/deleted pools. Untouched concurrent additions/edits survive. */
export function reviewSelection(base: PurseSelection, local: { readonly plan: PursePlan; readonly resolutions: readonly PurseTieResolution[] },
  latest: PurseSelection): { readonly plan: PursePlan; readonly resolutions: readonly PurseTieResolution[] } {
  const before = base.plan;
  const current = latest.plan;
  const localPlan = local.plan;
  const changed = new Set([...before?.pools ?? [], ...localPlan.pools].filter((pool) =>
    !poolUnchanged(before?.pools.find((entry) => entry.id === pool.id),
      localPlan.pools.find((entry) => entry.id === pool.id), localPlan)).map((pool) => pool.id));
  const pools = [
    ...(current?.pools ?? []).filter((pool) => !changed.has(pool.id)),
    ...localPlan.pools.filter((pool) => changed.has(pool.id)),
  ];
  const fundingUnchanged = before !== null && samePursePlan(
    { ...before, currency: localPlan.currency, pools: [] }, { ...localPlan, pools: [] });
  const plan = { ...localPlan, pools,
    currency: current && before?.currency === localPlan.currency ? current.currency : localPlan.currency,
    funding: fundingUnchanged && current ? current.funding : localPlan.funding };
  const keys = new Set([...base.resolutions, ...local.resolutions].map((entry) => `${entry.poolId}:${String(entry.rank)}`));
  const changedDecisions = new Set([...keys].filter((key) => !samePurseTieResolutions(
    base.resolutions.filter((entry) => `${entry.poolId}:${String(entry.rank)}` === key),
    local.resolutions.filter((entry) => `${entry.poolId}:${String(entry.rank)}` === key))));
  const resolutions = [
    ...latest.resolutions.filter((entry) => !changedDecisions.has(`${entry.poolId}:${String(entry.rank)}`)),
    ...local.resolutions.filter((entry) => changedDecisions.has(`${entry.poolId}:${String(entry.rank)}`)),
  ].filter((entry) => !changed.has(entry.poolId) || pools.some((pool) => pool.id === entry.poolId));
  return { plan, resolutions };
}
