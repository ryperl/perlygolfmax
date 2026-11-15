import type { CourseHole } from './catalog.js';
import type { RoundScores, Scorecard } from './scoring.js';

export type KpEntry =
  | { readonly kind: 'measured'; readonly inches: number; readonly onGreen: true; readonly measurementId: string }
  | { readonly kind: 'no-measurement' };

export interface KpDecision {
  readonly holeNumber: number;
  readonly proof: string;
  readonly kind: 'winner' | 'split';
  readonly playerIds: readonly string[];
  readonly holeAmountMinor: number;
  readonly extraCentPlayerIds: readonly string[];
}
export interface KpSelection {
  readonly version: 1;
  readonly context: string;
  readonly status: 'open' | 'closed';
  readonly decisions: readonly KpDecision[];
}
export interface KpConfiguration extends KpSelection {
  readonly etag: string;
}
export interface KpWriteResult {
  readonly round: RoundScores;
  readonly requestId: string;
  readonly expectedEtag: string | null;
  readonly selection: KpSelection;
}
export interface KpHoleResult {
  readonly number: number;
  readonly contenders: readonly { readonly playerId: string; readonly inches: number }[];
  readonly closestPlayerIds: readonly string[];
  readonly proof: string;
}
export interface KpResults {
  readonly status: 'unavailable' | 'provisional' | 'closed';
  readonly holes: readonly KpHoleResult[];
}
export interface KpPayout {
  readonly status: 'unavailable' | 'provisional' | 'review' | 'final';
  readonly holes: readonly { readonly number: number; readonly amountMinor: number }[];
  readonly shares: readonly { readonly playerId: string; readonly holeNumber: number; readonly amountMinor: number }[];
  readonly reservedMinor: number;
}

/** Bounds exact integer arithmetic only; there is no golf-distance ceiling. */
export function kpDistance(feet: string, inches: string): number | null {
  if (!/^\d+$/.test(feet) || !/^\d+$/.test(inches)) return null;
  const whole = feet.replace(/^0+/, '') || '0';
  const part = inches.replace(/^0+/, '') || '0';
  if (whole.length > 16 || part.length > 2) return null;
  const remainder = BigInt(part);
  const total = BigInt(whole) * 12n + remainder;
  return remainder <= 11n && total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : null;
}

export function sameKpEntry(left?: KpEntry | null, right?: KpEntry | null): boolean {
  if (left == null || right == null) return left == null && right == null;
  return left.kind === right.kind && (left.kind === 'no-measurement'
    || right.kind === 'measured' && left.inches === right.inches && left.measurementId === right.measurementId);
}

/** Saved default tee only. Names, current catalog values and personal tees are intentionally absent. */
export function kpContext(layout: readonly CourseHole[], playerIds: readonly string[], captureIdentity?: string): string {
  return JSON.stringify({
    ...(captureIdentity ? { captureIdentity } : {}),
    holes: layout.map(({ number, sourceId, par, length, allocation }) => ({ number, sourceId, par, length, allocation })),
    playerIds: [...playerIds].sort(),
  });
}

export function calculateKp(round: Pick<RoundScores, 'layout' | 'cards' | 'kp' | 'kpCaptureIdentity'>): KpResults {
  const config = round.kp;
  const eligible = round.layout.filter((hole) => hole.par === 3);
  if (!config || !eligible.length || config.context !== kpContext(round.layout, round.cards.map((card) => card.playerId), round.kpCaptureIdentity)) {
    return { status: 'unavailable', holes: [] };
  }
  if (round.cards.some((card) => card.holes.some((hole) => hole.score.kp?.kind === 'measured'
    && (!Number.isSafeInteger(hole.score.kp.inches) || hole.score.kp.inches < 0)))) {
    return { status: 'unavailable', holes: [] };
  }
  const holes = eligible.map((hole): KpHoleResult => {
    const measured = round.cards.flatMap((card: Scorecard) => {
      const entry = card.holes.find((item) => item.number === hole.number)?.score.kp;
      return entry?.kind === 'measured' ? [{ playerId: card.playerId, inches: entry.inches, measurementId: entry.measurementId }] : [];
    }).sort((a, b) => a.playerId.localeCompare(b.playerId));
    const lowest = measured.reduce<number | null>((value, entry) => value === null || entry.inches < value ? entry.inches : value, null);
    return {
      number: hole.number, contenders: measured.map(({ playerId, inches }) => ({ playerId, inches })),
      closestPlayerIds: measured.filter((entry) => entry.inches === lowest).map((entry) => entry.playerId),
      proof: JSON.stringify([config.context, hole.number, measured]),
    };
  });
  return { status: config.status === 'closed' ? 'closed' : 'provisional', holes };
}

/** Equal winning-hole shares, then longest/hardest saved default-tee holes get remainder cents. */
export function calculateKpPayout(round: Pick<RoundScores, 'layout' | 'cards' | 'kp' | 'kpCaptureIdentity'>, amountMinor: number): KpPayout {
  const blocked: KpPayout = { status: 'unavailable', holes: [], shares: [], reservedMinor: amountMinor };
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) return blocked;
  const results = calculateKp(round);
  if (results.status === 'unavailable') return blocked;
  // Open holes are unknown. Do not redistribute their shares or claim final money.
  if (results.status === 'provisional') return { ...blocked, status: 'provisional' };
  const winning = results.holes.filter((hole) => hole.closestPlayerIds.length > 0);
  if (!winning.length) return { ...blocked, status: 'review' };
  const priority = winning.map((hole) => ({ result: hole, layout: round.layout.find((item) => item.number === hole.number) }))
    .sort((a, b) => (b.layout?.length ?? 0) - (a.layout?.length ?? 0)
      || (a.layout?.allocation ?? 0) - (b.layout?.allocation ?? 0));
  const remainder = amountMinor % winning.length;
  if (remainder && (priority.some((hole) => !hole.layout || !Number.isSafeInteger(hole.layout.length) || hole.layout.length <= 0
    || !Number.isSafeInteger(hole.layout.allocation) || hole.layout.allocation <= 0)
    || priority.some((hole, index) => priority.slice(index + 1).some((other) =>
      hole.layout?.length === other.layout?.length && hole.layout?.allocation === other.layout?.allocation)))) return blocked;
  const base = Number(BigInt(amountMinor) / BigInt(winning.length));
  const holes = priority.map((hole, index) => ({ number: hole.result.number, amountMinor: base + (index < remainder ? 1 : 0) }));
  const shares: KpPayout['shares'][number][] = [];
  let resolvedHoles = 0;
  for (const hole of winning) {
    const prize = holes.find((entry) => entry.number === hole.number)?.amountMinor;
    if (prize === undefined) return blocked;
    let recipients = hole.closestPlayerIds;
    let extras: readonly string[] = [];
    if (recipients.length > 1) {
      const decision = round.kp?.decisions.find((entry) => entry.holeNumber === hole.number);
      if (!decision || decision.proof !== hole.proof || decision.holeAmountMinor !== prize
        || !decision.playerIds.length || new Set(decision.playerIds).size !== decision.playerIds.length
        || decision.playerIds.some((id) => !recipients.includes(id))) continue;
      if (decision.kind === 'winner') {
        if (decision.playerIds.length !== 1 || decision.extraCentPlayerIds.length) continue;
      } else if (decision.playerIds.length !== recipients.length) continue;
      recipients = decision.playerIds;
      extras = decision.extraCentPlayerIds;
      const needed = prize % recipients.length;
      if (new Set(extras).size !== extras.length || extras.length !== needed || extras.some((id) => !recipients.includes(id))) continue;
    }
    const perPlayer = Number(BigInt(prize) / BigInt(recipients.length));
    resolvedHoles++;
    for (const playerId of recipients) shares.push({
      playerId, holeNumber: hole.number, amountMinor: perPlayer + (extras.includes(playerId) ? 1 : 0),
    });
  }
  const assigned = shares.reduce((sum, share) => sum + BigInt(share.amountMinor), 0n);
  return { status: assigned === BigInt(amountMinor) && resolvedHoles === winning.length ? 'final' : 'review',
    holes, shares, reservedMinor: Number(BigInt(amountMinor) - assigned) };
}
